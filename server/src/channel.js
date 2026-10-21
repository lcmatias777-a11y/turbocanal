// Funcionalidades do PRÓPRIO canal do usuário (exigem canal conectado via OAuth):
// listar meus vídeos, enviar capa, editar título/descrição e testes A/B de capa.
// Toda ação verifica no servidor se o vídeo pertence ao canal conectado.
import { youtubeAccessToken } from './auth.js';
import { spend, refund } from './credits.js';
import { HttpError, audit, must, now, uid } from './util.js';
import { seoChecklist, vph, engagement, countUnits, quotaError } from './youtube.js';

// Endereços da API (podem ser trocados por um YouTube simulado nos testes automáticos)
const API = process.env.YT_API_BASE || 'https://www.googleapis.com/youtube/v3/';
const UPLOAD = process.env.YT_UPLOAD_BASE || 'https://www.googleapis.com/upload/youtube/v3/';
const ANALYTICS = process.env.YT_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com/v2/';
let DB = null; // definido em channelRoutes (para contar a cota usada)

function unitsFor(path, method) {
  if (path.includes('youtubeanalytics')) return 0; // cota separada
  if (path.includes('/upload/youtube/v3/thumbnails')) return 50;
  if (method === 'GET') return 1;
  return 50; // insert/update/bind
}

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
  if (DB) await countUnits(DB, unitsFor(String(u), method));
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    if (quotaError(msg)) throw new HttpError(429, 'O limite diário da API do YouTube deste site foi atingido. Ele renova por volta das 4h ou 5h (horário de Brasília). Seus créditos foram devolvidos.');
    if (/insufficient|forbidden|permission/i.test(msg) && resp.status === 403) throw new HttpError(403, 'O YouTube negou a permissão para esta ação. Vincule o canal novamente (em Meu canal) e aceite todas as permissões. Detalhe: ' + msg);
    if (/liveStreamingNotEnabled|live streaming/i.test(msg)) throw new HttpError(409, 'As transmissões ao vivo ainda não estão habilitadas no seu canal. Ative em studio.youtube.com > Criar > Transmitir ao vivo (pode levar até 24h na primeira vez).');
    throw new HttpError(502, 'YouTube: ' + msg);
  }
  return data;
}

function isoDur(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function mapVideo(v) {
  const st = v.statistics || {};
  const base = {
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
    comments: st.commentCount != null ? +st.commentCount : null,
    durationSec: isoDur(v.contentDetails?.duration)
  };
  const seo = seoChecklist(base);
  return { ...base, vph: vph(base), engagement: engagement(base), seoScore: seo.score, seoTodo: seo.checks.filter((c) => !c.ok).map((c) => c.item) };
}

export async function myChannel(db, user) {
  const token = await youtubeAccessToken(db, user);
  const ch = await yt(token, 'channels', { params: { part: 'snippet,statistics,contentDetails', mine: 'true' } });
  const c = ch.items?.[0];
  if (!c) throw new HttpError(404, 'Nenhum canal do YouTube encontrado nesta conta Google.');
  if (c.id) await db.run('UPDATE yt_tokens SET channel_id=?, channel_title=? WHERE user_id=?', [c.id, c.snippet?.title || null, user.id]);
  return { token, channel: c };
}

async function ownedVideo(db, user, videoId) {
  const { token, channel } = await myChannel(db, user);
  const r = await yt(token, 'videos', { params: { part: 'snippet,statistics,status,contentDetails', id: videoId } });
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
  return yt(token, UPLOAD + 'thumbnails/set', {
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
  DB = db;
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
          const vs = await yt(token, 'videos', { params: { part: 'snippet,statistics,status,contentDetails', id: ids.join(','), maxResults: 50 } });
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
    const status = statusForPrivacy(video.status, req.body?.privacy);
    if (status) body.status = status;
    const r = await yt(token, 'videos', { method: 'PUT', params: { part: status ? 'snippet,status' : 'snippet' }, body });
    await audit(db, req.user, 'youtube.video_update', videoId, body.snippet.title + (status ? ` (visibilidade: ${status.privacyStatus})` : ''));
    return mapVideo({ ...r, status: r.status || video.status, statistics: video.statistics });
  }));

  // ---------- Playlists do MEU canal ----------
  const myPlaylist = async (token, channel, playlistId) => {
    const r = await yt(token, 'playlists', { params: { part: 'snippet', id: playlistId } });
    const p = r.items?.[0];
    if (!p) throw new HttpError(404, 'Playlist não encontrada.');
    if (p.snippet?.channelId !== channel.id) throw new HttpError(403, 'Esta playlist não é do seu canal.');
    return p;
  };

  app.get('/api/channel/playlists', auth.required, async (req, res, next) => {
    try {
      const { token } = await myChannel(db, req.user);
      const r = await yt(token, 'playlists', { params: { part: 'snippet,contentDetails,status', mine: 'true', maxResults: 50 } });
      res.json({
        items: (r.items || []).map((p) => ({
          id: p.id, title: p.snippet?.title, description: p.snippet?.description || '', count: p.contentDetails?.itemCount || 0,
          privacy: p.status?.privacyStatus, thumb: p.snippet?.thumbnails?.medium?.url || p.snippet?.thumbnails?.default?.url || null
        }))
      });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/channel/playlists', auth.required, charged('playlist_create', async (req) => {
    const title = must(req.body?.title, 'nome da playlist', { max: 150 });
    const description = String(req.body?.description || '').slice(0, 5000);
    const privacy = ['public', 'unlisted', 'private'].includes(req.body?.privacy) ? req.body.privacy : 'public';
    const { token } = await myChannel(db, req.user);
    const r = await yt(token, 'playlists', { method: 'POST', params: { part: 'snippet,status' }, body: { snippet: { title, description }, status: { privacyStatus: privacy } } });
    await audit(db, req.user, 'youtube.playlist_create', r.id, title);
    return { id: r.id, title, privacy };
  }));

  app.get('/api/channel/playlists/:id/items', auth.required, async (req, res, next) => {
    try {
      const { token, channel } = await myChannel(db, req.user);
      await myPlaylist(token, channel, must(req.params.id, 'playlist', { max: 64 }));
      const r = await yt(token, 'playlistItems', { params: { part: 'snippet,contentDetails', playlistId: req.params.id, maxResults: 50 } });
      res.json({ items: (r.items || []).map((i) => ({ itemId: i.id, videoId: i.contentDetails?.videoId, title: i.snippet?.title, position: i.snippet?.position })) });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/channel/playlists/:id/items', auth.required, charged('playlist_add', async (req) => {
    const playlistId = must(req.params.id, 'playlist', { max: 64 });
    const videoId = must(req.body?.video_id, 'vídeo', { max: 20 });
    const { token, channel } = await myChannel(db, req.user);
    const p = await myPlaylist(token, channel, playlistId);
    const r = await yt(token, 'playlistItems', { method: 'POST', params: { part: 'snippet' }, body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } } });
    await audit(db, req.user, 'youtube.playlist_add', playlistId, videoId);
    return { itemId: r.id, playlist: p.snippet?.title, videoId };
  }));

  app.delete('/api/channel/playlists/:id/items/:itemId', auth.required, charged('playlist_add', async (req) => {
    const playlistId = must(req.params.id, 'playlist', { max: 64 });
    const itemId = must(req.params.itemId, 'item', { max: 120 });
    const { token, channel } = await myChannel(db, req.user);
    await myPlaylist(token, channel, playlistId);
    const it = await yt(token, 'playlistItems', { params: { part: 'snippet', id: itemId } });
    if (it.items?.[0]?.snippet?.playlistId !== playlistId) throw new HttpError(404, 'Este vídeo não está nesta playlist.');
    await yt(token, 'playlistItems', { method: 'DELETE', params: { id: itemId } });
    await audit(db, req.user, 'youtube.playlist_remove', playlistId, itemId);
    return { removed: itemId };
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

  studioRoutes(app, db, auth, charged);
}


// ---------- Studio: postar vídeo, live, analytics, comentários ----------
export function studioRoutes(app, db, auth, charged) {
  // 1) Postar vídeo: o servidor abre a sessão de upload "resumable" no YouTube com os
  //    metadados; o navegador envia os bytes DIRETO para o Google (sem passar pelo servidor).
  app.post('/api/channel/upload/start', auth.required, charged('video_upload', async (req) => {
    const title = must(req.body?.title, 'título', { max: 100 });
    const description = String(req.body?.description || '').slice(0, 5000);
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String).slice(0, 60) : [];
    const privacy = ['public', 'unlisted', 'private'].includes(req.body?.privacy) ? req.body.privacy : 'private';
    const publishAt = req.body?.publishAt ? new Date(req.body.publishAt) : null;
    if (publishAt && isNaN(publishAt.getTime())) throw new HttpError(400, 'Data de agendamento inválida.');
    const size = parseInt(req.body?.size, 10) || 0;
    const mime = String(req.body?.mime || 'video/*').slice(0, 60);
    const categoryId = String(req.body?.categoryId || '20').slice(0, 4); // 20 = Games, 22 = People & Blogs
    const { token } = await myChannel(db, req.user);
    const status = { privacyStatus: publishAt ? 'private' : privacy, selfDeclaredMadeForKids: false };
    if (publishAt) status.publishAt = publishAt.toISOString();
    const metadata = { snippet: { title, description, tags, categoryId, defaultLanguage: 'pt' }, status };
    let resp;
    try {
      resp = await fetch(UPLOAD + 'videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime,
          ...(size ? { 'X-Upload-Content-Length': String(size) } : {})
        },
        body: JSON.stringify(metadata)
      });
    } catch {
      throw new HttpError(502, 'Não foi possível iniciar o envio no YouTube.');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new HttpError(502, 'YouTube: ' + (data?.error?.message || `HTTP ${resp.status}`));
    }
    await countUnits(db, 1600); // videos.insert custa 1.600 unidades da cota diária
    const uploadUrl = resp.headers.get('location');
    if (!uploadUrl) throw new HttpError(502, 'O YouTube não devolveu a URL de envio.');
    await audit(db, req.user, 'youtube.upload_start', title, publishAt ? `agendado ${status.publishAt}` : privacy);
    return { uploadUrl, title, scheduled: !!publishAt, privacy: status.privacyStatus };
  }));

  app.post('/api/channel/upload/done', auth.required, async (req, res, next) => {
    try {
      const videoId = must(req.body?.videoId, 'vídeo', { max: 20 });
      await audit(db, req.user, 'youtube.upload_done', videoId);
      res.json({ ok: true, url: `https://www.youtube.com/watch?v=${videoId}`, studio: `https://studio.youtube.com/video/${videoId}/edit` });
    } catch (e) {
      next(e);
    }
  });

  // 2) Live: cria a transmissão + o stream RTMP e devolve a chave de transmissão.
  app.post('/api/channel/live', auth.required, charged('live_create', async (req) => {
    const title = must(req.body?.title, 'título', { max: 100 });
    const description = String(req.body?.description || '').slice(0, 5000);
    const privacy = ['public', 'unlisted', 'private'].includes(req.body?.privacy) ? req.body.privacy : 'public';
    const start = req.body?.scheduledStart ? new Date(req.body.scheduledStart) : new Date(Date.now() + 5 * 60000);
    if (isNaN(start.getTime())) throw new HttpError(400, 'Data de início inválida.');
    const { token } = await myChannel(db, req.user);
    const broadcast = await yt(token, 'liveBroadcasts', {
      method: 'POST',
      params: { part: 'snippet,status,contentDetails' },
      body: {
        snippet: { title, description, scheduledStartTime: start.toISOString() },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'normal' }
      }
    });
    const stream = await yt(token, 'liveStreams', {
      method: 'POST',
      params: { part: 'snippet,cdn,contentDetails' },
      body: { snippet: { title: `${title} (stream)` }, cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' }, contentDetails: { isReusable: true } }
    });
    await yt(token, 'liveBroadcasts/bind', { method: 'POST', params: { part: 'id,contentDetails', id: broadcast.id, streamId: stream.id } });
    await audit(db, req.user, 'youtube.live_create', broadcast.id, title);
    const ing = stream.cdn?.ingestionInfo || {};
    return {
      broadcastId: broadcast.id,
      watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
      studioUrl: `https://studio.youtube.com/video/${broadcast.id}/livestreaming`,
      rtmpUrl: ing.ingestionAddress || 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: ing.streamName || null,
      scheduledStart: start.toISOString(),
      aviso: 'Cole a URL RTMP e a chave de transmissão no OBS/Streamlabs. A chave dá acesso à sua live: não compartilhe.'
    };
  }));

  // 3) Analytics do canal (YouTube Analytics API): últimos N dias.
  app.get('/api/channel/analytics', auth.required, async (req, res, next) => {
    try {
      const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 28));
      const { token, channel } = await myChannel(db, req.user);
      const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const base = { ids: 'channel==MINE', startDate: fmt(start), endDate: fmt(end) };
      const daily = await yt(token, ANALYTICS + 'reports', { params: { ...base, metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes', dimensions: 'day', sort: 'day' } });
      const top = await yt(token, ANALYTICS + 'reports', { params: { ...base, metrics: 'views,estimatedMinutesWatched,averageViewDuration', dimensions: 'video', sort: '-views', maxResults: 10 } });
      const rows = daily.rows || [];
      const tot = rows.reduce((a, r) => ({ views: a.views + r[1], minutes: a.minutes + r[2], subs: a.subs + r[3] - r[4], likes: a.likes + r[5] }), { views: 0, minutes: 0, subs: 0, likes: 0 });
      let topVideos = (top.rows || []).map((r) => ({ id: r[0], views: r[1], minutes: r[2], avgSec: r[3] }));
      if (topVideos.length) {
        const vs = await yt(token, 'videos', { params: { part: 'snippet', id: topVideos.map((v) => v.id).join(',') } });
        const titles = Object.fromEntries((vs.items || []).map((v) => [v.id, v.snippet?.title]));
        topVideos = topVideos.map((v) => ({ ...v, title: titles[v.id] || v.id }));
      }
      res.json({ channel: { id: channel.id, title: channel.snippet?.title }, days, totals: tot, daily: rows.map((r) => ({ day: r[0], views: r[1], minutes: r[2], subsNet: r[3] - r[4], likes: r[5] })), topVideos });
    } catch (e) {
      next(e);
    }
  });

  // 4) Comentários recentes do canal + responder
  app.get('/api/channel/comments', auth.required, async (req, res, next) => {
    try {
      const { token, channel } = await myChannel(db, req.user);
      const r = await yt(token, 'commentThreads', { params: { part: 'snippet', allThreadsRelatedToChannelId: channel.id, maxResults: 30, order: 'time', textFormat: 'plainText' } });
      const items = (r.items || []).map((t) => {
        const c = t.snippet?.topLevelComment?.snippet || {};
        return { id: t.snippet?.topLevelComment?.id, videoId: t.snippet?.videoId, author: c.authorDisplayName, text: c.textDisplay, likes: c.likeCount, publishedAt: c.publishedAt, replies: t.snippet?.totalReplyCount || 0 };
      });
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/channel/comments/:id/reply', auth.required, charged('comment_reply', async (req) => {
    const parentId = must(req.params.id, 'comentário', { max: 80 });
    const text = must(req.body?.text, 'resposta', { max: 5000 });
    const { token } = await myChannel(db, req.user);
    const r = await yt(token, 'comments', { method: 'POST', params: { part: 'snippet' }, body: { snippet: { parentId, textOriginal: text } } });
    await audit(db, req.user, 'youtube.comment_reply', parentId);
    return { id: r.id, text };
  }));
}

function safeJson(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

/**
 * Monta o bloco "status" para mudar a visibilidade de um vídeo. O YouTube apaga os campos
 * de status que não forem reenviados num update, então todos os valores atuais são copiados.
 * Devolve null quando não há mudança de visibilidade.
 */
export function statusForPrivacy(current = {}, privacy) {
  const st = current || {};
  if (!['public', 'unlisted', 'private'].includes(privacy) || privacy === st.privacyStatus) return null;
  const out = { privacyStatus: privacy };
  for (const k of ['embeddable', 'license', 'publicStatsViewable', 'containsSyntheticMedia']) if (st[k] !== undefined) out[k] = st[k];
  const kids = st.selfDeclaredMadeForKids ?? st.madeForKids;
  if (kids !== undefined) out.selfDeclaredMadeForKids = kids;
  // agendamento só existe em vídeo privado; publicar agora (ou deixar não listado) cancela o agendamento
  if (privacy === 'private' && st.publishAt) out.publishAt = st.publishAt;
  return out;
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
