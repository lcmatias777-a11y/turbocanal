// Funcionalidades do PRÓPRIO canal do usuário (exigem canal conectado via OAuth):
// listar meus vídeos, enviar capa, editar título/descrição e testes A/B de capa.
// Toda ação verifica no servidor se o vídeo pertence ao canal conectado.
import { youtubeAccessToken } from './auth.js';
import { spend, refund } from './credits.js';
import { HttpError, audit, must, now, uid } from './util.js';

const API = 'https://www.googleapis.com/youtube/v3/';

async function yt(token, path, { method = 'GET', params = {}, body, raw } = {}) {
  const u = new URL(path.startsWith('http') ? path : API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  let resp, data;
  try {
    resp = await fetch(u, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(raw ? { 'Content-Type': raw.mime } : body ? { 'Content-Type': 'application/json' } : {})
      },
      body: raw ? raw.buffer : body ? JSON.stringify(body) : undefined
    });
    data = await resp.json().catch(() => ({}));
  } catch {
    throw new HttpError(502, 'Não foi possível falar com a API do YouTube agora.');
  }
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new HttpError(502, 'YouTube: ' + msg);
  }
  return data;
}

function mapVideo(v) {
  const st = v.statistics || {};
  return {
    id: v.id,
    title: v.snippet?.title,
    description: v.snippet?.description || '',
    publishedAt: v.snippet?.publishedAt,
    thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
    tags: v.snippet?.tags || [],
    categoryId: v.snippet?.categoryId,
    privacy: v.status?.privacyStatus,
    views: +st.viewCount || 0,
    likes: st.likeCount != null ? +st.likeCount : null,
    comments: st.commentCount != null ? +st.commentCount : null
  };
}

async function myChannel(db, user) {
  const token = await youtubeAccessToken(db, user);
  const ch = await yt(token, 'channels', { params: { part: 'snippet,statistics,contentDetails', mine: 'true' } });
  const c = ch.items?.[0];
  if (!c) throw new HttpError(404, 'Nenhum canal do YouTube encontrado nesta conta Google.');
  if (c.id) await db.run('UPDATE yt_tokens SET channel_id=?, channel_title=? WHERE user_id=?', [c.id, c.snippet?.title || null, user.id]);
  return { token, channel: c };
}

async function ownedVideo(db, user, videoId) {
  const { token, channel } = await myChannel(db, user);
  const r = await yt(token, 'videos', { params: { part: 'snippet,statistics,status', id: videoId } });
  const v = r.items?.[0];
  if (!v) throw new HttpError(404, 'Vídeo não encontrado.');
  if (v.snippet?.channelId !== channel.id) {
    throw new HttpError(403, 'Este vídeo não é do seu canal. Só é possível alterar vídeos do canal conectado.');
  }
  return { token, channel, video: v };
}

function decodeImage(input) {
  const s = String(input || '');
  const m = s.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  const mime = m ? m[1].toLowerCase().replace('jpg', 'jpeg') : 'image/png';
  const b64 = m ? m[2] : s;
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new HttpError(400, 'Imagem inválida.');
  if (buffer.length > 2 * 1024 * 1024) throw new HttpError(400, 'A capa precisa ter no máximo 2 MB.');
  return { mime, buffer, b64 };
}

async function setThumbnail(token, videoId, img) {
  return yt(token, `https://www.googleapis.com/upload/youtube/v3/thumbnails/set`, {
    method: 'POST',
    params: { videoId, uploadType: 'media' },
    raw: { mime: img.mime, buffer: img.buffer }
  });
}

async function videoViews(token, videoId) {
  const r = await yt(token, 'videos', { params: { part: 'statistics', id: videoId } });
  return +(r.items?.[0]?.statistics?.viewCount || 0);
}

export function channelRoutes(app, db, auth) {
  // Executa cobrando créditos no servidor, com estorno em caso de falha.
  const charged = (tool, handler) => async (req, res, next) => {
    try {
      const idem = req.get('X-Idempotency-Key') || null;
      const charge = await spend(db, req.user, tool, { idem });
      let result;
      try {
        result = await handler(req);
      } catch (e) {
        if (!charge.unlimited && !charge.reused && charge.charged > 0) {
          await refund(db, req.user, charge.charged, `Estorno automático: falha em ${tool}`);
        }
        throw e;
      }
      res.json({ ok: true, tool, result, credits: { cost: charge.cost, charged: charge.reused ? 0 : charge.charged, reused: !!charge.reused, unlimited: !!charge.unlimited, balance: charge.unlimited ? null : charge.balance } });
    } catch (e) {
      next(e);
    }
  };

  // Meus vídeos (leitura do próprio canal: sem custo em créditos)
  app.get('/api/channel/videos', auth.required, async (req, res, next) => {
    try {
      const { token, channel } = await myChannel(db, user(req));
      const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
      let videos = [];
      if (uploads) {
        const pl = await yt(token, 'playlistItems', { params: { part: 'contentDetails', playlistId: uploads, maxResults: 50 } });
        const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
        if (ids.length) {
          const vs = await yt(token, 'videos', { params: { part: 'snippet,statistics,status', id: ids.join(','), maxResults: 50 } });
          videos = (vs.items || []).map(mapVideo);
        }
      }
      const st = channel.statistics || {};
      res.json({
        channel: { id: channel.id, title: channel.snippet?.title, thumb: channel.snippet?.thumbnails?.medium?.url || null, subs: st.hiddenSubscriberCount ? null : +st.subscriberCount || 0, views: +st.viewCount || 0, videos: +st.videoCount || 0 },
        videos
      });
    } catch (e) {
      next(e);
    }
  });

  // Enviar capa para um vídeo MEU
  app.post('/api/channel/videos/:id/thumbnail', auth.required, charged('thumbnail_upload', async (req) => {
    const videoId = must(req.params.id, 'vídeo', { max: 20 });
    const img = decodeImage(must(req.body?.image, 'imagem', { max: 4_000_000 }));
    const { token, video } = await ownedVideo(db, req.user, videoId);
    const r = await setThumbnail(token, videoId, img);
    await audit(db, req.user, 'youtube.thumbnail_set', videoId, video.snippet?.title || '');
    return { videoId, title: video.snippet?.title, thumb: r.items?.[0]?.high?.url || r.items?.[0]?.default?.url || null };
  }));

  // Editar título/descrição/tags de um vídeo MEU
  app.put('/api/channel/videos/:id', auth.required, charged('video_update', async (req) => {
    const videoId = must(req.params.id, 'vídeo', { max: 20 });
    const { token, video } = await ownedVideo(db, req.user, videoId);
    const snippet = { ...video.snippet };
    if (req.body?.title !== undefined) snippet.title = must(req.body.title, 'título', { max: 100 });
    if (req.body?.description !== undefined) snippet.description = String(req.body.description).slice(0, 5000);
    if (Array.isArray(req.body?.tags)) snippet.tags = req.body.tags.map(String).slice(0, 60);
    const body = { id: videoId, snippet: { title: snippet.title, description: snippet.description, tags: snippet.tags || [], categoryId: snippet.categoryId, defaultLanguage: snippet.defaultLanguage } };
    if (!body.snippet.defaultLanguage) delete body.snippet.defaultLanguage;
    const r = await yt(token, 'videos', { method: 'PUT', params: { part: 'snippet' }, body });
    await audit(db, req.user, 'youtube.video_update', videoId, body.snippet.title);
    return mapVideo({ ...r, statistics: video.statistics });
  }));

  // ---------- Teste A/B de capas (alternância agendada) ----------
  app.get('/api/channel/ab', auth.required, async (req, res, next) => {
    try {
      const rows = await db.all('SELECT id,video_id,title,hours,current,status,last_switch,log,created_at FROM ab_tests WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      res.json({ items: rows.map((r) => ({ ...r, log: safeJson(r.log) })) });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/channel/ab', auth.required, charged('ab_test', async (req) => {
    const videoId = must(req.body?.video_id, 'vídeo', { max: 20 });
    const hours = Math.min(168, Math.max(1, parseInt(req.body?.hours, 10) || 24));
    const a = decodeImage(must(req.body?.thumb_a, 'capa A', { max: 4_000_000 }));
    const b = decodeImage(must(req.body?.thumb_b, 'capa B', { max: 4_000_000 }));
    const { token, video } = await ownedVideo(db, req.user, videoId);
    const running = await db.get("SELECT id FROM ab_tests WHERE user_id=? AND video_id=? AND status='running'", [req.user.id, videoId]);
    if (running) throw new HttpError(409, 'Já existe um teste A/B rodando para este vídeo. Pare o anterior antes.');
    await setThumbnail(token, videoId, a); // começa com a capa A
    const views = await videoViews(token, videoId);
    const id = uid();
    const log = [{ variant: 'A', from: now(), views_start: views }];
    await db.run(
      'INSERT INTO ab_tests(id,user_id,video_id,title,thumb_a,thumb_b,hours,current,status,last_switch,log,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.user.id, videoId, video.snippet?.title || '', `data:${a.mime};base64,${a.b64}`, `data:${b.mime};base64,${b.b64}`, hours, 'A', 'running', now(), JSON.stringify(log), now()]
    );
    await audit(db, req.user, 'youtube.ab_start', videoId, `${hours}h por variante`);
    return { id, videoId, hours, current: 'A', aviso: 'As capas alternam automaticamente a cada período; as views de cada período ficam registradas para comparação. Não é o recurso nativo "Testar e comparar" do YouTube (que não tem API pública).' };
  }));

  app.post('/api/channel/ab/:id/stop', auth.required, async (req, res, next) => {
    try {
      const t = await db.get('SELECT * FROM ab_tests WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
      if (!t) throw new HttpError(404, 'Teste não encontrado.');
      const winner = String(req.body?.keep || '').toUpperCase();
      if (winner === 'A' || winner === 'B') {
        const token = await youtubeAccessToken(db, req.user);
        await setThumbnail(token, t.video_id, decodeImage(winner === 'A' ? t.thumb_a : t.thumb_b));
      }
      await db.run("UPDATE ab_tests SET status='stopped' WHERE id=?", [t.id]);
      await audit(db, req.user, 'youtube.ab_stop', t.video_id, winner ? `mantida capa ${winner}` : 'parado');
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}

function safeJson(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}
function user(req) {
  return req.user;
}

/** Agendador: alterna as capas dos testes A/B vencidos. Chamar a cada poucos minutos. */
export async function runAbScheduler(db) {
  const tests = await db.all("SELECT * FROM ab_tests WHERE status='running'");
  for (const t of tests) {
    try {
      const due = new Date(t.last_switch || t.created_at).getTime() + t.hours * 3600 * 1000;
      if (Date.now() < due) continue;
      const u = await db.get('SELECT * FROM users WHERE id=?', [t.user_id]);
      if (!u) continue;
      const token = await youtubeAccessToken(db, u);
      const views = await videoViews(token, t.video_id);
      const log = safeJson(t.log);
      const last = log[log.length - 1];
      if (last) { last.to = now(); last.views_end = views; last.views_gain = Math.max(0, views - (last.views_start || 0)); }
      const next = t.current === 'A' ? 'B' : 'A';
      await setThumbnail(token, t.video_id, decodeImage(next === 'A' ? t.thumb_a : t.thumb_b));
      log.push({ variant: next, from: now(), views_start: views });
      await db.run('UPDATE ab_tests SET current=?, last_switch=?, log=? WHERE id=?', [next, now(), JSON.stringify(log), t.id]);
    } catch (e) {
      console.error('[ab] falha ao alternar teste', t.id, e.message);
    }
  }
}
