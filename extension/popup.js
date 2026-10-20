import { api, getCfg, setCfg, esc, fmt } from './common.js';

const root = document.getElementById('root');

async function openDash() {
  const { baseUrl } = await getCfg();
  chrome.tabs.create({ url: baseUrl + '/#/dashboard' });
}

function loginView(msg = '') {
  root.innerHTML = `
    <h1>🚀 Turbo<b>Canal</b></h1>
    <p class="muted">Entre com a sua conta do Google (a mesma do site). Depois de entrar no site, a extensão reconhece sozinha.</p>
    <button class="btn" id="go">🔵 Entrar com Google</button>
    <button class="btn sec" id="again">Já entrei, verificar de novo</button>
    <p class="muted">Servidor: <span id="bu"></span> — <a href="#" id="opt">alterar</a></p>
    <div class="err">${esc(msg)}</div>`;
  getCfg().then((c) => (document.getElementById('bu').textContent = c.baseUrl));
  document.getElementById('opt').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
  document.getElementById('go').onclick = () => chrome.runtime.sendMessage({ type: 'openLogin' });
  document.getElementById('again').onclick = () => main();
}

async function main() {
  let me;
  try {
    me = (await api('/me')).user;
  } catch (e) {
    return loginView(e.status === 401 ? '' : 'Não consegui falar com o servidor: ' + e.message + '. Confira o endereço nas opções.');
  }
  root.innerHTML = `
    <h1>🚀 Turbo<b>Canal</b></h1>
    <p>${esc(me.name || me.email)}<br>
      <span class="badge">💎 ${me.unlimited ? 'Ilimitado' : fmt(me.credits) + ' créditos'}</span>
      <span class="muted"> plano ${esc(me.plan?.name || me.plan_id)}</span></p>
    <div class="rowb">
      <button class="btn" id="an">Analisar vídeo aberto</button>
      <button class="btn sec" id="dash">Abrir painel</button>
    </div>
    <div class="rowb">
      <button class="btn sec" id="canal">📺 Meu canal</button>
      <button class="btn sec" id="postar">⬆️ Postar vídeo</button>
    </div>
    <label>Pesquisa rápida de palavras-chave</label><input id="kw" placeholder="ex.: bedwars dicas">
    <button class="btn sec" id="kwgo">Pesquisar</button>
    <div id="out"></div>
    <p class="muted" style="margin-top:10px"><a href="#" id="sair">Sair da conta</a></p>`;
  document.getElementById('dash').onclick = openDash;
  document.getElementById('canal').onclick = async () => { const { baseUrl } = await getCfg(); chrome.tabs.create({ url: baseUrl + '/#/canal' }); };
  document.getElementById('postar').onclick = async () => { const { baseUrl } = await getCfg(); chrome.tabs.create({ url: baseUrl + '/#/canal/postar' }); };
  document.getElementById('sair').onclick = async (e) => { e.preventDefault(); await setCfg({ token: '' }); const { baseUrl } = await getCfg(); try { await chrome.cookies.remove({ url: baseUrl + '/', name: 'tc_token' }); } catch {} loginView(); };

  document.getElementById('an').onclick = async () => {
    const out = document.getElementById('out');
    out.innerHTML = '<p class="muted">Analisando…</p>';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const m = String(tab?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})/);
      const vid = m && (m[1] || m[2] || m[3]);
      if (!vid) throw new Error('Abra um vídeo do YouTube na aba atual para analisar.');
      const r = await api('/tools/video_analysis', { method: 'POST', body: { video: vid } });
      const v = r.result.video, s = r.result.seo;
      out.innerHTML = `
        ${r.result.mock ? `<p class="err">⚠️ ${esc(r.result.aviso)}</p>` : ''}
        <div class="out"><b>${esc(v.title)}</b>
          <table><tr><td>👁 Views</td><td>${fmt(v.views)}</td></tr>
          <tr><td>👍 Likes</td><td>${fmt(v.likes)}</td></tr>
          <tr><td>💬 Comentários</td><td>${fmt(v.comments)}</td></tr>
          <tr><td>📈 SEO (heurística)</td><td><b>${s.score}/100</b></td></tr></table>
          ${s.checks.filter((c) => !c.ok).slice(0, 3).map((c) => `<p>⚠️ ${esc(c.item)}: <span class="muted">${esc(c.dica)}</span></p>`).join('') || '<p class="ok">✅ Checklist de SEO completo!</p>'}
        </div>
        <p class="muted">${r.credits.unlimited ? 'Conta do administrador: sem consumo de créditos.' : `Usados ${r.credits.charged} créditos · saldo ${fmt(r.credits.balance)}`}</p>`;
    } catch (e) {
      out.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  };

  document.getElementById('kwgo').onclick = async () => {
    const out = document.getElementById('out');
    const q = document.getElementById('kw').value.trim();
    if (!q) return;
    out.innerHTML = '<p class="muted">Pesquisando…</p>';
    try {
      const r = await api('/tools/keyword_research', { method: 'POST', body: { q } });
      out.innerHTML = `
        ${r.result.mock ? `<p class="err">⚠️ ${esc(r.result.aviso)}</p>` : ''}
        <div class="out"><table>${r.result.terms.slice(0, 10).map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${fmt(t.avgViews)} views médias</td></tr>`).join('')}</table></div>
        <p class="muted">${r.credits.unlimited ? 'Sem consumo de créditos (administrador).' : `Usados ${r.credits.charged} créditos · saldo ${fmt(r.credits.balance)}`}</p>`;
    } catch (e) {
      out.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  };
}

main();
