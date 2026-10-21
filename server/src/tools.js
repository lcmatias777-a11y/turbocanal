import { spend, refund } from './credits.js';
import { must } from './util.js';
import * as ytb from './youtube.js';
import * as ai from './ai.js';
import * as gemini from './gemini.js';
import { HttpError, uid, now } from './util.js';

export function toolRoutes(app, db, auth) {
  // Executa uma ferramenta cobrando créditos NO SERVIDOR, com estorno em caso de falha.
  const run = (tool, handler) => async (req, res, next) => {
    try {
      const user = req.user;
      const idem = req.get('X-Idempotency-Key') || (typeof req.body?.idem === 'string' ? req.body.idem.slice(0, 80) : null);
      const charge = await spend(db, user, tool, { idem });
      let result;
      try {
        result = await handler(req);
      } catch (e) {
        if (!charge.unlimited && !charge.reused && charge.charged > 0) {
          await refund(db, user, charge.charged, `Estorno automático: falha em ${tool}`);
        }
        throw e;
      }
      res.json({
        ok: true,
        tool,
        result,
        credits: {
          cost: charge.cost,
          charged: charge.reused ? 0 : charge.charged,
          reused: !!charge.reused,
          unlimited: !!charge.unlimited,
          balance: charge.unlimited ? null : charge.balance
        }
      });
    } catch (e) {
      next(e);
    }
  };

  app.post('/api/tools/video_search', auth.required, run('video_search', (req) => ytb.searchVideos(db, must(req.body?.q, 'busca'), 10, req.user)));
  app.post('/api/tools/keyword_research', auth.required, run('keyword_research', (req) => ytb.keywordResearch(db, must(req.body?.q, 'palavra-chave'), req.user)));
  app.post('/api/tools/video_analysis', auth.required, run('video_analysis', (req) => ytb.videoAnalysis(db, must(req.body?.video, 'link ou ID do vídeo'), req.user)));
  app.post('/api/tools/channel_analysis', auth.required, run('channel_analysis', (req) => ytb.channelAnalysis(db, must(req.body?.channel, 'canal'), req.user)));
  app.post('/api/tools/trends', auth.required, run('trends', (req) => {
    const region = String(req.body?.region || 'BR').toUpperCase().slice(0, 2);
    return ytb.trends(db, /^[A-Z]{2}$/.test(region) ? region : 'BR', undefined, req.user);
  }));

  app.post('/api/tools/title_ai', auth.required, run('title_ai', (req) => {
    const topic = must(req.body?.topic, 'tema do vídeo', { max: 200 });
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map(String).slice(0, 10) : [];
    return ai.titleSuggestions(db, { topic, keywords });
  }));

  app.post('/api/tools/description_ai', auth.required, run('description_ai', (req) => {
    const topic = must(req.body?.topic, 'tema do vídeo', { max: 200 });
    const draft = typeof req.body?.draft === 'string' ? req.body.draft.slice(0, 4000) : '';
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map(String).slice(0, 10) : [];
    return ai.descriptionOptimize(db, { topic, draft, keywords });
  }));

  // IA assiste o vídeo (Gemini) e devolve insights
  app.post('/api/tools/video_insights_ai', auth.required, run('video_insights_ai', (req) => {
    const id = ytb.parseVideoId(must(req.body?.video, 'link ou ID do vídeo'));
    return gemini.videoInsights(db, id);
  }));

  // Capa gerada por IA (Gemini imagem)
  app.post('/api/tools/thumbnail_ai', auth.required, run('thumbnail_ai', (req) => {
    const title = must(req.body?.title, 'título ou tema', { max: 200 });
    const brief = typeof req.body?.brief === 'string' ? req.body.brief.slice(0, 600) : '';
    const style = typeof req.body?.style === 'string' ? req.body.style.slice(0, 60) : 'vibrante';
    return gemini.generateThumbnail(db, { title, brief, style });
  }));

  // Painel automático da extensão (mesma análise, custo mínimo)
  app.post('/api/tools/video_panel', auth.required, run('video_panel', (req) => ytb.videoAnalysis(db, must(req.body?.video, 'vídeo'), req.user)));

  // Preparar: pacote de publicação / ideias / roteiro
  app.post('/api/tools/prep_ai', auth.required, run('prep_ai', (req) => {
    const topic = must(req.body?.topic, 'tema do vídeo', { max: 200 });
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : '';
    const audience = typeof req.body?.audience === 'string' ? req.body.audience.slice(0, 200) : '';
    return ai.prepPack(db, { topic, notes, audience });
  }));

  // Transformar: IA assiste o vídeo e acha cortes para Shorts ou reaproveita em post/artigo/thread
  app.post('/api/tools/transform_ai', auth.required, run('transform_ai', (req) => {
    const id = ytb.parseVideoId(must(req.body?.video, 'link ou ID do vídeo'));
    const mode = ['shorts', 'post', 'artigo', 'thread'].includes(req.body?.mode) ? req.body.mode : 'shorts';
    return gemini.transformVideo(db, id, mode);
  }));

  // Ideias de próximos vídeos (usa os títulos mais vistos do canal, enviados pelo site)
  const ideasInput = (req) => ({
    niche: String(req.body?.niche || '').trim().slice(0, 200),
    titles: Array.isArray(req.body?.titles) ? req.body.titles.map((t) => String(t).slice(0, 120)).filter(Boolean).slice(0, 20) : [],
    channel: String(req.body?.channel || '').slice(0, 100)
  });
  app.post('/api/tools/ideas_ai', auth.required,
    (req, res, next) => { const i = ideasInput(req); next(i.niche || i.titles.length ? undefined : new HttpError(400, 'Diga o tema do canal (ou vincule seu canal para eu usar os seus vídeos).')); },
    run('ideas_ai', (req) => ai.channelIdeas(db, ideasInput(req))));

  // Sugestões de resposta a um comentário
  app.post('/api/tools/reply_ai', auth.required, run('reply_ai', (req) => {
    const comment = must(req.body?.comment, 'comentário', { max: 2000 });
    return ai.replySuggestions(db, { comment, channel: String(req.body?.channel || '').slice(0, 100) });
  }));

  // ---------- Concorrentes ----------
  app.get('/api/competitors', auth.required, async (req, res, next) => {
    try {
      const rows = await db.all('SELECT id,channel_id,title,thumb,subs,last_data,last_checked,created_at FROM competitors WHERE user_id=? ORDER BY created_at', [req.user.id]);
      res.json({ items: rows.map((r) => ({ ...r, last_data: r.last_data ? JSON.parse(r.last_data) : null })) });
    } catch (e) { next(e); }
  });

  // Adicionar = analisar o canal (cobra como análise) e salvar na lista
  app.post('/api/competitors', auth.required, run('competitor_check', async (req) => {
    const q = must(req.body?.channel, 'canal (@handle ou link)', { max: 200 });
    const count = (await db.get('SELECT COUNT(*)::int AS n FROM competitors WHERE user_id=?', [req.user.id])).n;
    if (count >= 20) throw new HttpError(400, 'Você já acompanha 20 canais. Remova algum para adicionar outro.');
    const r = await ytb.channelAnalysis(db, q, req.user);
    const summary = { recent: (r.recent || []).slice(0, 6), media: r.mediaViewsRecentes, views: r.channel.views, videos: r.channel.videos };
    await db.run(
      `INSERT INTO competitors(id,user_id,channel_id,title,thumb,subs,last_data,last_checked,created_at) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET title=EXCLUDED.title, thumb=EXCLUDED.thumb, subs=EXCLUDED.subs, last_data=EXCLUDED.last_data, last_checked=EXCLUDED.last_checked`,
      [uid(), req.user.id, r.channel.id, r.channel.title, r.channel.thumb, r.channel.subs, JSON.stringify(summary), now(), now()]
    );
    return { channel: r.channel, ...summary };
  }));

  app.delete('/api/competitors/:id', auth.required, async (req, res, next) => {
    try {
      await db.run('DELETE FROM competitors WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Tabela de custos (pública)
  app.get('/api/tools/costs', async (req, res, next) => {
    try {
      res.json({ costs: await db.all('SELECT tool,cost,label FROM tool_costs ORDER BY cost') });
    } catch (e) {
      next(e);
    }
  });

  // Histórico do próprio usuário
  app.get('/api/history', auth.required, async (req, res, next) => {
    try {
      const rows = await db.all(
        'SELECT delta,balance_after,tool,note,created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 200',
        [req.user.id]
      );
      res.json({ items: rows });
    } catch (e) {
      next(e);
    }
  });
}
