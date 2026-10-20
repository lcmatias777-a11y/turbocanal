// Content script do TurboCanal: injeta um painel fixo na coluna lateral das páginas
// de vídeo do YouTube (como ferramentas do gênero), com estatísticas, pontuação de
// SEO, palavras-chave e atalhos. Tudo passa pelo backend, que cobra créditos no
// servidor com as mesmas regras do site.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  let lastVideo = null;

  async function cfg() {
    const { baseUrl } = await chrome.storage.sync.get(['baseUrl']);
    let token = '';
    try { token = (await chrome.runtime.sendMessage({ type: 'getToken' }))?.token || ''; } catch {}
    return { baseUrl: (baseUrl || 'https://turbocanal.onrender.com').replace(/\/$/, ''), token };
  }
  async function api(path, { method = 'GET', body } = {}) {
    const { baseUrl, token } = await cfg();
    const r = await fetch(baseUrl + '/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; throw e; }
    return data;
  }

  function videoId() {
    const m = location.href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function ensurePanel() {
    let p = document.getElementById('tc-panel');
    if (p) return p;
    const host = document.querySelector('#secondary-inner') || document.querySelector('#secondary') || document.body;
    p = document.createElement('div');
    p.id = 'tc-panel';
    p.className = host === document.body ? 'tc-floating' : 'tc-inline';
    host.prepend(p);
    return p;
  }

  function header(extra = '') {
    return `<div class="tc-head"><span>🚀 Turbo<b>Canal</b></span><span class="tc-head-right">${extra}<button class="tc-close" title="Fechar">✕</button></span></div>`;
  }

  async function render() {
    const vid = videoId();
    if (!vid) { document.getElementById('tc-panel')?.remove(); return; }
    const panel = ensurePanel();
    if (lastVideo === vid && panel.dataset.ready === '1') return;
    lastVideo = vid;
    panel.dataset.ready = '0';
    const { baseUrl, token } = await cfg();
    if (!token) {
      panel.innerHTML = header() + `<div class="tc-body"><p>Entre com o Google no TurboCanal para ver aqui a análise deste vídeo, suas tags e atalhos do seu canal.</p>
        <p><a class="tc-btn" href="${esc(baseUrl)}/api/auth/google" target="_blank" rel="noopener">🔵 Entrar com Google</a></p>
        <p class="tc-muted">Depois de entrar, recarregue esta página.</p></div>`;
      wire(panel); panel.dataset.ready = '1'; return;
    }
    panel.innerHTML = header() + `<div class="tc-body tc-muted">Analisando este vídeo…</div>`;
    wire(panel);
    try {
      const me = (await api('/me')).user;
      const r = await api('/tools/video_analysis', { method: 'POST', body: { video: vid } });
      const v = r.result.video, s = r.result.seo;
      const kws = (v.tags || []).slice(0, 12);
      panel.innerHTML = header(`<span class="tc-credits">💎 ${me.unlimited ? '∞' : fmt(r.credits.balance)}</span>`) + `
        <div class="tc-body">
          ${r.result.mock ? `<p class="tc-err">⚠️ ${esc(r.result.aviso)}</p>` : ''}
          <div class="tc-score"><div class="tc-score-n">${s.score}</div><div><b>Pontuação de SEO</b><br><span class="tc-muted">heurística TurboCanal (0 a 100)</span></div></div>
          <table class="tc-table">
            <tr><td>👁 Views</td><td>${fmt(v.views)}</td><td>👍 Likes</td><td>${fmt(v.likes)}</td></tr>
            <tr><td>💬 Coment.</td><td>${fmt(v.comments)}</td><td>⏱ Duração</td><td>${Math.round((v.durationSec || 0) / 60)} min</td></tr>
            <tr><td>📅 Publicado</td><td colspan="3">${esc((v.publishedAt || '').slice(0, 10))}</td></tr>
          </table>
          ${kws.length ? `<div class="tc-sec"><b>Tags do vídeo</b><div class="tc-tags">${kws.map((k) => `<span>${esc(k)}</span>`).join('')}</div></div>` : '<div class="tc-sec tc-muted">Este vídeo não tem tags públicas.</div>'}
          <div class="tc-sec"><b>Checklist</b>${s.checks.map((c) => `<div class="tc-check">${c.ok ? '✅' : '⚠️'} ${esc(c.item)}</div>`).join('')}</div>
          <div class="tc-actions">
            <a class="tc-btn" href="${esc(baseUrl)}/#/ferramentas/palavras" target="_blank" rel="noopener">🔑 Palavras-chave</a>
            <a class="tc-btn" href="${esc(baseUrl)}/#/ferramentas/insights" target="_blank" rel="noopener">🎥 IA assiste</a>
            <a class="tc-btn" href="${esc(baseUrl)}/#/canal" target="_blank" rel="noopener">📺 Meu canal</a>
            <a class="tc-btn" href="${esc(baseUrl)}/#/canal/postar" target="_blank" rel="noopener">⬆️ Postar</a>
          </div>
          <p class="tc-muted tc-foot">${r.credits.unlimited ? 'Conta do administrador: sem consumo de créditos.' : `Usados ${r.credits.charged} créditos nesta análise.`}</p>
        </div>`;
      wire(panel);
    } catch (e) {
      panel.innerHTML = header() + `<div class="tc-body"><p class="tc-err">${esc(e.message)}</p>
        <p class="tc-muted">${e.status === 401 ? 'Sessão expirada: entre de novo pelo ícone da extensão.' : e.status === 409 ? 'Configuração pendente no servidor (nenhum crédito foi cobrado).' : 'Confira se o servidor do TurboCanal está no ar.'}</p></div>`;
      wire(panel);
    }
    panel.dataset.ready = '1';
  }

  function wire(panel) {
    const c = panel.querySelector('.tc-close');
    if (c) c.onclick = () => { panel.remove(); lastVideo = '__closed__' + videoId(); };
  }

  render();
  window.addEventListener('yt-navigate-finish', () => { lastVideo = null; setTimeout(render, 800); });
  setInterval(() => { if (videoId() && !document.getElementById('tc-panel') && lastVideo !== '__closed__' + videoId()) render(); }, 3000);
})();
