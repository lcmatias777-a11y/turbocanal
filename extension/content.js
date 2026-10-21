// TurboCanal no YouTube (content script).
//  1) Página do vídeo: painel com abas Vídeo, Canal, SEO e IA.
//  2) Miniaturas (início, busca, canal, relacionados): VPH e outlier calculados na hora,
//     com os números que o próprio YouTube mostra na página (grátis, sem gastar créditos).
//  3) Busca: resumo da concorrência da busca e pesquisa de palavras-chave.
//  4) Página de canal: análise do canal e "adicionar aos concorrentes".
//  5) Shorts: botão para abrir o painel do Short.
// Tudo é montado com createElement/textContent (o YouTube exige Trusted Types e bloqueia innerHTML).
(() => {
  if (window.__tcLoaded) return;
  window.__tcLoaded = true;

  // ---------------- utilidades ----------------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const clear = (el) => { while (el && el.firstChild) el.firstChild.remove(); return el; };
  const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR'));
  const short = (n) => {
    if (n == null) return '—';
    if (n >= 1e9) return (n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi';
    if (n >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (n >= 1e4) return Math.round(n / 1e3).toLocaleString('pt-BR') + ' mil';
    if (n >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return String(Math.round(n));
  };
  const ageText = (iso) => {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 86400e3;
    if (d < 1) return 'hoje';
    if (d < 60) return `há ${Math.round(d)} dia${Math.round(d) === 1 ? '' : 's'}`;
    if (d < 730) return `há ${Math.round(d / 30)} meses`;
    return `há ${Math.floor(d / 365)} anos`;
  };
  const S = { baseUrl: 'https://turbocanal.onrender.com', badges: true, autoPanel: true };

  async function loadSettings() {
    try {
      const c = await chrome.storage.sync.get(['baseUrl', 'tc_badges', 'tc_autopanel']);
      S.baseUrl = (c.baseUrl || S.baseUrl).replace(/\/$/, '');
      S.badges = c.tc_badges !== false;
      S.autoPanel = c.tc_autopanel !== false;
    } catch {}
  }
  async function token() {
    try { return (await chrome.runtime.sendMessage({ type: 'getToken' }))?.token || ''; } catch { return ''; }
  }
  async function api(path, { method = 'GET', body } = {}) {
    const t = await token();
    let r;
    try {
      r = await fetch(S.baseUrl + '/api' + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      const e = new Error('Não consegui falar com o TurboCanal (o site pode estar acordando; tente de novo em 1 minuto).'); e.status = 0; throw e;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return data;
  }
  const site = (hash) => S.baseUrl + '/#/' + hash;
  const linkBtn = (href, label, cls = 'tc-btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
  const creditsLine = (c) => (!c ? '' : c.unlimited ? 'Conta do administrador: sem consumo de créditos.' : c.reused ? 'Já analisado: nada cobrado de novo.' : c.charged === 1 ? 'Usado 1 crédito.' : `Usados ${fmt(c.charged)} créditos.`);
  const errBox = (e) => h('div', { class: 'tc-err' }, e.message,
    e.status === 401 ? h('div', { class: 'tc-muted' }, 'Sessão expirada: entre de novo pelo ícone da extensão.') : null,
    e.status === 402 ? h('div', null, linkBtn(site('planos'), 'Ver planos', 'tc-link')) : null,
    e.status === 409 ? h('div', { class: 'tc-muted' }, 'Nenhum crédito foi cobrado.') : null);
  const loginBox = () => h('div', { class: 'tc-body' },
    h('p', null, 'Entre com o Google no TurboCanal para ver a análise deste vídeo, do canal e as sugestões da IA.'),
    h('p', null, linkBtn(S.baseUrl + '/api/auth/google', '🔵 Entrar com Google')),
    h('p', { class: 'tc-muted' }, 'Depois de entrar, recarregue esta página.'));
  let ME = null;
  async function me(force = false) {
    if (ME && !force) return ME;
    try { ME = (await api('/me')).user; } catch (e) { ME = null; if (e.status && e.status !== 401) throw e; }
    return ME;
  }
  const costOf = (() => { let costs = null; return async (tool) => { if (!costs) { try { costs = (await api('/tools/costs')).costs; } catch { costs = []; } } return costs.find((c) => c.tool === tool)?.cost; }; })();
  const priceLabel = async (tool) => (ME?.unlimited ? 'incluído' : `${fmt(await costOf(tool))} créditos`);

  function videoIdFromUrl(u = location.href) {
    const m = String(u).match(/[?&]v=([A-Za-z0-9_-]{11})|\/shorts\/([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] || m[3] : null;
  }

  // ---------------- 1) painel do vídeo ----------------
  let panelVid = null;
  const panelCache = new Map(); // vídeo -> resultado (se o YouTube redesenhar a coluna, não cobra de novo)
  function panelShell(floating) {
    let p = document.getElementById('tc-panel');
    if (p) return p;
    const host = floating ? document.body : document.querySelector('#secondary-inner') || document.querySelector('#secondary') || document.body;
    p = h('div', { id: 'tc-panel', class: host === document.body ? 'tc-floating' : 'tc-inline' });
    host.prepend(p);
    return p;
  }
  function header(p, extra) {
    return h('div', { class: 'tc-head' },
      h('span', null, '🚀 Turbo', h('b', null, 'Canal')),
      h('span', { class: 'tc-head-right' }, extra || null,
        h('button', { class: 'tc-close', title: 'Minimizar', onclick: () => p.classList.toggle('tc-min') }, '—'),
        h('button', { class: 'tc-close', title: 'Fechar', onclick: () => { p.remove(); panelVid = '__fechado__' + videoIdFromUrl(); } }, '✕')));
  }

  async function watchPanel({ floating = false, force = false } = {}) {
    const vid = videoIdFromUrl();
    if (!vid) return;
    if (!force && (panelVid === vid || panelVid === '__fechado__' + vid) && document.getElementById('tc-panel')) return;
    if (!force && panelVid === '__fechado__' + vid) return;
    panelVid = vid;
    const p = panelShell(floating);
    clear(p);
    if (!(await token())) { p.append(header(p), loginBox()); return; }
    let user;
    try { user = await me(true); } catch (e) { p.append(header(p), h('div', { class: 'tc-body' }, errBox(e))); return; }
    if (!user) { p.append(header(p), loginBox()); return; }
    const credits = h('span', { class: 'tc-credits' }, '💎 ' + (user.unlimited ? '∞' : fmt(user.credits)));
    p.append(header(p, credits));
    const body = h('div', { class: 'tc-body' });
    p.append(body);
    if (!S.autoPanel && !force) {
      body.append(h('p', { class: 'tc-muted' }, 'O painel automático está desligado (no ícone da extensão).'),
        h('button', { class: 'tc-btn', onclick: () => watchPanel({ floating, force: true }) }, `Carregar análise (${await priceLabel('video_panel')})`));
      return;
    }
    body.append(h('div', { class: 'tc-muted' }, 'Analisando este vídeo…'));
    let r = panelCache.get(vid);
    if (!r) {
      try { r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } }); }
      catch (e) { clear(body).append(errBox(e)); return; }
      panelCache.set(vid, { result: r.result, credits: { ...r.credits, charged: 0, reused: true } });
      if (panelCache.size > 50) panelCache.delete(panelCache.keys().next().value);
    }
    if (videoIdFromUrl() !== vid) return; // o usuário já mudou de vídeo
    if (!r.credits?.unlimited && r.credits?.balance != null) credits.textContent = '💎 ' + fmt(r.credits.balance);
    renderPanel(clear(body), r.result, vid, r.credits);
  }

  function stat(label, value, title) { return h('div', { class: 'tc-stat', title: title || null }, h('span', { class: 'tc-stat-l' }, label), h('b', null, value)); }

  function renderPanel(body, R, vid, credits) {
    const v = R.video || {}, s = R.seo || {}, ch = R.channel || null;
    const tabsBar = h('div', { class: 'tc-tabs' });
    const pane = h('div', { class: 'tc-pane' });
    const tabs = {
      'Vídeo': () => tabVideo(v, R, vid),
      'Canal': () => tabChannel(ch, v),
      'SEO': () => tabSeo(v, s, R.seoTags || {}),
      'IA': () => tabAI(vid)
    };
    let current = 'Vídeo';
    const show = (name) => {
      current = name;
      for (const b of tabsBar.children) b.classList.toggle('on', b.textContent === name);
      clear(pane).append(tabs[name]());
    };
    for (const name of Object.keys(tabs)) tabsBar.append(h('button', { class: 'tc-tab', type: 'button', onclick: () => show(name) }, name));
    body.append(R.mock ? h('p', { class: 'tc-err' }, '⚠️ ' + (R.aviso || 'Dados de exemplo.')) : null, tabsBar, pane, h('p', { class: 'tc-muted tc-foot' }, creditsLine(credits)));
    show(current);
  }

  function tabVideo(v, R, vid) {
    const out = R.outlierCanal;
    return h('div', null,
      h('div', { class: 'tc-grid' },
        stat('👁 Views', fmt(v.views)),
        stat('⚡ VPH', fmt(v.vph), 'Views por hora desde a publicação'),
        stat('🔥 Outlier', out != null ? `${String(out).replace('.', ',')}x` : '—', 'Views deste vídeo ÷ mediana dos últimos vídeos do canal'),
        stat('📊 Engajamento', v.engagement != null ? String(v.engagement).replace('.', ',') + '%' : '—', '(likes + comentários) ÷ views'),
        stat('👍 Likes', fmt(v.likes)),
        stat('💬 Comentários', fmt(v.comments)),
        stat('⏱ Duração', v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, '0')}` : '—'),
        stat('📅 Publicado', ageText(v.publishedAt))),
      out != null ? h('p', { class: out >= 2 ? 'tc-ok' : 'tc-muted' }, out >= 2 ? `🔥 Este vídeo está ${String(out).replace('.', ',')}x acima do normal do canal.` : out < 0.7 ? 'Este vídeo está abaixo do normal do canal.' : 'Este vídeo está na média do canal.') : null,
      h('div', { class: 'tc-actions' },
        linkBtn(site('ferramentas/insights?video=' + vid), '✨ IA do vídeo'),
        linkBtn(site('ferramentas/transformar?video=' + vid + '&mode=shorts'), '✂️ 3 cortes p/ Shorts'),
        linkBtn(site('ferramentas/video?video=' + vid), '🔍 Análise completa'),
        linkBtn(site('canal'), '📺 Meu canal')));
  }

  function tabChannel(ch, v) {
    if (!ch) return h('p', { class: 'tc-muted' }, 'Não consegui carregar os dados do canal agora.');
    const years = ch.publishedAt ? (Date.now() - new Date(ch.publishedAt).getTime()) / (365 * 86400e3) : null;
    const msg = h('div');
    const addBtn = h('button', { class: 'tc-btn', type: 'button' }, '🏆 Adicionar aos concorrentes');
    addBtn.onclick = async () => {
      addBtn.disabled = true; clear(msg).append(h('span', { class: 'tc-muted' }, 'Adicionando…'));
      try { const r = await api('/competitors', { method: 'POST', body: { channel: ch.id } }); clear(msg).append(h('p', { class: 'tc-ok' }, '✅ Canal adicionado aos seus concorrentes. ', linkBtn(site('ferramentas/concorrentes'), 'ver lista', 'tc-link')), h('p', { class: 'tc-muted' }, creditsLine(r.credits))); }
      catch (e) { clear(msg).append(errBox(e)); addBtn.disabled = false; }
    };
    priceLabel('competitor_check').then((l) => (addBtn.textContent = `🏆 Adicionar aos concorrentes (${l})`));
    return h('div', null,
      h('div', { class: 'tc-chan' }, ch.thumb ? h('img', { src: ch.thumb, alt: '' }) : null,
        h('div', null, h('b', null, ch.title || v.channel || ''), h('div', { class: 'tc-muted' }, [ch.handle, years != null ? (years >= 1 ? `${Math.floor(years)} ano${Math.floor(years) === 1 ? '' : 's'} no YouTube` : 'canal novo') : null].filter(Boolean).join(' · ')))),
      h('div', { class: 'tc-grid' },
        stat('👥 Inscritos', ch.subs == null ? 'ocultos' : short(ch.subs)),
        stat('👁 Views totais', short(ch.views)),
        stat('🎬 Vídeos', fmt(ch.videos)),
        stat('📈 Mediana recente', ch.medianRecentViews != null ? short(ch.medianRecentViews) : '—', `Mediana de views dos últimos ${ch.recentCount || ''} vídeos`)),
      ch.keywords?.length ? h('div', { class: 'tc-sec' }, h('b', null, 'Tags do canal '), h('button', { class: 'tc-mini', type: 'button', onclick: (e) => { navigator.clipboard.writeText(ch.keywords.join(', ')); e.target.textContent = 'copiado ✓'; } }, 'copiar'),
        h('div', { class: 'tc-tags' }, ch.keywords.map((k) => h('span', null, k)))) : h('p', { class: 'tc-muted' }, 'O canal não definiu tags.'),
      h('div', { class: 'tc-actions' }, addBtn, linkBtn(site('ferramentas/canal?channel=' + encodeURIComponent(ch.handle || ch.id)), '📺 Analisar canal no site', 'tc-btn tc-sec2')),
      msg);
  }

  function tabSeo(v, s, st) {
    const inTitle = new Set((st.noTitulo || []).map((x) => x.toLowerCase()));
    const inDesc = new Set((st.naDescricao || []).map((x) => x.toLowerCase()));
    const tags = v.tags || [];
    const copyBtn = h('button', { class: 'tc-mini', type: 'button', id: 'tc-copytags' }, 'copiar todas');
    copyBtn.onclick = () => { navigator.clipboard.writeText(tags.join(', ')); copyBtn.textContent = 'copiado ✓'; };
    return h('div', null,
      h('div', { class: 'tc-score' }, h('div', { class: 'tc-score-n' + (s.score >= 80 ? ' good' : s.score >= 50 ? ' mid' : ' bad') }, String(s.score ?? '—')),
        h('div', null, h('b', null, 'Pontuação de SEO'), h('div', { class: 'tc-muted' }, 'heurística TurboCanal (0 a 100)'))),
      h('div', { class: 'tc-sec' }, (s.checks || []).map((c) => h('div', { class: 'tc-check', title: c.dica || '' }, (c.ok ? '✅ ' : '⚠️ ') + c.item, !c.ok && c.dica ? h('div', { class: 'tc-muted' }, c.dica) : null))),
      tags.length
        ? h('div', { class: 'tc-sec' }, h('b', null, `Tags do vídeo (${tags.length}) `), copyBtn,
          h('div', { class: 'tc-muted' }, '★ aparece no título · ▲ aparece na descrição · clique para pesquisar'),
          h('div', { class: 'tc-tags' }, tags.map((t) => h('a', { href: site('ferramentas/palavras?q=' + encodeURIComponent(t)), target: '_blank', rel: 'noopener', class: inTitle.has(t.toLowerCase()) ? 'star' : '' },
            (inTitle.has(t.toLowerCase()) ? '★ ' : '') + (inDesc.has(t.toLowerCase()) ? '▲ ' : '') + t))))
        : h('p', { class: 'tc-muted' }, 'Este vídeo não tem tags públicas.'));
  }

  function tabAI(vid) {
    const box = h('div');
    const btn = h('button', { class: 'tc-btn', type: 'button' }, '🤖 Pedir a análise da IA');
    priceLabel('coach_ai').then((l) => (btn.textContent = `🤖 Pedir a análise da IA (${l})`));
    btn.onclick = async () => {
      btn.disabled = true;
      clear(box).append(h('p', { class: 'tc-muted' }, '⏳ A IA está assistindo ao vídeo… pode levar de 20 segundos a 2 minutos.'));
      try {
        const r = await api('/tools/coach_ai', { method: 'POST', body: { video: vid } });
        const x = r.result;
        clear(box).append(
          h('div', { class: 'tc-sec' }, h('b', null, '📝 Resumo'), h('p', null, x.resumo)),
          h('div', { class: 'tc-sec' }, h('b', null, `🎣 Gancho: ${x.gancho.nota}/10`), h('p', null, x.gancho.analise), x.gancho.sugestao ? h('p', { class: 'tc-muted' }, '💡 ' + x.gancho.sugestao) : null),
          h('div', { class: 'tc-sec' }, h('b', null, '📊 Desempenho: ' + (x.desempenho.veredito || '')), h('p', null, x.desempenho.porque)),
          h('div', { class: 'tc-sec' }, h('b', null, '💡 3 ideias parecidas para você'), x.ideias.map((i) => h('div', { class: 'tc-check' }, '• ' + i.titulo + ' ', h('a', { class: 'tc-link', href: site('ferramentas/preparar?topic=' + encodeURIComponent(i.titulo)), target: '_blank', rel: 'noopener' }, 'preparar'), i.porque ? h('div', { class: 'tc-muted' }, i.porque) : null))),
          h('div', { class: 'tc-sec' }, h('b', null, '👥 Para ganhar inscritos'), x.inscritos.map((d) => h('div', { class: 'tc-check' }, '• ' + d))),
          h('p', { class: 'tc-muted' }, x.aviso + ' ' + creditsLine(r.credits)));
      } catch (e) { clear(box).append(errBox(e)); }
      btn.disabled = false;
    };
    return h('div', null,
      h('p', { class: 'tc-muted' }, 'A IA assiste a este vídeo e responde: resumo, nota do gancho (começo do vídeo), por que foi bem ou mal, 3 ideias parecidas para o seu canal e dicas para ganhar inscritos.'),
      btn, box,
      h('div', { class: 'tc-actions' }, linkBtn(site('ferramentas/insights?video=' + vid), '✨ Título, descrição e tags (no site)', 'tc-btn tc-sec2')));
  }

  // ---------------- 2) VPH e outlier nas miniaturas ----------------
  const CONTAINERS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-playlist-video-renderer';
  const registry = new Map(); // elemento -> { views, hours, badge }
  function parseViews(text) {
    const t = String(text).replace(/ /g, ' ');
    const m = t.match(/([\d.,]+)\s*(mil|mi|bi|k|m|b)?\s*(?:de\s+)?(visualizaç(?:ão|ões)|views?)\b/i);
    if (!m) return null;
    const unit = (m[2] || '').toLowerCase();
    let num = m[1];
    if (unit) num = num.replace(',', '.'); // "1,2 mi" ou "1.2M"
    else num = num.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'); // "1.234" ou "1,234"
    let v = parseFloat(num);
    if (!isFinite(v)) return null;
    v *= { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6, bi: 1e9, b: 1e9 }[unit] || 1;
    return Math.round(v);
  }
  function parseAgeHours(text) {
    const t = String(text).toLowerCase();
    if (/assistindo agora|watching now|ao vivo agora|live now|programad|scheduled|estreia|premieres/.test(t)) return null;
    const pt = t.match(/há\s+(\d+)\s*(minuto|hora|dia|semana|m[eê]s|meses|ano)/);
    const en = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/);
    const m = pt || en;
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2];
    const hours = /^min/.test(u) ? 1 / 60 : /^hora|^hour/.test(u) ? 1 : /^dia|^day/.test(u) ? 24 : /^semana|^week/.test(u) ? 168 : /^m[eê]s|^meses|^month/.test(u) ? 730 : 8760;
    return Math.max(1, n * hours);
  }
  function thumbAnchor(el) {
    const as = el.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
    for (const a of as) if (a.querySelector('img, yt-image, yt-thumbnail-view-model, ytd-thumbnail')) return a;
    return el.querySelector('a#thumbnail') || as[0] || null;
  }
  function scanBadges() {
    if (!S.badges) return;
    const all = [...document.querySelectorAll(CONTAINERS)];
    for (const el of all) {
      if (registry.has(el) || el.querySelector(CONTAINERS)) continue; // só o item mais interno
      if (el.closest('#tc-panel')) continue;
      const text = el.innerText || el.textContent || '';
      const views = parseViews(text), hours = parseAgeHours(text);
      if (views == null || hours == null) continue;
      const a = thumbAnchor(el);
      if (!a) continue;
      const cs = getComputedStyle(a);
      if (cs.position === 'static') a.style.position = 'relative';
      if (cs.display === 'inline') a.style.display = 'inline-block';
      const badge = h('div', { class: 'tc-badge' });
      a.append(badge);
      registry.set(el, { views, hours, badge });
    }
    // outlier = views ÷ mediana dos vídeos visíveis nesta página (no Vídeos de um canal, é a média do canal)
    for (const [el, r] of registry) if (!el.isConnected) registry.delete(el);
    const list = [...registry.values()].map((r) => r.views).sort((x, y) => x - y);
    const median = list.length ? list[Math.floor(list.length / 2)] : 0;
    for (const r of registry.values()) {
      const vph = r.views / r.hours;
      const out = median > 0 && list.length >= 4 ? r.views / median : null;
      const parts = [`⚡ ${short(vph)}/h`];
      if (out != null) parts.push(`${out >= 2 ? '🔥 ' : ''}${out.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`);
      r.badge.textContent = parts.join(' · ');
      r.badge.classList.toggle('hot', out != null && out >= 2);
      r.badge.title = `VPH: ${fmt(Math.round(vph))} views por hora desde a publicação` + (out != null ? `\nOutlier: ${out.toFixed(1)}x a mediana dos ${list.length} vídeos desta página` : '') + '\n(TurboCanal, calculado com os números da própria página, sem gastar créditos)';
    }
  }
  function removeBadges() {
    for (const r of registry.values()) r.badge.remove();
    registry.clear();
  }

  // ---------------- 3) resumo da busca ----------------
  let searchQ = null;
  function searchPanel() {
    const q = new URLSearchParams(location.search).get('search_query');
    if (!q) return;
    const host = document.querySelector('ytd-search ytd-section-list-renderer #contents') || document.querySelector('ytd-search #contents');
    let box = document.getElementById('tc-search');
    if (box && searchQ === q && box.isConnected) { updateSearchStats(box); return; }
    if (!host) return;
    box?.remove();
    searchQ = q;
    box = h('div', { id: 'tc-search' },
      h('div', { class: 'tc-head' }, h('span', null, '🚀 Turbo', h('b', null, 'Canal'), h('span', { class: 'tc-muted' }, ' · busca: ' + q)),
        h('button', { class: 'tc-close', title: 'Fechar', onclick: () => box.remove() }, '✕')),
      h('div', { class: 'tc-body' }, h('div', { class: 'tc-grid', id: 'tc-sstats' }), h('p', { class: 'tc-muted' }, 'Estimativas calculadas com os resultados que estão na tela.'),
        h('div', { class: 'tc-actions' }, h('button', { class: 'tc-btn', type: 'button', id: 'tc-kwgo' }, '🔑 Pesquisa de palavras-chave'), linkBtn(site('ferramentas/palavras?q=' + encodeURIComponent(q)), 'Abrir no TurboCanal', 'tc-btn tc-sec2')),
        h('div', { id: 'tc-kwout' })));
    host.prepend(box);
    const go = box.querySelector('#tc-kwgo');
    priceLabel('keyword_research').then((l) => (go.textContent = `🔑 Pesquisa de palavras-chave (${l})`));
    go.onclick = async () => {
      const out = clear(box.querySelector('#tc-kwout'));
      if (!(await token())) { out.append(loginBox()); return; }
      go.disabled = true; out.append(h('p', { class: 'tc-muted' }, 'Pesquisando…'));
      try {
        const r = await api('/tools/keyword_research', { method: 'POST', body: { q } });
        clear(out).append(h('table', { class: 'tc-table' }, h('tr', null, h('th', null, 'Termo relacionado'), h('th', null, 'Média de views'), h('th', null, 'Score')),
          (r.result.terms || []).slice(0, 10).map((t) => h('tr', null, h('td', null, h('a', { href: '/results?search_query=' + encodeURIComponent(t.term) }, t.term)), h('td', null, short(t.avgViews)), h('td', null, String(t.score))))),
        h('p', { class: 'tc-muted' }, (r.result.mock ? '⚠️ dados de exemplo · ' : '') + creditsLine(r.credits)));
      } catch (e) { clear(out).append(errBox(e)); }
      go.disabled = false;
    };
    updateSearchStats(box);
  }
  function updateSearchStats(box) {
    const items = [...document.querySelectorAll('ytd-search ytd-video-renderer')].slice(0, 20);
    const rows = items.map((el) => { const t = el.innerText || ''; return { views: parseViews(t), hours: parseAgeHours(t), channel: (el.querySelector('ytd-channel-name') || {}).innerText || '' }; }).filter((r) => r.views != null);
    const grid = box.querySelector('#tc-sstats');
    if (!grid) return;
    clear(grid);
    if (rows.length < 3) { grid.append(h('span', { class: 'tc-muted' }, 'Carregando os resultados…')); return; }
    const vs = rows.map((r) => r.views).sort((a, b) => a - b);
    const median = vs[Math.floor(vs.length / 2)];
    const recent = rows.filter((r) => r.hours != null && r.hours <= 30 * 24).length;
    const channels = new Set(rows.map((r) => r.channel.trim()).filter(Boolean)).size;
    const demand = median >= 100000 ? 'Alta' : median >= 10000 ? 'Média' : 'Baixa';
    const fresh = Math.round((recent / rows.length) * 100);
    grid.append(
      stat('📈 Demanda', demand, `Mediana de views dos ${rows.length} primeiros resultados: ${fmt(median)}`),
      stat('👁 Views (mediana)', short(median)),
      stat('🆕 Recentes', fresh + '%', 'Resultados publicados nos últimos 30 dias: quanto maior, mais espaço para vídeo novo'),
      stat('📺 Canais diferentes', `${channels} de ${rows.length}`),
      stat('🎯 Oportunidade', fresh >= 30 && demand !== 'Baixa' ? 'Boa' : demand === 'Alta' && fresh < 15 ? 'Difícil' : 'Média', 'Estimativa: demanda alta + muitos vídeos recentes = mais chance para um vídeo novo'));
  }

  // ---------------- 4) página de canal ----------------
  function channelKey() {
    const m = location.pathname.match(/^\/(@[^/]+)|^\/channel\/(UC[\w-]{20,})|^\/(?:c|user)\/([^/]+)/);
    return m ? decodeURIComponent(m[1] || m[2] || m[3]) : null;
  }
  let chanKey = null;
  function channelCard() {
    const key = channelKey();
    let card = document.getElementById('tc-chan');
    if (!key) { card?.remove(); chanKey = null; return; }
    if (card && chanKey === key) return;
    card?.remove();
    chanKey = key;
    const out = h('div', { class: 'tc-body tc-hide' });
    const analyze = h('button', { class: 'tc-btn', type: 'button' }, '📊 Analisar canal');
    const add = h('button', { class: 'tc-btn tc-sec2', type: 'button' }, '🏆 Adicionar aos concorrentes');
    const res = h('div');
    priceLabel('channel_analysis').then((l) => (analyze.textContent = `📊 Analisar canal (${l})`));
    priceLabel('competitor_check').then((l) => (add.textContent = `🏆 Adicionar aos concorrentes (${l})`));
    analyze.onclick = async () => {
      if (!(await token())) { clear(res).append(loginBox()); return; }
      analyze.disabled = true; clear(res).append(h('p', { class: 'tc-muted' }, 'Analisando…'));
      try {
        const r = await api('/tools/channel_analysis', { method: 'POST', body: { channel: key } });
        const c = r.result.channel;
        clear(res).append(h('div', { class: 'tc-grid' }, stat('👥 Inscritos', c.subs == null ? 'ocultos' : short(c.subs)), stat('👁 Views totais', short(c.views)), stat('🎬 Vídeos', fmt(c.videos)), stat('📈 Média recente', short(r.result.mediaViewsRecentes))),
          h('b', null, 'Últimos vídeos'),
          (r.result.recent || []).slice(0, 5).map((v) => h('div', { class: 'tc-check' }, h('a', { class: 'tc-link', href: '/watch?v=' + v.id }, v.title), h('div', { class: 'tc-muted' }, `${short(v.views)} views · ⚡ ${short(v.vph)}/h${v.outlier != null ? ' · ' + String(v.outlier).replace('.', ',') + 'x' : ''}`))),
          h('p', { class: 'tc-muted' }, (r.result.mock ? '⚠️ dados de exemplo · ' : '') + creditsLine(r.credits)));
      } catch (e) { clear(res).append(errBox(e)); }
      analyze.disabled = false;
    };
    add.onclick = async () => {
      if (!(await token())) { clear(res).append(loginBox()); return; }
      add.disabled = true; clear(res).append(h('p', { class: 'tc-muted' }, 'Adicionando…'));
      try { const r = await api('/competitors', { method: 'POST', body: { channel: key } }); clear(res).append(h('p', { class: 'tc-ok' }, '✅ Adicionado aos seus concorrentes. ', linkBtn(site('ferramentas/concorrentes'), 'ver lista', 'tc-link')), h('p', { class: 'tc-muted' }, creditsLine(r.credits))); }
      catch (e) { clear(res).append(errBox(e)); }
      add.disabled = false;
    };
    out.append(h('p', { class: 'tc-muted' }, 'Canal: ' + key + '. As miniaturas da aba Vídeos mostram o outlier em relação aos vídeos do próprio canal.'), h('div', { class: 'tc-actions' }, analyze, add), res);
    card = h('div', { id: 'tc-chan' },
      h('button', { class: 'tc-fab', type: 'button', onclick: () => out.classList.toggle('tc-hide') }, '🚀 TurboCanal'), out);
    document.body.append(card);
  }

  // ---------------- 5) Shorts ----------------
  function shortsButton() {
    const vid = videoIdFromUrl();
    let b = document.getElementById('tc-shorts');
    if (!vid || !location.pathname.startsWith('/shorts/')) { b?.remove(); return; }
    if (b) return;
    b = h('button', { id: 'tc-shorts', class: 'tc-fab', type: 'button', onclick: () => { document.getElementById('tc-panel')?.remove(); panelVid = null; watchPanel({ floating: true, force: true }); } }, '🚀 Analisar este Short');
    document.body.append(b);
  }

  // ---------------- roteamento (o YouTube troca de página sem recarregar) ----------------
  function route() {
    const p = location.pathname;
    if (p === '/watch') watchPanel();
    else if (!p.startsWith('/shorts/') || (panelVid && panelVid !== videoIdFromUrl())) { document.getElementById('tc-panel')?.remove(); panelVid = null; }
    if (p === '/results') searchPanel(); else document.getElementById('tc-search')?.remove();
    channelCard();
    shortsButton();
    if (S.badges) scanBadges(); else removeBadges();
  }

  (async () => {
    await loadSettings();
    route();
    window.addEventListener('yt-navigate-finish', () => setTimeout(route, 600));
    setInterval(route, 2000);
    chrome.storage.onChanged.addListener(async () => { await loadSettings(); if (!S.badges) removeBadges(); route(); });
  })();
})();
