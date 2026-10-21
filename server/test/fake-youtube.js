// YouTube simulado para os testes automáticos das funções de "Meu canal".
// Imita as respostas da YouTube Data API v3 e da YouTube Analytics API v2 o
// suficiente para exercitar o código real do servidor (permissões, cobrança,
// estorno, montagem dos pedidos). Nada aqui é usado em produção.
import express from 'express';

export async function startFakeYouTube() {
  const TOKEN = 'tok-teste';
  const ME = 'UC_MEU', OTHER = 'UC_OUTRO';
  const log = []; // pedidos de escrita recebidos (para os testes conferirem)
  const thumb = (id) => ({ default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` }, medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } });
  const videos = {
    vidMeu00001: {
      id: 'vidMeu00001',
      snippet: { channelId: ME, title: 'Como vencer no bedwars', description: 'Descrição curta', tags: ['bedwars'], categoryId: '20', publishedAt: new Date(Date.now() - 48 * 3600e3).toISOString(), thumbnails: thumb('vidMeu00001') },
      statistics: { viewCount: '4800', likeCount: '300', commentCount: '40' },
      status: { privacyStatus: 'public', embeddable: true, license: 'youtube', publicStatsViewable: true, madeForKids: false, selfDeclaredMadeForKids: false },
      contentDetails: { duration: 'PT8M30S' }
    },
    vidMeu00002: {
      id: 'vidMeu00002',
      snippet: { channelId: ME, title: 'Vídeo agendado', description: '', tags: [], categoryId: '20', publishedAt: new Date().toISOString(), thumbnails: thumb('vidMeu00002') },
      statistics: { viewCount: '0', likeCount: '0', commentCount: '0' },
      status: { privacyStatus: 'private', publishAt: new Date(Date.now() + 86400e3).toISOString(), embeddable: false, license: 'creativeCommon', publicStatsViewable: false, madeForKids: false },
      contentDetails: { duration: 'PT45S' }
    },
    vidAlheio01: {
      id: 'vidAlheio01',
      snippet: { channelId: OTHER, title: 'Vídeo de outra pessoa', description: '', tags: [], categoryId: '24', publishedAt: new Date().toISOString(), thumbnails: thumb('vidAlheio01') },
      statistics: { viewCount: '999999' }, status: { privacyStatus: 'public' }, contentDetails: { duration: 'PT3M' }
    }
  };
  const playlists = {
    PL_MEU1: { id: 'PL_MEU1', snippet: { channelId: ME, title: 'Melhores momentos', description: '', thumbnails: thumb('vidMeu00001') }, status: { privacyStatus: 'public' } },
    PL_ALHEIA: { id: 'PL_ALHEIA', snippet: { channelId: OTHER, title: 'Playlist de outro canal' }, status: { privacyStatus: 'public' } }
  };
  const items = { UU_MEU: ['vidMeu00001', 'vidMeu00002'], PL_MEU1: ['vidMeu00001'], PL_ALHEIA: [] };
  let seq = 1;
  const itemId = (pl, vid) => `${pl}__${vid}`;
  const pick = (res, parts) => {
    const want = String(parts || '').split(',').map((s) => s.trim()).filter(Boolean);
    const out = { kind: res.kind, id: res.id };
    for (const p of want) if (res[p] !== undefined) out[p] = res[p];
    return out;
  };

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.raw({ type: ['image/*', 'application/octet-stream'], limit: '3mb' }));
  // Quadros públicos do vídeo (como i.ytimg.com): não precisam de login
  app.get('/vi/:id/:file', (req, res) => {
    const v = videos[req.params.id];
    if (!v || v.status.privacyStatus === 'private' || !/^(hq[123]|hqdefault|maxresdefault)\.jpg$/.test(req.params.file)) return res.status(404).end();
    res.type('image/jpeg').send(Buffer.alloc(3000, 7));
  });
  app.use((req, res, next) => {
    if (req.get('authorization') !== `Bearer ${TOKEN}`) return res.status(401).json({ error: { message: 'Invalid Credentials' } });
    next();
  });
  const y = express.Router();

  y.get('/channels', (req, res) => {
    if (req.query.mine !== 'true') return res.json({ items: [] });
    res.json({ items: [{ id: ME, snippet: { title: 'Canal do Teste', thumbnails: thumb('canal') }, statistics: { subscriberCount: '1234', viewCount: '56789', videoCount: '2', hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: 'UU_MEU' } } }] });
  });

  y.get('/search', (req, res) => {
    res.json({ items: Object.values(videos).filter((v) => v.status.privacyStatus === 'public').map((v) => ({ id: { kind: 'youtube#video', videoId: v.id } })) });
  });
  y.get('/videos', (req, res) => {
    if (req.query.chart) return res.json({ items: Object.values(videos).filter((v) => v.status.privacyStatus === 'public').map((v) => pick({ kind: 'youtube#video', ...v }, req.query.part)) });
    const ids = String(req.query.id || '').split(',').filter(Boolean);
    res.json({ items: ids.map((i) => videos[i]).filter(Boolean).map((v) => pick({ kind: 'youtube#video', ...v }, req.query.part)) });
  });
  y.put('/videos', (req, res) => {
    const v = videos[req.body?.id];
    if (!v) return res.status(404).json({ error: { message: 'videoNotFound' } });
    log.push({ op: 'videos.update', part: req.query.part, body: JSON.parse(JSON.stringify(req.body)) });
    if (req.body.snippet) v.snippet = { ...v.snippet, ...req.body.snippet };
    if (String(req.query.part).includes('status')) v.status = { ...req.body.status, madeForKids: req.body.status.selfDeclaredMadeForKids ?? v.status.madeForKids };
    res.json(pick({ kind: 'youtube#video', ...v }, req.query.part));
  });

  y.get('/playlistItems', (req, res) => {
    if (req.query.id) {
      const [pl, vid] = String(req.query.id).split('__');
      return res.json({ items: items[pl]?.includes(vid) ? [{ id: req.query.id, snippet: { playlistId: pl, title: videos[vid]?.snippet.title, position: items[pl].indexOf(vid) }, contentDetails: { videoId: vid } }] : [] });
    }
    const pl = String(req.query.playlistId || '');
    res.json({ items: (items[pl] || []).map((vid, i) => ({ id: itemId(pl, vid), snippet: { playlistId: pl, title: videos[vid]?.snippet.title || vid, position: i }, contentDetails: { videoId: vid } })) });
  });
  y.post('/playlistItems', (req, res) => {
    const pl = req.body?.snippet?.playlistId, vid = req.body?.snippet?.resourceId?.videoId;
    if (playlists[pl]?.snippet.channelId !== ME) return res.status(403).json({ error: { message: 'playlistItemsNotAccessible' } });
    log.push({ op: 'playlistItems.insert', pl, vid });
    items[pl].push(vid);
    res.json({ id: itemId(pl, vid), snippet: req.body.snippet });
  });
  y.delete('/playlistItems', (req, res) => {
    const [pl, vid] = String(req.query.id || '').split('__');
    log.push({ op: 'playlistItems.delete', pl, vid });
    items[pl] = (items[pl] || []).filter((x) => x !== vid);
    res.status(204).end();
  });

  y.get('/playlists', (req, res) => {
    const list = req.query.mine === 'true' ? Object.values(playlists).filter((p) => p.snippet.channelId === ME) : [playlists[req.query.id]].filter(Boolean);
    res.json({ items: list.map((p) => ({ ...p, contentDetails: { itemCount: (items[p.id] || []).length } })) });
  });
  y.post('/playlists', (req, res) => {
    const id = 'PL_NOVA' + seq++;
    playlists[id] = { id, snippet: { channelId: ME, ...req.body.snippet }, status: req.body.status };
    items[id] = [];
    log.push({ op: 'playlists.insert', id, body: req.body });
    res.json(playlists[id]);
  });

  y.get('/commentThreads', (req, res) => {
    res.json({ items: [{ id: 'th1', snippet: { videoId: 'vidMeu00001', totalReplyCount: 0, topLevelComment: { id: 'cm1', snippet: { authorDisplayName: 'Fã', textDisplay: 'Que vídeo top!', likeCount: 3, publishedAt: new Date().toISOString() } } } }] });
  });
  y.post('/comments', (req, res) => { log.push({ op: 'comments.insert', body: req.body }); res.json({ id: 'resp1', snippet: req.body.snippet }); });

  y.post('/liveBroadcasts', (req, res) => { log.push({ op: 'liveBroadcasts.insert', body: req.body }); res.json({ id: 'live12345ab', snippet: req.body.snippet }); });
  y.post('/liveStreams', (req, res) => res.json({ id: 'stream1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-efgh-ijkl' } } }));
  y.post('/liveBroadcasts/bind', (req, res) => res.json({ id: req.query.id, contentDetails: { boundStreamId: req.query.streamId } }));

  app.use('/youtube/v3', y);

  app.post('/upload/youtube/v3/thumbnails/set', (req, res) => {
    log.push({ op: 'thumbnails.set', videoId: req.query.videoId, bytes: req.body?.length || 0, type: req.get('content-type') });
    res.json({ items: [{ default: { url: 'https://i.ytimg.com/vi/x/default.jpg' } }] });
  });
  app.post('/upload/youtube/v3/videos', (req, res) => {
    log.push({ op: 'videos.insert(resumable)', body: req.body, size: req.get('x-upload-content-length') });
    res.set('Location', `https://upload.example.test/sessao/${seq++}`).status(200).end();
  });

  app.get('/youtubeanalytics/v2/reports', (req, res) => {
    if (req.query.dimensions === 'day') return res.json({ rows: [['2026-10-01', 100, 300, 5, 1, 10], ['2026-10-02', 50, 120, 2, 0, 4]] });
    res.json({ rows: [['vidMeu00001', 150, 420, 168]] });
  });

  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, token: TOKEN, log, videos, items, playlists, close: () => server.close() };
}
