// TurboCanal dentro do YouTube Studio: ao editar um vídeo, um botão abre o painel com a
// pontuação de SEO e os atalhos para a IA do vídeo (título, descrição e tags) e os 3 cortes.
(() => {
  if (window.__tcStudio) return;
  window.__tcStudio = true;
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
  let baseUrl = 'https://turbocanal.onrender.com';
  const site = (hash) => baseUrl + '/#/' + hash;
  const link = (href, label, cls = 'tc-btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
  async function api(path, opts = {}) {
    const { baseUrl: b } = await chrome.storage.sync.get(['baseUrl']);
    baseUrl = (b || baseUrl).replace(/\/$/, '');
    const t = (await chrome.runtime.sendMessage({ type: 'getToken' }))?.token || '';
    const r = await fetch(baseUrl + '/api' + path, { method: opts.method || 'GET', headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return d;
  }
  const vidOf = () => (location.pathname.match(/\/video\/([A-Za-z0-9_-]{11})/) || [])[1] || null;

  let current = null;
  function tick() {
    const vid = vidOf();
    let root = document.getElementById('tc-studio');
    if (!vid) { root?.remove(); current = null; return; }
    if (root && current === vid) return;
    root?.remove();
    current = vid;
    const body = h('div', { class: 'tc-body tc-hide' });
    const load = h('button', { class: 'tc-btn', type: 'button' }, '📈 Ver SEO deste vídeo (1 crédito)');
    const out = h('div');
    load.onclick = async () => {
      load.disabled = true; clear(out).append(h('p', { class: 'tc-muted' }, 'Analisando…'));
      try {
        const r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } });
        const v = r.result.video, s = r.result.seo;
        clear(out).append(
          h('div', { class: 'tc-score' }, h('div', { class: 'tc-score-n' + (s.score >= 80 ? ' good' : s.score >= 50 ? '' : ' bad') }, String(s.score)), h('div', null, h('b', null, 'Pontuação de SEO'), h('div', { class: 'tc-muted' }, `${fmt(v.views)} views · ⚡ ${fmt(v.vph)}/h`))),
          (s.checks || []).map((c) => h('div', { class: 'tc-check' }, (c.ok ? '✅ ' : '⚠️ ') + c.item, !c.ok && c.dica ? h('div', { class: 'tc-muted' }, c.dica) : null)),
          (v.tags || []).length ? h('div', { class: 'tc-sec' }, h('b', null, `Tags (${v.tags.length})`), h('div', { class: 'tc-tags' }, v.tags.map((t) => h('span', null, t)))) : h('p', { class: 'tc-muted' }, 'Este vídeo ainda não tem tags.'),
          h('p', { class: 'tc-muted' }, r.credits?.unlimited ? 'Administrador: sem consumo de créditos.' : `Usado ${r.credits?.charged ?? 1} crédito.`));
      } catch (e) {
        clear(out).append(h('p', { class: 'tc-err' }, e.message), e.status === 401 || !e.status ? h('p', null, link(baseUrl + '/api/auth/google', '🔵 Entrar com Google')) : null);
      }
      load.disabled = false;
    };
    body.append(
      h('p', { class: 'tc-muted' }, 'Melhore este vídeo sem sair do Studio:'),
      h('div', { class: 'tc-actions' },
        link(site('ferramentas/insights?video=' + vid), '✨ IA: título, descrição e tags'),
        link(site('ferramentas/transformar?video=' + vid + '&mode=shorts'), '✂️ 3 cortes para Shorts', 'tc-btn tc-sec2'),
        link(site('canal'), '📺 Meu canal no TurboCanal', 'tc-btn tc-sec2')),
      h('div', { class: 'tc-actions' }, load), out);
    root = h('div', { id: 'tc-studio' }, h('button', { class: 'tc-fab', type: 'button', onclick: () => body.classList.toggle('tc-hide') }, '🚀 TurboCanal'), body);
    document.body.append(root);
  }
  chrome.storage.sync.get(['baseUrl']).then((c) => { baseUrl = (c.baseUrl || baseUrl).replace(/\/$/, ''); tick(); });
  setInterval(tick, 1500);
})();
