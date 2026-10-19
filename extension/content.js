// Content script do TurboCanal: botão flutuante nas páginas de vídeo do YouTube
// que abre um painel com a análise do vídeo atual (via backend, cobrando créditos
// no servidor, com as mesmas regras do site).
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

  async function cfg() {
    const { baseUrl, token } = await chrome.storage.sync.get(['baseUrl', 'token']);
    return { baseUrl: (baseUrl || 'http://localhost:8787').replace(/\/$/, ''), token: token || '' };
  }

  function videoId() {
    const m = location.href.match(/[?&]v=([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] : null;
  }

  function removePanel() {
    document.getElementById('tc-panel')?.remove();
  }

  async function openPanel() {
    removePanel();
    const panel = document.createElement('div');
    panel.id = 'tc-panel';
    panel.innerHTML = `<button class="tc-close" title="Fechar">✕</button><h3>🚀 Turbo<b>Canal</b></h3><div id="tc-body" class="tc-muted">Carregando…</div>`;
    document.body.appendChild(panel);
    panel.querySelector('.tc-close').onclick = removePanel;
    const body = panel.querySelector('#tc-body');

    const { baseUrl, token } = await cfg();
    if (!token) {
      body.innerHTML = `<span class="tc-warn">Você ainda não entrou na extensão.</span><br>Clique no ícone do TurboCanal na barra do Chrome e faça login (mesma conta do site).`;
      return;
    }
    const vid = videoId();
    if (!vid) {
      body.innerHTML = `<span class="tc-warn">Abra um vídeo para analisar.</span>`;
      return;
    }
    try {
      const r = await fetch(baseUrl + '/api/tools/video_analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ video: vid })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
      const v = data.result.video, s = data.result.seo;
      body.innerHTML = `
        ${data.result.mock ? `<p class="tc-err">⚠️ ${esc(data.result.aviso)}</p>` : ''}
        <b>${esc(v.title)}</b>
        <table>
          <tr><td>👁 Views</td><td>${fmt(v.views)}</td></tr>
          <tr><td>👍 Likes</td><td>${fmt(v.likes)}</td></tr>
          <tr><td>💬 Comentários</td><td>${fmt(v.comments)}</td></tr>
          <tr><td>📈 SEO</td><td><b>${s.score}/100</b> <span class="tc-muted">(heurística)</span></td></tr>
        </table>
        ${s.checks.filter((c) => !c.ok).slice(0, 3).map((c) => `<p>⚠️ <b>${esc(c.item)}</b><br><span class="tc-muted">${esc(c.dica)}</span></p>`).join('') || '<p class="tc-ok">✅ Checklist de SEO completo!</p>'}
        <p class="tc-muted">${data.credits.unlimited ? 'Conta do administrador: sem consumo de créditos.' : `Usados ${data.credits.charged} créditos · saldo ${fmt(data.credits.balance)}`}
        · <a href="${esc(baseUrl)}/#/ferramentas/video" target="_blank" rel="noopener">abrir no painel</a></p>`;
    } catch (e) {
      body.innerHTML = `<span class="tc-err">${esc(e.message)}</span><br><span class="tc-muted">Confira se o servidor do TurboCanal está no ar e o endereço nas opções da extensão.</span>`;
    }
  }

  function ensureFab() {
    if (document.getElementById('tc-fab')) return;
    const b = document.createElement('button');
    b.id = 'tc-fab';
    b.title = 'TurboCanal: analisar este vídeo';
    b.textContent = 'TC';
    b.onclick = openPanel;
    document.body.appendChild(b);
  }

  ensureFab();
  // O YouTube é uma SPA: reinstala o botão a cada navegação interna.
  window.addEventListener('yt-navigate-finish', () => { ensureFab(); removePanel(); });
  setInterval(ensureFab, 4000);
})();
