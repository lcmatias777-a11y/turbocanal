// TurboCanal dentro do YouTube Studio: SEO do vídeo que você está editando e atalhos.
(() => {
  if (document.documentElement.dataset.tcStudio) return;
  document.documentElement.dataset.tcStudio = '1';
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, String(v));
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  let base = 'https://turbocanal.onrender.com';
  const site = (hash) => base + '/#/' + hash;
  const openTab = (url) => chrome.runtime.sendMessage({ type: 'openTab', url }).catch(() => window.open(url, '_blank'));
  const btn = (hash, label, cls = 'tc-btn') => h('button', { class: cls, type: 'button', onclick: () => openTab(site(hash)) }, label);

  async function api(path, opts = {}) {
    try { const c = await chrome.storage.sync.get(['baseUrl']); base = (c.baseUrl || base).replace(/\/$/, ''); } catch {}
    let t = '';
    try { t = (await chrome.runtime.sendMessage({ type: 'getToken' }))?.token || ''; } catch {}
    const r = await fetch(base + '/api' + path, {
      method: opts.method || 'GET',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return d;
  }
  const vidOf = () => (location.pathname.match(/\/video\/([A-Za-z0-9_-]{11})/) || [])[1] || null;

  let atual = null;
  function tick() {
    const vid = vidOf();
    let root = document.getElementById('tc-studio');
    if (!vid) { root?.remove(); atual = null; return; }
    if (root && atual === vid) return;
    root?.remove();
    atual = vid;
    const corpo = h('div', { class: 'tc-body tc-hide' });
    const out = h('div');
    const ver = h('button', { class: 'tc-btn tc-sec2', type: 'button' }, '📈 Ver SEO deste vídeo');
    ver.onclick = async () => {
      ver.disabled = true;
      clear(out).append(h('p', { class: 'tc-muted' }, 'Analisando…'));
      try {
        const r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } });
        const v = r.result.video, s = r.result.seo;
        clear(out).append(
          h('div', { class: 'tc-score' },
            h('div', { class: 'tc-score-n' + (s.score >= 80 ? ' good' : s.score >= 50 ? '' : ' bad') }, String(s.score)),
            h('div', null, h('b', null, 'Pontuação de SEO'), h('div', { class: 'tc-muted' }, `${fmt(v.views)} views · ⚡ ${fmt(v.vph)}/h`))),
          s.checks.map((c) => h('div', { class: 'tc-check' }, (c.ok ? '✅ ' : '⚠️ ') + c.item, !c.ok && c.dica ? h('div', { class: 'tc-muted' }, c.dica) : null)),
          (v.tags || []).length
            ? h('div', { class: 'tc-sec' }, h('b', null, `Tags (${v.tags.length})`), h('div', { class: 'tc-tags' }, v.tags.map((t) => h('span', null, t))))
            : h('p', { class: 'tc-muted' }, 'Este vídeo ainda não tem tags.'),
          h('p', { class: 'tc-muted' }, r.credits?.unlimited ? 'Administrador: sem consumo de créditos.' : `Usado ${r.credits?.charged ?? 1} crédito.`));
      } catch (e) {
        clear(out).append(h('p', { class: 'tc-err' }, e.message),
          e.status === 401 || !e.status
            ? h('div', { class: 'tc-need' }, h('div', null, '🔒 Isto precisa da sua conta do TurboCanal.'),
              h('div', { class: 'tc-actions' }, h('button', { class: 'tc-btn', type: 'button', onclick: () => openTab(base + '/api/auth/google') }, '🔵 Entrar com Google')))
            : null);
      }
      ver.disabled = false;
    };
    corpo.append(
      h('p', { class: 'tc-muted' }, 'Melhore este vídeo sem sair do Studio:'),
      h('div', { class: 'tc-actions' },
        btn('ferramentas/insights?video=' + vid, '✨ IA: título, descrição e tags'),
        btn('ferramentas/transformar?video=' + vid + '&mode=shorts', '✂️ 3 cortes para Shorts', 'tc-btn tc-sec2'),
        btn('canal', '📺 Meu canal', 'tc-btn tc-sec2')),
      h('div', { class: 'tc-actions' }, ver), out);
    root = h('div', { id: 'tc-studio' }, h('button', { class: 'tc-fab', type: 'button', onclick: () => corpo.classList.toggle('tc-hide') }, '🚀 TurboCanal'), corpo);
    document.body.append(root);
  }
  chrome.storage.sync.get(['baseUrl']).then((c) => { base = (c.baseUrl || base).replace(/\/$/, ''); tick(); }).catch(tick);
  setInterval(tick, 1500);
})();
