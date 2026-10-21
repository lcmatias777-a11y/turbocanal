import { api, getCfg, setCfg, esc, fmt } from './common.js';

const root = document.getElementById('root');
const VERSION = chrome.runtime.getManifest().version;

async function openSite(hash) {
  const { baseUrl } = await getCfg();
  chrome.tabs.create({ url: baseUrl + '/#/' + hash });
}
async function activeVideoId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = String(tab?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|studio\.youtube\.com\/video\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] || m[3] || m[4] : null;
  } catch { return null; }
}
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };

async function updateNotice() {
  const el = document.getElementById('upd');
  if (!el) return;
  try {
    const { baseUrl } = await getCfg();
    const r = await (await fetch(baseUrl + '/api/extension/version', { cache: 'no-store' })).json();
    if (r.version && newer(r.version, VERSION)) {
      el.innerHTML = `<div class="warn">🆕 Versão ${esc(r.version)} disponível. <a href="${esc(baseUrl + r.download)}" target="_blank">Baixar</a>, trocar a pasta e clicar em ↻ em chrome://extensions.</div>`;
    } else el.textContent = '';
  } catch { el.textContent = ''; }
}

function loginView(msg = '') {
  root.innerHTML = `
    <h1>🚀 Turbo<b>Canal</b></h1>
    <p class="muted">Entre com a sua conta do Google (a mesma do site). Depois de entrar no site, a extensão reconhece sozinha.</p>
    <button class="btn" id="go">🔵 Entrar com Google</button>
    <button class="btn sec" id="again">Já entrei, verificar de novo</button>
    <p class="muted">Servidor: <span id="bu"></span> · <a href="#" id="opt">alterar</a> · v${esc(VERSION)}</p>
    <div id="upd"></div>
    <div class="err">${esc(msg)}</div>`;
  getCfg().then((c) => (document.getElementById('bu').textContent = c.baseUrl));
  document.getElementById('opt').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
  document.getElementById('go').onclick = () => chrome.runtime.sendMessage({ type: 'openLogin' });
  document.getElementById('again').onclick = () => main();
  updateNotice();
}

async function main() {
  let me;
  try {
    me = (await api('/me')).user;
  } catch (e) {
    return loginView(e.status === 401 ? '' : 'Não consegui falar com o servidor: ' + e.message + '. Se o site estava parado, ele leva até 1 minuto para acordar; tente de novo.');
  }
  if (!me) return loginView();
  const set = await chrome.storage.sync.get(['tc_badges', 'tc_autopanel']);
  const vid = await activeVideoId();
  root.innerHTML = `
    <h1>🚀 Turbo<b>Canal</b></h1>
    <p>${esc(me.name || me.email)}<br>
      <span class="badge">💎 ${me.unlimited ? 'Ilimitado' : fmt(me.credits) + ' créditos'}</span>
      <span class="muted"> plano ${esc(me.plan?.name || me.plan_id)}</span></p>
    <div id="upd"></div>
    <div class="sw"><label><input type="checkbox" id="swB" ${set.tc_badges !== false ? 'checked' : ''}> VPH e outlier nas miniaturas <span class="muted">(grátis)</span></label></div>
    <div class="sw"><label><input type="checkbox" id="swP" ${set.tc_autopanel !== false ? 'checked' : ''}> Painel automático no vídeo <span class="muted">(1 crédito por vídeo)</span></label></div>
    ${vid ? `<p class="muted" style="margin:8px 0 0">Vídeo aberto: <b>${esc(vid)}</b></p>
    <div class="rowb">
      <button class="btn" id="an">📈 Resumo rápido</button>
      <button class="btn sec" id="ia">✨ IA do vídeo</button>
    </div>
    <div class="rowb"><button class="btn sec" id="cut">✂️ 3 cortes p/ Shorts</button></div>` : '<p class="muted" style="margin:8px 0 0">Abra um vídeo do YouTube para ver o resumo e a IA.</p>'}
    <div class="rowb">
      <button class="btn sec" id="canal">📺 Meu canal</button>
      <button class="btn sec" id="postar">⬆️ Postar</button>
    </div>
    <div class="rowb">
      <button class="btn sec" id="tend">🔥 Tendências</button>
      <button class="btn sec" id="ideias">💡 Ideias</button>
    </div>
    <label>Pesquisa rápida de palavras-chave</label><input id="kw" placeholder="ex.: bedwars dicas">
    <button class="btn sec" id="kwgo">Pesquisar</button>
    <div id="out"></div>
    <p class="muted" style="margin-top:10px"><a href="#" id="dash">Abrir o site</a> · <a href="#" id="sair">Sair da conta</a> · v${esc(VERSION)}</p>`;
  updateNotice();
  document.getElementById('swB').onchange = (e) => chrome.storage.sync.set({ tc_badges: e.target.checked });
  document.getElementById('swP').onchange = (e) => chrome.storage.sync.set({ tc_autopanel: e.target.checked });
  document.getElementById('dash').onclick = (e) => { e.preventDefault(); openSite('dashboard'); };
  document.getElementById('canal').onclick = () => openSite('canal');
  document.getElementById('postar').onclick = () => openSite('canal/postar');
  document.getElementById('tend').onclick = () => openSite('ferramentas/tendencias');
  document.getElementById('ideias').onclick = () => openSite('ferramentas/ideias');
  if (vid) {
    document.getElementById('ia').onclick = () => openSite('ferramentas/insights?video=' + vid);
    document.getElementById('cut').onclick = () => openSite('ferramentas/transformar?video=' + vid + '&mode=shorts');
  }
  document.getElementById('sair').onclick = async (e) => {
    e.preventDefault();
    await setCfg({ token: '' });
    const { baseUrl } = await getCfg();
    try { await chrome.cookies.remove({ url: baseUrl + '/', name: 'tc_token' }); } catch {}
    loginView();
  };

  const an = document.getElementById('an');
  if (an) an.onclick = async () => {
    const out = document.getElementById('out');
    out.innerHTML = '<p class="muted">Analisando…</p>';
    try {
      const r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } });
      const v = r.result.video, s = r.result.seo;
      out.innerHTML = `
        ${r.result.mock ? `<p class="err">⚠️ ${esc(r.result.aviso)}</p>` : ''}
        <div class="out"><b>${esc(v.title)}</b>
          <table><tr><td>👁 Views</td><td>${fmt(v.views)}</td></tr>
          <tr><td>⚡ VPH</td><td>${fmt(v.vph)}</td></tr>
          <tr><td>🔥 Outlier no canal</td><td>${r.result.outlierCanal != null ? String(r.result.outlierCanal).replace('.', ',') + 'x' : '—'}</td></tr>
          <tr><td>📊 Engajamento</td><td>${v.engagement != null ? String(v.engagement).replace('.', ',') + '%' : '—'}</td></tr>
          <tr><td>📈 SEO (heurística)</td><td><b>${s.score}/100</b></td></tr></table>
          ${s.checks.filter((c) => !c.ok).slice(0, 3).map((c) => `<p>⚠️ ${esc(c.item)}: <span class="muted">${esc(c.dica)}</span></p>`).join('') || '<p class="ok">✅ Checklist de SEO completo!</p>'}
        </div>
        <p class="muted">${r.credits.unlimited ? 'Conta do administrador: sem consumo de créditos.' : `Usado ${r.credits.charged} crédito · saldo ${fmt(r.credits.balance)}`}</p>`;
    } catch (e) {
      out.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  };

  const kwgo = async () => {
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
  document.getElementById('kwgo').onclick = kwgo;
  document.getElementById('kw').onkeydown = (e) => { if (e.key === 'Enter') kwgo(); };
}

main();
