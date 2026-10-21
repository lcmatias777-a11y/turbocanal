// TurboCanal no YouTube.
// REGRA PRINCIPAL: nunca existe tela de login. Tudo o que dá para calcular com os dados
// que a própria página do YouTube já carregou funciona sem conta e sem gastar créditos:
// VPH, outliers, nota de SEO, tags, ordenação, baixar capa, copiar dados.
// Só a IA e as ferramentas do servidor pedem conta, e aí é um botão dentro do painel.
(() => {
  if (document.documentElement.dataset.tcOn) return;
  document.documentElement.dataset.tcOn = chrome.runtime.getManifest().version;

  /* ---------------------------- utilidades ---------------------------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const clear = (el) => { while (el && el.firstChild) el.firstChild.remove(); return el; };
  const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR'));
  const dec = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d }));
  const short = (n) => {
    if (n == null) return '—';
    if (n >= 1e9) return dec(n / 1e9) + ' bi';
    if (n >= 1e6) return dec(n / 1e6) + ' mi';
    if (n >= 1e3) return dec(n / 1e3) + ' mil';
    return String(Math.round(n));
  };
  const hoursSince = (iso) => (iso ? Math.max(1, (Date.now() - new Date(iso).getTime()) / 3600e3) : null);
  const ageText = (iso) => {
    const hrs = hoursSince(iso);
    if (hrs == null) return '—';
    const d = hrs / 24;
    if (d < 1) return 'hoje';
    if (d < 60) return `há ${Math.round(d)} dia${Math.round(d) === 1 ? '' : 's'}`;
    if (d < 730) return `há ${Math.round(d / 30)} meses`;
    return `há ${Math.floor(d / 365)} anos`;
  };
  const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');

  /* ---------------------------- configuração e conta ---------------------------- */
  const S = { baseUrl: 'https://turbocanal.onrender.com', badges: true, painel: true };
  /** Nenhuma chamada ao Chrome pode travar a tela: tudo tem prazo e segue com o padrão. */
  const comPrazo = (promessa, ms, padrao) => Promise.race([
    Promise.resolve(promessa).catch(() => padrao),
    new Promise((ok) => setTimeout(() => ok(padrao), ms))
  ]);
  const PADRAO_URL = 'https://turbocanal.onrender.com';
  /** Endereço do site sem caminho nem "#": com "#" toda chamada cai na página inicial. */
  const limparUrl = (u) => {
    try {
      const x = new URL(String(u || '').trim());
      return /^https?:$/.test(x.protocol) ? x.origin : PADRAO_URL;
    } catch { return PADRAO_URL; }
  };
  async function loadCfg() {
    let c = {};
    try { c = (await comPrazo(chrome.storage.sync.get(['baseUrl', 'tc_badges', 'tc_autopanel']), 1500, {})) || {}; } catch {}
    S.baseUrl = limparUrl(c.baseUrl || PADRAO_URL);
    if (c.baseUrl && c.baseUrl !== S.baseUrl) { try { chrome.storage.sync.set({ baseUrl: S.baseUrl }); } catch {} }
    S.badges = c.tc_badges !== false;
    S.painel = c.tc_autopanel !== false;
    // fica visível na página para dar para diagnosticar sem abrir o Chrome por dentro
    try { document.documentElement.dataset.tcCfg = JSON.stringify(S); } catch {}
    if (typeof anotar === 'function') anotar();
  }
  const site = (hash) => S.baseUrl + '/#/' + hash;
  /** A sessão vem do armazenamento da extensão, que o próprio site preenche quando você
   *  entra nele (site-token.js). Assim o painel não depende do service worker do Chrome,
   *  que às vezes dorme e não acorda. O service worker fica só como reserva. */
  const diag = { versao: chrome.runtime?.getManifest?.()?.version || '?', sessao: 'ainda nao olhei', conta: '-' };
  const anotar = () => { try { document.documentElement.dataset.tcCfg = JSON.stringify({ ...S, ...diag }); } catch {} };
  async function token() {
    try {
      const c = await comPrazo(chrome.storage.local.get(['tc_token']), 1500, null);
      if (c && c.tc_token) { diag.sessao = 'guardada pelo site'; anotar(); return c.tc_token; }
      diag.sessao = c ? 'armazenamento vazio' : 'armazenamento nao respondeu';
    } catch (e) { diag.sessao = 'erro no armazenamento: ' + (e?.message || e); }
    const r = await comPrazo(chrome.runtime.sendMessage({ type: 'getToken' }), 2500, null);
    if (r && r.token) { diag.sessao = 'veio do service worker'; anotar(); return r.token; }
    diag.sessao += r ? ' / service worker sem sessao' : ' / service worker nao respondeu';
    anotar();
    return '';
  }
  async function esqueceToken() {
    ME = null; MEtried = false;
    try { await chrome.storage.local.remove(['tc_token']); } catch {}
  }
  async function api(path, { method = 'GET', body, timeout = 120000 } = {}) {
    const t = await token();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    let r;
    try {
      r = await fetch(S.baseUrl + '/api' + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
    } catch (e) {
      const err = new Error(e.name === 'AbortError' ? 'O site demorou demais para responder. Tente de novo.' : 'Não consegui falar com o TurboCanal agora.');
      err.status = 0;
      throw err;
    } finally { clearTimeout(to); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) esqueceToken();
    if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return data;
  }
  let ME = null, MEtried = false;
  async function me() {
    if (MEtried) return ME;
    MEtried = true;
    if (!(await token())) { diag.conta = 'sem sessao'; anotar(); return (ME = null); }
    try { ME = (await api('/me', { timeout: 20000 })).user; diag.conta = 'ok: ' + (ME?.email || '?'); }
    catch (e) { ME = null; diag.conta = 'falhou (' + (e.status ?? '?') + '): ' + e.message; }
    anotar();
    return ME;
  }
  let COSTS = null;
  async function cost(tool) {
    if (!COSTS) { try { COSTS = (await api('/tools/costs', { timeout: 20000 })).costs; } catch { COSTS = []; } }
    const c = COSTS.find((x) => x.tool === tool);
    return c ? (ME?.unlimited ? 'incluído' : `${fmt(c.cost)} créditos`) : '';
  }
  /** Link de verdade (<a target="_blank">): funciona nem que o service worker esteja parado,
   *  e ainda deixa abrir com o botão do meio ou com Ctrl+clique. */
  const linkCru = (url, label, cls = 'tc-btn') => h('a', { class: cls, href: url, target: '_blank', rel: 'noopener' }, label);
  const btnLink = (hash, label, cls = 'tc-btn') => linkCru(site(hash), label, cls);
  const openSite = (hash) => { try { window.open(site(hash), '_blank', 'noopener'); } catch { location.href = site(hash); } };
  const creditLine = (c) => (!c ? '' : c.unlimited ? 'Conta de administrador: sem consumo de créditos.' : c.reused ? 'Já analisado: nada cobrado de novo.' : c.charged === 1 ? 'Usado 1 crédito.' : `Usados ${fmt(c.charged)} créditos.`);
  function copyBtn(label, getText, cls = 'tc-btn tc-sec2') {
    const b = h('button', { class: cls, type: 'button' }, label);
    b.onclick = async () => {
      const old = b.textContent;
      try { await navigator.clipboard.writeText(await getText()); b.textContent = '✅ copiado'; }
      catch { b.textContent = '❌ não deu'; }
      setTimeout(() => (b.textContent = old), 1800);
    };
    return b;
  }
  /** Caixa discreta para o que precisa de conta. NUNCA uma tela inteira de login. */
  function precisaConta(oQue) {
    return h('div', { class: 'tc-need' },
      h('div', null, `🔒 ${oQue} precisa da sua conta do TurboCanal.`),
      h('div', { class: 'tc-actions' },
        linkCru(S.baseUrl + '/api/auth/google', '🔵 Entrar com Google'),
        h('button', { class: 'tc-btn tc-sec2', type: 'button', onclick: () => { MEtried = false; ME = null; refreshPanel(); } }, '🔄 Já entrei')),
      h('div', { class: 'tc-muted' }, 'Depois de entrar no site, o painel reconhece sozinho (pode fechar a aba). O resto funciona sem conta.'));
  }
  const errBox = (e) => h('div', { class: 'tc-err' }, e.message,
    e.status === 401 ? h('div', { class: 'tc-muted' }, 'Sessão expirada: entre de novo no site.') : null,
    e.status === 402 ? h('div', null, btnLink('planos', 'Ver planos', 'tc-btn tc-sec2')) : null,
    e.status === 409 ? h('div', { class: 'tc-muted' }, 'Nenhum crédito foi cobrado.') : null);

  /* ---------------------------- dados da página ---------------------------- */
  const videoIdOf = (u = location.href) => {
    const m = String(u).match(/[?&]v=([A-Za-z0-9_-]{11})|\/shorts\/([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] || m[3] : null;
  };
  /** Dados que o próprio YouTube carregou (title, tags, views, duração, canal). */
  function pageVideo() {
    const vid = videoIdOf();
    try {
      const raw = document.documentElement.dataset.tcVideo;
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.id === vid) return d;
      }
    } catch {}
    return videoDoDOM(vid);
  }
  /** Nos Shorts (e quando o YouTube troca de vídeo sem recarregar) os dados do player
   *  ficam no vídeo antigo. Aí montamos o básico com o que está escrito na tela. */
  function videoDoDOM(vid) {
    if (!vid) return null;
    const ehShort = location.pathname.startsWith('/shorts/');
    const tit = document.querySelector(ehShort
      ? 'ytd-reel-video-renderer[is-active] yt-shorts-video-title-view-model, #shorts-inner-container h2, yt-shorts-video-title-view-model'
      : '#above-the-fold #title h1, h1.ytd-watch-metadata, #title h1');
    const titulo = (tit?.textContent || document.title.replace(/ - YouTube$/, '') || '').trim();
    if (!titulo) return null;
    const area = document.querySelector(ehShort ? 'ytd-reel-video-renderer[is-active]' : '#above-the-fold') || document.body;
    const views = parseViews(area.innerText || '') ?? digits((area.innerText || '').match(/([\d.,]+)\s*(?:mil|mi|bi)?\s*visualizaç/i)?.[0]);
    const vd = document.querySelector('video');
    const canal = (document.querySelector(ehShort ? 'ytd-reel-video-renderer[is-active] #channel-name a, yt-reel-channel-bar-view-model a' : '#owner #channel-name a, ytd-channel-name a')?.textContent || '').trim();
    return {
      id: vid, title: titulo, description: '', tags: [],
      views: views ?? 0, durationSec: Math.round(vd?.duration || 0),
      channel: canal, channelId: '', publishedAt: null, category: null, live: false, parcial: true
    };
  }
  const digits = (s) => {
    const m = String(s || '').replace(/ /g, ' ').match(/[\d][\d.,\s]*/);
    if (!m) return null;
    const n = parseInt(m[0].replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  /** Likes e comentários: o YouTube só mostra no DOM, então lemos de lá (sem rede).
   *  Esses botões aparecem depois do resto da página, por isso o painel relê mais tarde. */
  function pageEngagement() {
    let likes = null, comments = null;
    for (const sel of ['like-button-view-model button', 'segmented-like-dislike-button-view-model button', 'ytd-menu-renderer like-button-view-model button', '#top-level-buttons-computed button']) {
      const el = document.querySelector(sel);
      const n = digits(el?.getAttribute('aria-label')) ?? digits(el?.textContent);
      if (n != null) { likes = n; break; }
    }
    for (const el of document.querySelectorAll('ytd-comments-header-renderer #count, ytd-comments-header-renderer h2, #comments #count')) {
      const t = (el.innerText || el.textContent || '');
      if (!/coment/i.test(t)) continue;
      const n = digits(t);
      if (n != null) { comments = n; break; }
    }
    return { likes, comments };
  }

  /* ---------------------------- SEO calculado aqui ---------------------------- */
  function seoLocal(v, eng) {
    const checks = [];
    const add = (item, ok, dica) => checks.push({ item, ok: !!ok, dica });
    const t = v.title || '', d = v.description || '', tags = v.tags || [];
    add('Título entre 20 e 70 caracteres', t.length >= 20 && t.length <= 70, `Está com ${t.length}. Nessa faixa o título aparece inteiro na busca e no feed.`);
    add('Título com número ou colchete', /\d|\[|\(/.test(t), 'Números e marcadores costumam aumentar o clique. Teste no seu nicho.');
    add('Descrição com 200+ caracteres', d.length >= 200, `Está com ${d.length}. Use as 2 primeiras linhas para a promessa do vídeo.`);
    add('Descrição com link ou capítulo', /https?:\/\/|\n\s*0?0:00/.test(d), 'Capítulos (00:00) ajudam a navegação e a retenção.');
    add('Pelo menos 8 tags', tags.length >= 8, `Tem ${tags.length}. Use variações da palavra-chave principal.`);
    add('Duração acima de 3 minutos', (v.durationSec || 0) >= 180, 'Fora dos Shorts, vídeos muito curtos limitam o tempo de exibição.');
    if (eng.likes != null && v.views > 0) add('Engajamento (likes/views) acima de 2%', eng.likes / v.views >= 0.02, 'Peça a curtida no começo e no meio, não só no fim.');
    const ok = checks.filter((c) => c.ok).length;
    return { score: Math.round((ok / checks.length) * 100), checks };
  }

  /* ---------------------------- painel do vídeo ---------------------------- */
  let painelVid = null, painelAba = 'Vídeo', engTimer = null;
  function shell(floating) {
    let p = document.getElementById('tc-panel');
    if (p) return p;
    const host = floating ? document.body : document.querySelector('#secondary-inner') || document.querySelector('#secondary') || document.body;
    p = h('div', { id: 'tc-panel', class: host === document.body ? 'tc-floating' : 'tc-inline' });
    host.prepend(p);
    return p;
  }
  function head(p, extra) {
    return h('div', { class: 'tc-head' },
      h('span', null, '🚀 Turbo', h('b', null, 'Canal')),
      h('span', { class: 'tc-head-right' }, extra || null,
        h('button', { class: 'tc-close', title: 'Minimizar', onclick: () => p.classList.toggle('tc-min') }, '—'),
        h('button', { class: 'tc-close', title: 'Fechar', onclick: () => { p.remove(); painelVid = '__x' + videoIdOf(); } }, '✕')));
  }
  function refreshPanel() { painelVid = null; watchPanel({ floating: location.pathname.startsWith('/shorts/') }); }

  async function watchPanel({ floating = false, force = false } = {}) {
    const vid = videoIdOf();
    if (!vid || (!S.painel && !force)) return;
    if (painelVid === '__x' + vid) return;
    if (painelVid === vid && document.getElementById('tc-panel')) return;
    const v = pageVideo();
    if (!v) return; // os dados da página ainda não chegaram
    painelVid = vid;
    const p = shell(floating);
    clear(p);
    const eng = pageEngagement();
    // O painel aparece JÁ, com o que a página tem. A conta chega depois e só completa.
    const credits = h('span', { class: 'tc-credits' }, '');
    p.append(head(p, credits));
    const tabsBar = h('div', { class: 'tc-tabs' });
    const pane = h('div', { class: 'tc-pane' });
    const body = h('div', { class: 'tc-body' }, tabsBar, pane);
    p.append(body);
    const abas = {
      'Vídeo': () => abaVideo(v, eng, vid),
      'SEO': () => abaSeo(v, eng),
      'Canal': () => abaCanal(v, vid),
      'IA': () => abaIA(vid)
    };
    const show = (nome) => {
      painelAba = nome;
      for (const b of tabsBar.children) b.classList.toggle('on', b.textContent === nome);
      clear(pane).append(abas[nome]());
    };
    for (const nome of Object.keys(abas)) tabsBar.append(h('button', { class: 'tc-tab', type: 'button', onclick: () => show(nome) }, nome));
    show(abas[painelAba] ? painelAba : 'Vídeo');

    // A conta é descoberta em paralelo: se existir, mostra o saldo e refaz a aba que precisa dela.
    me().then((user) => {
      if (!p.isConnected) return;
      credits.textContent = user ? '💎 ' + (user.unlimited ? '∞' : fmt(user.credits)) : '';
      if (user && (painelAba === 'Canal' || painelAba === 'IA')) show(painelAba);
    }).catch(() => {});

    // Likes e comentários entram na página depois do resto: quando chegarem, refaz a aba.
    clearInterval(engTimer);
    let antes = JSON.stringify(eng), voltas = 0;
    engTimer = setInterval(() => {
      if (!p.isConnected || ++voltas > 20) { clearInterval(engTimer); return; }
      const agora = pageEngagement();
      if (JSON.stringify(agora) === antes) return;
      antes = JSON.stringify(agora);
      eng.likes = agora.likes;
      eng.comments = agora.comments;
      if (painelAba === 'Vídeo' || painelAba === 'SEO') show(painelAba);
    }, 1500);
  }

  /** No vídeo, o lugar certo é em cima dos vídeos relacionados. Essa coluna às vezes
   *  só existe depois que o painel já abriu, então trazemos o painel para lá quando ela chega. */
  function ajustarLugar() {
    const p = document.getElementById('tc-panel');
    if (!p || !p.classList.contains('tc-floating') || location.pathname !== '/watch') return;
    const col = document.querySelector('#secondary-inner') || document.querySelector('#secondary');
    if (!col || col.contains(p)) return;
    col.prepend(p);
    p.classList.remove('tc-floating');
    p.classList.add('tc-inline');
  }

  const stat = (label, valor, title) => h('div', { class: 'tc-stat', title: title || null }, h('span', { class: 'tc-stat-l' }, label), h('b', null, valor));

  function abaVideo(v, eng, vid) {
    const hrs = hoursSince(v.publishedAt);
    const vph = hrs ? v.views / hrs : null;
    const engPct = eng.likes != null && v.views ? ((eng.likes + (eng.comments || 0)) / v.views) * 100 : null;
    return h('div', null,
      h('div', { class: 'tc-grid' },
        stat('👁 Views', fmt(v.views)),
        stat('⚡ VPH', vph != null ? short(vph) + '/h' : '—', 'Views por hora desde a publicação'),
        stat('👍 Likes', fmt(eng.likes)),
        stat('💬 Comentários', fmt(eng.comments)),
        stat('📊 Engajamento', engPct != null ? dec(engPct, 2) + '%' : '—', '(likes + comentários) ÷ views'),
        stat('⏱ Duração', mmss(v.durationSec)),
        stat('📅 Publicado', ageText(v.publishedAt)),
        stat('📺 Canal', v.channel || '—')),
      h('p', { class: 'tc-muted' }, v.parcial
        ? 'Lido da tela deste Short. Descrição e tags não aparecem aqui: use a aba Canal ou abra o vídeo normal.'
        : 'Calculado aqui no seu navegador, com os dados desta página. Não gasta créditos.'),
      h('div', { class: 'tc-actions' },
        h('a', { class: 'tc-btn tc-sec2', href: `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`, target: '_blank', rel: 'noopener', download: `capa-${vid}.jpg` }, '🖼️ Baixar a capa'),
        copyBtn('📋 Copiar título, descrição e tags', () => `TÍTULO\n${v.title}\n\nDESCRIÇÃO\n${v.description}\n\nTAGS\n${(v.tags || []).join(', ')}`),
        copyBtn('🔗 Copiar incorporação', () => {
          const t = Math.floor(document.querySelector('video')?.currentTime || 0);
          return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${vid}${t > 2 ? '?start=' + t : ''}" title="YouTube" frameborder="0" allowfullscreen></iframe>`;
        })),
      h('div', { class: 'tc-actions' },
        btnLink('ferramentas/insights?video=' + vid, '✨ IA do vídeo'),
        btnLink('ferramentas/transformar?video=' + vid + '&mode=shorts', '✂️ 3 cortes'),
        btnLink('canal', '📺 Meu canal', 'tc-btn tc-sec2')));
  }

  function abaSeo(v, eng) {
    if (v.parcial) {
      return h('div', null,
        h('p', { class: 'tc-muted' }, 'A nota de SEO precisa da descrição e das tags, e esta tela do YouTube não mostra isso.'),
        h('div', { class: 'tc-actions' }, linkCru('https://www.youtube.com/watch?v=' + v.id, '▶️ Abrir este vídeo na página normal', 'tc-btn tc-sec2')));
    }
    const s = seoLocal(v, eng);
    const tags = v.tags || [];
    const lower = (x) => String(x).toLowerCase();
    const noTitulo = new Set(tags.filter((t) => lower(v.title).includes(lower(t))).map(lower));
    const naDesc = new Set(tags.filter((t) => lower(v.description).includes(lower(t))).map(lower));
    return h('div', null,
      h('div', { class: 'tc-score' },
        h('div', { class: 'tc-score-n' + (s.score >= 80 ? ' good' : s.score >= 50 ? '' : ' bad') }, String(s.score)),
        h('div', null, h('b', null, 'Pontuação de SEO'), h('div', { class: 'tc-muted' }, 'heurística TurboCanal (0 a 100), calculada aqui'))),
      h('div', { class: 'tc-sec' }, s.checks.map((c) => h('div', { class: 'tc-check' }, (c.ok ? '✅ ' : '⚠️ ') + c.item, !c.ok ? h('div', { class: 'tc-muted' }, c.dica) : null))),
      tags.length
        ? h('div', { class: 'tc-sec' },
          h('b', null, `Tags do vídeo (${tags.length}) `),
          copyBtn('copiar todas', () => tags.join(', '), 'tc-mini'),
          h('div', { class: 'tc-muted' }, '★ está no título · ▲ está na descrição · clique para pesquisar'),
          h('div', { class: 'tc-tags' }, tags.map((t) => h('a', {
            href: '/results?search_query=' + encodeURIComponent(t),
            class: noTitulo.has(lower(t)) ? 'star' : ''
          }, (noTitulo.has(lower(t)) ? '★ ' : '') + (naDesc.has(lower(t)) ? '▲ ' : '') + t))))
        : h('p', { class: 'tc-muted' }, 'Este vídeo não tem tags públicas.'));
  }

  function abaCanal(v, vid) {
    const box = h('div');
    if (!ME) {
      box.append(
        h('p', { class: 'tc-muted' }, 'Com a conta ligada, aqui aparecem: inscritos, idade do canal, tags do canal, a mediana de views dos últimos vídeos e o quanto ESTE vídeo está acima ou abaixo do normal do canal (outlier).'),
        precisaConta('Ver os dados do canal'));
      return box;
    }
    box.append(h('p', { class: 'tc-muted' }, 'Carregando os dados do canal…'));
    (async () => {
      try {
        const r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } });
        const ch = r.result.channel, out = r.result.outlierCanal;
        if (!ch) { clear(box).append(h('p', { class: 'tc-muted' }, 'Não consegui carregar o canal agora.')); return; }
        const anos = ch.publishedAt ? (Date.now() - new Date(ch.publishedAt).getTime()) / (365 * 86400e3) : null;
        const msg = h('div');
        const add = h('button', { class: 'tc-btn', type: 'button' }, '🏆 Adicionar aos concorrentes');
        cost('competitor_check').then((c) => (add.textContent = `🏆 Adicionar aos concorrentes (${c})`));
        add.onclick = async () => {
          add.disabled = true;
          clear(msg).append(h('span', { class: 'tc-muted' }, 'Adicionando…'));
          try {
            const x = await api('/competitors', { method: 'POST', body: { channel: ch.id } });
            clear(msg).append(h('p', { class: 'tc-ok' }, '✅ Adicionado aos seus concorrentes.'), h('p', { class: 'tc-muted' }, creditLine(x.credits)));
          } catch (e) { clear(msg).append(errBox(e)); add.disabled = false; }
        };
        clear(box).append(
          h('div', { class: 'tc-chan' }, ch.thumb ? h('img', { src: ch.thumb, alt: '' }) : null,
            h('div', null, h('b', null, ch.title || v.channel), h('div', { class: 'tc-muted' }, [ch.handle, anos != null ? (anos >= 1 ? `${Math.floor(anos)} ano${Math.floor(anos) === 1 ? '' : 's'} no YouTube` : 'canal novo') : null].filter(Boolean).join(' · ')))),
          h('div', { class: 'tc-grid' },
            stat('👥 Inscritos', ch.subs == null ? 'ocultos' : short(ch.subs)),
            stat('👁 Views totais', short(ch.views)),
            stat('🎬 Vídeos', fmt(ch.videos)),
            stat('📈 Mediana recente', ch.medianRecentViews != null ? short(ch.medianRecentViews) : '—', `Mediana dos últimos ${ch.recentCount || ''} vídeos`),
            stat('🔥 Outlier', out != null ? dec(out) + 'x' : '—', 'Views deste vídeo ÷ mediana do canal')),
          out != null ? h('p', { class: out >= 2 ? 'tc-ok' : 'tc-muted' }, out >= 2 ? `🔥 Este vídeo está ${dec(out)}x acima do normal do canal.` : out < 0.7 ? 'Este vídeo está abaixo do normal do canal.' : 'Este vídeo está na média do canal.') : null,
          ch.keywords?.length ? h('div', { class: 'tc-sec' }, h('b', null, 'Tags do canal '), copyBtn('copiar', () => ch.keywords.join(', '), 'tc-mini'), h('div', { class: 'tc-tags' }, ch.keywords.map((k) => h('span', null, k)))) : null,
          h('div', { class: 'tc-actions' }, add),
          msg,
          h('p', { class: 'tc-muted' }, creditLine(r.credits)));
      } catch (e) { clear(box).append(errBox(e)); }
    })();
    return box;
  }

  function abaIA(vid) {
    const box = h('div');
    const topo = h('p', { class: 'tc-muted' }, 'A IA assiste a este vídeo e responde: resumo, nota do gancho (começo do vídeo), por que foi bem ou mal, 3 ideias parecidas para o seu canal e dicas para ganhar inscritos.');
    if (!ME) { box.append(topo, precisaConta('A análise da IA')); return box; }
    const b = h('button', { class: 'tc-btn', type: 'button' }, '🤖 Pedir a análise da IA');
    cost('coach_ai').then((c) => (b.textContent = `🤖 Pedir a análise da IA (${c})`));
    const out = h('div');
    b.onclick = async () => {
      b.disabled = true;
      clear(out).append(h('p', { class: 'tc-muted' }, '⏳ A IA está assistindo ao vídeo. Pode levar de 20 segundos a 2 minutos.'));
      try {
        const r = await api('/tools/coach_ai', { method: 'POST', body: { video: vid } });
        const x = r.result;
        clear(out).append(
          h('div', { class: 'tc-sec' }, h('b', null, '📝 Resumo'), h('p', null, x.resumo)),
          h('div', { class: 'tc-sec' }, h('b', null, `🎣 Gancho: ${x.gancho.nota}/10`), h('p', null, x.gancho.analise), x.gancho.sugestao ? h('p', { class: 'tc-muted' }, '💡 ' + x.gancho.sugestao) : null),
          h('div', { class: 'tc-sec' }, h('b', null, '📊 Desempenho: ' + (x.desempenho.veredito || '')), h('p', null, x.desempenho.porque)),
          h('div', { class: 'tc-sec' }, h('b', null, '💡 3 ideias parecidas'), x.ideias.map((i) => h('div', { class: 'tc-check' }, '• ' + i.titulo, h('span', null, ' '), h('button', { class: 'tc-mini', type: 'button', onclick: () => openSite('ferramentas/preparar?topic=' + encodeURIComponent(i.titulo)) }, 'preparar'), i.porque ? h('div', { class: 'tc-muted' }, i.porque) : null))),
          h('div', { class: 'tc-sec' }, h('b', null, '👥 Para ganhar inscritos'), x.inscritos.map((d) => h('div', { class: 'tc-check' }, '• ' + d))),
          h('p', { class: 'tc-muted' }, x.aviso + ' ' + creditLine(r.credits)));
      } catch (e) { clear(out).append(errBox(e)); }
      b.disabled = false;
    };
    box.append(topo, h('div', { class: 'tc-actions' }, b), out);
    return box;
  }

  /* ---------------------------- VPH e outlier nas miniaturas ---------------------------- */
  const CONTAINERS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-playlist-video-renderer';
  const reg = new Map(); // elemento -> { views, hours, badge, titulo, ordem }
  const UNI = { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6, bi: 1e9, b: 1e9 };
  function numero(num, u) {
    u = (u || '').toLowerCase();
    num = u ? num.replace(',', '.') : num.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
    const v = parseFloat(num);
    return isFinite(v) ? Math.round(v * (UNI[u] || 1)) : null;
  }
  /** Lê as views da miniatura. O YouTube hoje usa dois formatos:
   *  "1,2 mi de visualizações" (com rótulo) e "4,5 mil há 2 h" (feed e busca, sem rótulo). */
  function parseViews(txt) {
    const t = String(txt).replace(/\u00a0/g, ' ');
    let m = t.match(/([\d][\d.,]*)\s*(mil|mi|bi|k|m|b)?\s*(?:de\s+)?(?:visualizaç(?:ão|ões)|views?)\b/i);
    if (m) return numero(m[1], m[2]);
    m = t.match(/([\d][\d.,]*)\s*(mil|mi|bi|k|m|b)?\s*[·•]?\s*(?:há|faz)\s+\d/i);
    if (m) return numero(m[1], m[2]);
    m = t.match(/([\d][\d.,]*)\s*(mil|mi|bi|k|m|b)?\s*[·•]?\s*(?=\d+\s*(?:minute|hour|day|week|month|year)s?\s+ago)/i);
    if (m) return numero(m[1], m[2]);
    return null;
  }
  function parseAgeHours(txt) {
    const t = String(txt).replace(/\u00a0/g, ' ').toLowerCase();
    if (/assistindo|watching now|ao vivo|live now|programad|scheduled|estreia|premieres/.test(t)) return null;
    const m = t.match(/h[áa]\s+(\d+)\s*(minutos?|min|horas?|h|dias?|d|semanas?|sem|m[eê]s(?:es)?|meses|anos?)\b/)
      || t.match(/(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)\s+ago/);
    if (!m) return null;
    const n = parseInt(m[1], 10), u = m[2];
    const f = /^min/.test(u) ? 1 / 60
      : /^h/.test(u) ? 1
      : /^d/.test(u) ? 24
      : /^sem|^week/.test(u) ? 168
      : /^m[eê]s|^meses|^month/.test(u) ? 730
      : 8760;
    return Math.max(1, n * f);
  }
  function thumbAnchor(el) {
    for (const a of el.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')) {
      if (a.querySelector('img, yt-image, yt-thumbnail-view-model, ytd-thumbnail')) return a;
    }
    return el.querySelector('a#thumbnail') || el.querySelector('a[href*="/watch?v="]') || null;
  }
  function scanBadges() {
    if (!S.badges) return;
    for (const el of document.querySelectorAll(CONTAINERS)) {
      if (reg.has(el) || el.querySelector(CONTAINERS) || el.closest('#tc-panel')) continue;
      const meta = el.querySelector('ytd-video-meta-block, yt-content-metadata-view-model, .yt-content-metadata-view-model-wiz');
      const txt = (meta && meta.innerText) || el.innerText || el.textContent || '';
      const views = parseViews(txt), hours = parseAgeHours(txt);
      if (views == null || hours == null) continue;
      const a = thumbAnchor(el);
      if (!a) continue;
      const cs = getComputedStyle(a);
      if (cs.position === 'static') a.style.position = 'relative';
      if (cs.display === 'inline') a.style.display = 'inline-block';
      const badge = h('div', { class: 'tc-badge' });
      const titulo = (el.querySelector('#video-title, h3, .yt-lockup-metadata-view-model__title')?.textContent || '').trim().slice(0, 120);
      const ideia = h('button', { class: 'tc-remix', type: 'button', title: 'Usar esta ideia no Preparar publicação', onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openSite('ferramentas/preparar?topic=' + encodeURIComponent(titulo)); } }, '💡');
      a.append(badge, ideia);
      reg.set(el, { views, hours, badge, titulo, ordem: reg.size });
    }
    for (const [el] of reg) if (!el.isConnected) reg.delete(el);
    const vs = [...reg.values()].map((r) => r.views).sort((a, b) => a - b);
    const mediana = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
    for (const r of reg.values()) {
      const vph = r.views / r.hours;
      const out = mediana > 0 && vs.length >= 4 ? r.views / mediana : null;
      r.badge.textContent = `⚡ ${short(vph)}/h` + (out != null ? ` · ${out >= 2 ? '🔥 ' : ''}${dec(out)}x` : '');
      r.badge.classList.toggle('hot', out != null && out >= 2);
      r.badge.title = `VPH: ${fmt(Math.round(vph))} views por hora desde a publicação` + (out != null ? `\nOutlier: ${dec(out)}x a mediana dos ${vs.length} vídeos desta página` : '') + '\nTurboCanal, calculado nesta página, sem gastar créditos';
    }
  }
  function removeBadges() {
    for (const r of reg.values()) { r.badge.remove(); }
    for (const b of document.querySelectorAll('.tc-remix')) b.remove();
    reg.clear();
  }
  function sortItems(modo) {
    const grupos = new Map();
    for (const [el, r] of reg) {
      if (!el.isConnected || !el.parentElement) continue;
      if (!grupos.has(el.parentElement)) grupos.set(el.parentElement, []);
      grupos.get(el.parentElement).push({ el, r });
    }
    const vs = [...reg.values()].map((r) => r.views).sort((a, b) => a - b);
    const mediana = vs.length ? vs[Math.floor(vs.length / 2)] : 1;
    const chave = { views: (r) => r.views, vph: (r) => r.views / r.hours, outlier: (r) => r.views / Math.max(1, mediana), novos: (r) => -r.hours }[modo];
    for (const [pai, itens] of grupos) {
      itens.sort(modo === 'padrao' ? (a, b) => a.r.ordem - b.r.ordem : (a, b) => chave(b.r) - chave(a.r));
      for (const i of itens) pai.append(i.el);
    }
  }
  function sortBar() {
    const bar = h('div', { class: 'tc-sort' }, h('span', { class: 'tc-muted' }, 'Ordenar: '));
    for (const [m, l] of [['views', '👁 Mais vistos'], ['vph', '⚡ Melhor VPH'], ['outlier', '🔥 Outliers'], ['novos', '🆕 Mais novos'], ['padrao', '↩️ Padrão']]) {
      bar.append(h('button', { class: 'tc-mini', type: 'button', onclick: () => sortItems(m) }, l));
    }
    return bar;
  }

  /* ---------------------------- busca ---------------------------- */
  let buscaQ = null;
  function searchPanel() {
    const q = new URLSearchParams(location.search).get('search_query');
    if (!q) return;
    let box = document.getElementById('tc-search');
    if (box && buscaQ === q && box.isConnected) { updateSearch(box, q); return; }
    const host = document.querySelector('ytd-search ytd-section-list-renderer #contents') || document.querySelector('ytd-search #contents');
    if (!host) return;
    box?.remove();
    buscaQ = q;
    box = h('div', { id: 'tc-search' },
      h('div', { class: 'tc-head' },
        h('span', null, '🚀 Turbo', h('b', null, 'Canal'), h('span', { class: 'tc-muted' }, ' · busca: ' + q)),
        h('button', { class: 'tc-close', title: 'Fechar', onclick: () => box.remove() }, '✕')),
      h('div', { class: 'tc-body' },
        h('div', { id: 'tc-kscore' }),
        h('div', { class: 'tc-grid', id: 'tc-sstats' }),
        h('p', { class: 'tc-muted' }, 'Calculado com os resultados que estão na tela, sem gastar créditos.'),
        sortBar(),
        h('div', { class: 'tc-actions' },
          h('button', { class: 'tc-btn', type: 'button', id: 'tc-kwgo' }, '🔑 Termos relacionados'),
          h('button', { class: 'tc-btn tc-sec2', type: 'button', onclick: () => openSite('ferramentas/palavras?q=' + encodeURIComponent(q)) }, 'Abrir no TurboCanal')),
        h('div', { id: 'tc-kwout' })));
    host.prepend(box);
    const go = box.querySelector('#tc-kwgo');
    cost('keyword_research').then((c) => (go.textContent = `🔑 Termos relacionados (${c})`));
    go.onclick = async () => {
      const out = clear(box.querySelector('#tc-kwout'));
      if (!(await me())) { out.append(precisaConta('A pesquisa de termos relacionados')); return; }
      go.disabled = true;
      out.append(h('p', { class: 'tc-muted' }, 'Pesquisando…'));
      try {
        const r = await api('/tools/keyword_research', { method: 'POST', body: { q } });
        clear(out).append(
          h('table', { class: 'tc-table' },
            h('tr', null, h('th', null, 'Termo relacionado'), h('th', null, 'Média de views'), h('th', null, 'Score')),
            (r.result.terms || []).slice(0, 10).map((t) => h('tr', null,
              h('td', null, h('a', { href: '/results?search_query=' + encodeURIComponent(t.term) }, t.term)),
              h('td', null, short(t.avgViews)), h('td', null, String(t.score))))),
          h('p', { class: 'tc-muted' }, (r.result.mock ? '⚠️ dados de exemplo · ' : '') + creditLine(r.credits)));
      } catch (e) { clear(out).append(errBox(e)); }
      go.disabled = false;
    };
    updateSearch(box, q);
  }
  function updateSearch(box) {
    const itens = [...document.querySelectorAll('ytd-search ytd-video-renderer')].slice(0, 20);
    const linhas = itens.map((el) => {
      const t = el.innerText || '';
      return { views: parseViews(t), hours: parseAgeHours(t), canal: (el.querySelector('ytd-channel-name')?.innerText || '').trim() };
    }).filter((r) => r.views != null);
    const grid = box.querySelector('#tc-sstats');
    if (!grid) return;
    clear(grid);
    if (linhas.length < 3) { grid.append(h('span', { class: 'tc-muted' }, 'Carregando os resultados…')); return; }
    const vs = linhas.map((r) => r.views).sort((a, b) => a - b);
    const mediana = vs[Math.floor(vs.length / 2)];
    const recentes = linhas.filter((r) => r.hours != null && r.hours <= 720).length;
    const canais = new Set(linhas.map((r) => r.canal).filter(Boolean)).size;
    const fresh = Math.round((recentes / linhas.length) * 100);
    const demanda = mediana >= 100000 ? 'Alta' : mediana >= 10000 ? 'Média' : 'Baixa';
    const ptsDemanda = Math.max(0, Math.min(50, Math.round((Math.log10(Math.max(10, mediana)) - 2) * 16)));
    const ptsEspaco = Math.round(fresh * 0.3) + Math.min(20, Math.round((canais / linhas.length) * 20));
    const score = Math.max(1, Math.min(100, ptsDemanda + ptsEspaco));
    const ks = box.querySelector('#tc-kscore');
    if (ks) clear(ks).append(h('div', { class: 'tc-score' },
      h('div', { class: 'tc-score-n' + (score >= 70 ? ' good' : score >= 40 ? '' : ' bad') }, String(score)),
      h('div', null, h('b', null, 'Pontuação da palavra-chave'),
        h('div', { class: 'tc-muted' }, score >= 70 ? 'Boa: tem procura e ainda cabe vídeo novo.' : score >= 40 ? 'Dá para tentar, com um ângulo diferente.' : 'Difícil: pouca procura ou muito dominada.'),
        h('div', { class: 'tc-muted' }, 'heurística TurboCanal (0 a 100), não é número oficial do YouTube'))));
    grid.append(
      stat('📈 Demanda', demanda, `Mediana de views dos ${linhas.length} primeiros resultados: ${fmt(mediana)}`),
      stat('👁 Views (mediana)', short(mediana)),
      stat('🆕 Recentes', fresh + '%', 'Publicados nos últimos 30 dias'),
      stat('📺 Canais diferentes', `${canais} de ${linhas.length}`),
      stat('🎯 Oportunidade', fresh >= 30 && demanda !== 'Baixa' ? 'Boa' : demanda === 'Alta' && fresh < 15 ? 'Difícil' : 'Média'));
  }

  /* ---------------------------- página de canal ---------------------------- */
  let canalKey = null;
  const channelKey = () => {
    const m = location.pathname.match(/^\/(@[^/]+)|^\/channel\/(UC[\w-]{20,})|^\/(?:c|user)\/([^/]+)/);
    return m ? decodeURIComponent(m[1] || m[2] || m[3]) : null;
  };
  function channelCard() {
    const key = channelKey();
    let card = document.getElementById('tc-chan');
    if (!key) { card?.remove(); canalKey = null; return; }
    if (card && canalKey === key) return;
    card?.remove();
    canalKey = key;
    const corpo = h('div', { class: 'tc-body tc-hide' });
    const res = h('div');
    const analisar = h('button', { class: 'tc-btn', type: 'button' }, '📊 Analisar canal');
    const add = h('button', { class: 'tc-btn tc-sec2', type: 'button' }, '🏆 Adicionar aos concorrentes');
    cost('channel_analysis').then((c) => (analisar.textContent = `📊 Analisar canal (${c})`));
    cost('competitor_check').then((c) => (add.textContent = `🏆 Adicionar aos concorrentes (${c})`));
    const comConta = async (fn) => { if (!(await me())) { clear(res).append(precisaConta('Esta análise')); return false; } return true; };
    analisar.onclick = async () => {
      if (!(await comConta())) return;
      analisar.disabled = true;
      clear(res).append(h('p', { class: 'tc-muted' }, 'Analisando…'));
      try {
        const r = await api('/tools/channel_analysis', { method: 'POST', body: { channel: key } });
        const c = r.result.channel;
        clear(res).append(
          h('div', { class: 'tc-grid' }, stat('👥 Inscritos', c.subs == null ? 'ocultos' : short(c.subs)), stat('👁 Views totais', short(c.views)), stat('🎬 Vídeos', fmt(c.videos)), stat('📈 Média recente', short(r.result.mediaViewsRecentes))),
          h('b', null, 'Últimos vídeos'),
          (r.result.recent || []).slice(0, 5).map((v) => h('div', { class: 'tc-check' },
            h('a', { class: 'tc-link', href: '/watch?v=' + v.id }, v.title),
            h('div', { class: 'tc-muted' }, `${short(v.views)} views · ⚡ ${short(v.vph)}/h${v.outlier != null ? ' · ' + dec(v.outlier) + 'x' : ''}`))),
          h('p', { class: 'tc-muted' }, (r.result.mock ? '⚠️ dados de exemplo · ' : '') + creditLine(r.credits)));
      } catch (e) { clear(res).append(errBox(e)); }
      analisar.disabled = false;
    };
    add.onclick = async () => {
      if (!(await comConta())) return;
      add.disabled = true;
      clear(res).append(h('p', { class: 'tc-muted' }, 'Adicionando…'));
      try {
        const r = await api('/competitors', { method: 'POST', body: { channel: key } });
        clear(res).append(h('p', { class: 'tc-ok' }, '✅ Adicionado aos seus concorrentes.'), h('p', { class: 'tc-muted' }, creditLine(r.credits)));
      } catch (e) { clear(res).append(errBox(e)); }
      add.disabled = false;
    };
    corpo.append(
      h('p', { class: 'tc-muted' }, 'Canal: ' + key + '. Na aba Vídeos, as etiquetas mostram o VPH e o outlier em relação aos vídeos do próprio canal (de graça).'),
      sortBar(), h('div', { class: 'tc-actions' }, analisar, add), res);
    card = h('div', { id: 'tc-chan' }, h('button', { class: 'tc-fab', type: 'button', onclick: () => corpo.classList.toggle('tc-hide') }, '🚀 TurboCanal'), corpo);
    document.body.append(card);
  }

  /* ---------------------------- Shorts ---------------------------- */
  function shortsButton() {
    const ehShort = location.pathname.startsWith('/shorts/');
    let b = document.getElementById('tc-shorts');
    if (!ehShort) { b?.remove(); return; }
    if (b) return;
    b = h('button', { id: 'tc-shorts', class: 'tc-fab', type: 'button', onclick: () => { document.getElementById('tc-panel')?.remove(); painelVid = null; watchPanel({ floating: true, force: true }); } }, '🚀 Analisar este Short');
    document.body.append(b);
  }

  /* ---------------------------- roteamento ---------------------------- */
  function route() {
    const p = location.pathname;
    if (p === '/watch' || p.startsWith('/shorts/')) { watchPanel({ floating: p.startsWith('/shorts/') }); ajustarLugar(); }
    else { document.getElementById('tc-panel')?.remove(); painelVid = null; }
    if (p === '/results') searchPanel(); else { document.getElementById('tc-search')?.remove(); buscaQ = null; }
    channelCard();
    shortsButton();
    if (S.badges) scanBadges(); else removeBadges();
  }

  (async () => {
    await loadCfg();
    route();
    document.addEventListener('tc-video-data', () => route());
    window.addEventListener('yt-navigate-finish', () => setTimeout(route, 500));
    setInterval(route, 2000);
    chrome.storage.onChanged.addListener(async (mudou, area) => {
      await loadCfg();
      if (!S.badges) removeBadges();
      ME = null; MEtried = false;
      // entrou (ou saiu) da conta no site: refaz o painel na hora, sem precisar clicar em nada
      if (area === 'local' && mudou && mudou.tc_token) refreshPanel(); else route();
    });
  })();
})();
