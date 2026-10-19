import { spend, refund } from './credits.js';
import { must } from './util.js';
import * as ytb from './youtube.js';
import * as ai from './ai.js';

export function toolRoutes(app, db, auth) {
  // Executa uma ferramenta cobrando créditos NO SERVIDOR, com estorno em caso de falha.
  const run = (tool, handler) => async (req, res, next) => {
    try {
      const user = req.user;
      const idem = req.get('X-Idempotency-Key') || (typeof req.body?.idem === 'string' ? req.body.idem.slice(0, 80) : null);
      const charge = spend(db, user, tool, { idem });
      let result;
      try {
        result = await handler(req);
      } catch (e) {
        // Falha na execução: estorna o que foi cobrado nesta chamada.
        if (!charge.unlimited && !charge.reused && charge.charged > 0) {
          refund(db, user, charge.charged, `Estorno automático: falha em ${tool}`);
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

  app.post('/api/tools/video_search', auth.required, run('video_search', (req) => ytb.searchVideos(db, must(req.body?.q, 'busca'))));

  app.post('/api/tools/keyword_research', auth.required, run('keyword_research', (req) => ytb.keywordResearch(db, must(req.body?.q, 'palavra-chave'))));

  app.post('/api/tools/video_analysis', auth.required, run('video_analysis', (req) => ytb.videoAnalysis(db, must(req.body?.video, 'link ou ID do vídeo'))));

  app.post('/api/tools/channel_analysis', auth.required, run('channel_analysis', (req) => ytb.channelAnalysis(db, must(req.body?.channel, 'canal'))));

  app.post('/api/tools/trends', auth.required, run('trends', (req) => {
    const region = String(req.body?.region || 'BR').toUpperCase().slice(0, 2);
    return ytb.trends(db, /^[A-Z]{2}$/.test(region) ? region : 'BR');
  }));

  app.post('/api/tools/title_ai', auth.required, run('title_ai', (req) => {
    const topic = must(req.body?.topic, 'tema do vídeo', { max: 200 });
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map(String).slice(0, 10) : [];
    return ai.titleSuggestions({ topic, keywords });
  }));

  app.post('/api/tools/description_ai', auth.required, run('description_ai', (req) => {
    const topic = must(req.body?.topic, 'tema do vídeo', { max: 200 });
    const draft = typeof req.body?.draft === 'string' ? req.body.draft.slice(0, 4000) : '';
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map(String).slice(0, 10) : [];
    return ai.descriptionOptimize({ topic, draft, keywords });
  }));

  // Tabela de custos (pública, para o site e a extensão mostrarem antes de usar)
  app.get('/api/tools/costs', (req, res) => {
    res.json({ costs: db.prepare('SELECT tool,cost,label FROM tool_costs ORDER BY cost').all() });
  });

  // Histórico do próprio usuário (créditos e ferramentas)
  app.get('/api/history', auth.required, (req, res) => {
    const rows = db
      .prepare('SELECT delta,balance_after,tool,note,created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 200')
      .all(req.user.id);
    res.json({ items: rows });
  });
}
