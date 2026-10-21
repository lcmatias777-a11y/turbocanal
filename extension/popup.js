import { api, getCfg, setCfg, getToken, baseUrl, openTab, esc, fmt } from './common.js';

const root = document.getElementById('root');
const VERSION = chrome.runtime.getManifest().version;
const $ = (s) => document.querySelector(s);

/** Todo clique passa por aqui: nunca fica "morto", sempre mostra o que aconteceu. */
function onClick(sel, fn) {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try { await fn(ev); }
    catch (e) { showMsg('err', 'Não consegui fazer isso: ' + (e?.message || e)); }
  });
}
function showMsg(kind, html) {
  const box = $('#msg');
  if (box) box.innerHTML = `<div class="${kind}">${html}</div>`;
}
async function goSite(hash) {
  const base = await baseUrl();
  const ok = await openTab(base + (hash ? '/#/' + hash : '/'));
  if (!ok) showMsg('err', 'O Chrome não deixou abrir a aba. Abra o site na mão: ' + esc(base));
}
async function activeVideoId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = String(tab?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|studio\.youtube\.com\/video\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] || m[3] || m[4] : null;
  } catch { return null; }
}
const newer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
};
async function updateNotice() {
  const el = $('#upd');
  if (!el) return;
  try {
    const base = await baseUrl();
    const r = await (await fetch(base + '/api/extension/version', { cache: 'no-store' })).json();
    if (r.version && newer(r.version, VERSION)) {
      el.innerHTML = `<div class="warn">🆕 Versão ${esc(r.version)} disponível (você tem a ${esc(VERSION)}). <a href="#" id="updDl">Baixar</a>, trocar a pasta e clicar em ↻ em chrome://extensions.</div>`;
      onClick('#updDl', () => openTab(base + (r.download || '/turbocanal-extensao.zip')));
    } else el.textContent = '';
  } catch { el.textContent = ''; }
}

/* ------------------------------ telas ------------------------------ */
function shell(inner) {
  root.innerHTML = `<h1>🚀 Turbo<b>Canal</b> <span class="ver">v${esc(VERSION)}</span></h1><div id="upd"></div>${inner}<div id="msg"></div>`;
  updateNotice();
}

async function loginView(msg = '') {
  const base = await baseUrl();
  shell(`
    <p class="muted">Entre com a sua conta do Google (a mesma do site). Depois de entrar, a extensão reconhece sozinha.</p>
    <button class="btn" id="go">🔵 Entrar com Google</button>
    <button class="btn sec" id="again">🔄 Já entrei, verificar de novo</button>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <p class="muted">Servidor: <span class="mono">${esc(base)}</span> · <a href="#" id="opt">alterar</a> · <a href="#" id="diag">testar conexão</a></p>`);
  onClick('#go', async () => {
    showMsg('ok', 'Abri a tela de login do Google numa aba nova. Depois de entrar, volte aqui e clique em "Já entrei".');
    const ok = await openTab(base + '/api/auth/google');
    if (!ok) showMsg('err', 'O Chrome não deixou abrir a aba. Entre pelo site: ' + esc(base));
  });
  onClick('#again', () => main());
  onClick('#opt', () => chrome.runtime.openOptionsPage());
  onClick('#diag', diagnose);
}

async function diagnose() {
  showMsg('muted', 'Testando…');
  const base = await baseUrl();
  const lines = [];
  const token = await getToken();
  lines.push(token ? '✅ Sessão encontrada no navegador' : '⚠️ Nenhuma sessão: falta entrar com o Google no site');
  try {
    const t0 = Date.now();
    const r = await fetch(base + '/api/health', { cache: 'no-store' });
    const d = await r.json();
    lines.push(`✅ Site no ar (${Date.now() - t0} ms, banco ${esc(d.db || '?')})`);
  } catch { lines.push('❌ Não consegui falar com o site. Se ele estava parado, espere 1 minuto e tente de novo.'); }
  if (token) {
    try {
      const me = (await api('/me')).user;
      lines.push(me ? `✅ Conta: ${esc(me.email)}` : '⚠️ A sessão não vale mais: entre de novo com o Google');
    } catch (e) { lines.push(e.status === 401 ? '⚠️ A sessão não vale mais: entre de novo com o Google' : '❌ ' + esc(e.message)); }
  }
  try {
    const r = await (await fetch(base + '/api/extension/version', { cache: 'no-store' })).json();
    lines.push(r.version === VERSION ? `✅ Extensão atualizada (v${esc(VERSION)})` : `🆕 O site tem a v${esc(r.version)} e você está na v${esc(VERSION)}: baixe de novo, troque os arquivos da MESMA pasta e clique em ↻ em chrome://extensions`);
  } catch {}
  showMsg('out', lines.map((l) => `<div>${l}</div>`).join(''));
}

async function main() {
  shell('<p class="muted">Carregando…</p>');
  let me;
  try {
    me = (await api('/me')).user;
  } catch (e) {
    return loginView(e.status === 401 ? '' : e.message);
  }
  if (!me) return loginView();

  let set = {};
  try { set = await chrome.storage.sync.get(['tc_badges', 'tc_autopanel']); } catch {}
  const vid = await activeVideoId();
  shell(`
    <p>${esc(me.name || me.email)}<br>
      <span class="badge">💎 ${me.unlimited ? 'Ilimitado' : fmt(me.credits) + ' créditos'}</span>
      <span class="muted"> plano ${esc(me.plan?.name || me.plan_id)}</span></p>
    <div class="sw"><label><input type="checkbox" id="swB" ${set.tc_badges !== false ? 'checked' : ''}> VPH e outlier nas miniaturas <span class="muted">(grátis)</span></label></div>
    <div class="sw"><label><input type="checkbox" id="swP" ${set.tc_autopanel !== false ? 'checked' : ''}> Painel automático no vídeo <span class="muted">(1 crédito)</span></label></div>
    ${vid
      ? `<p class="muted" style="margin:8px 0 0">Vídeo aberto: <span class="mono">${esc(vid)}</span></p>
         <div class="rowb"><button class="btn" id="an">📈 Resumo rápido</button><button class="btn sec" id="ia">✨ IA do vídeo</button></div>
         <div class="rowb"><button class="btn sec" id="cut">✂️ 3 cortes</button><button class="btn sec" id="thumb">🖼️ Baixar capa</button></div>`
      : '<p class="muted" style="margin:8px 0 0">Abra um vídeo do YouTube para ver o resumo e a IA.</p>'}
    <div class="rowb"><button class="btn sec" id="canal">📺 Meu canal</button><button class="btn sec" id="postar">⬆️ Postar</button></div>
    <div class="rowb"><button class="btn sec" id="tend">🔥 Tendências</button><button class="btn sec" id="ideias">💡 Ideias</button></div>
    <label>Pesquisa rápida de palavras-chave</label><input id="kw" placeholder="ex.: bedwars dicas">
    <button class="btn sec" id="kwgo">Pesquisar</button>
    <div id="out"></div>
    <p class="muted" style="margin-top:10px"><a href="#" id="dash">Abrir o site</a> · <a href="#" id="diag">testar conexão</a> · <a href="#" id="sair">Sair</a></p>`);

  const sw = (sel, key) => { const el = $(sel); if (el) el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked })); };
  sw('#swB', 'tc_badges');
  sw('#swP', 'tc_autopanel');
  onClick('#dash', () => goSite('dashboard'));
  onClick('#canal', () => goSite('canal'));
  onClick('#postar', () => goSite('canal/postar'));
  onClick('#tend', () => goSite('ferramentas/tendencias'));
  onClick('#ideias', () => goSite('ferramentas/ideias'));
  onClick('#diag', diagnose);
  if (vid) {
    onClick('#ia', () => goSite('ferramentas/insights?video=' + vid));
    onClick('#cut', () => goSite('ferramentas/transformar?video=' + vid + '&mode=shorts'));
    onClick('#thumb', () => openTab(`https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`));
    onClick('#an', resumo);
  }
  onClick('#sair', async () => {
    await setCfg({ token: '' });
    const base = await baseUrl();
    try { await chrome.cookies.remove({ url: base + '/', name: 'tc_token' }); } catch {}
    loginView('Você saiu da conta nesta extensão.');
  });
  onClick('#kwgo', pesquisa);
  const kw = $('#kw');
  if (kw) kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') pesquisa(); });

  async function resumo() {
    const out = $('#out');
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
          <tr><td>📈 SEO</td><td><b>${s.score}/100</b></td></tr></table>
          ${s.checks.filter((c) => !c.ok).slice(0, 3).map((c) => `<p>⚠️ ${esc(c.item)}</p>`).join('') || '<p class="ok">✅ Checklist de SEO completo!</p>'}
        </div>
        <p class="muted">${r.credits.unlimited ? 'Administrador: sem consumo de créditos.' : `Usado ${r.credits.charged} crédito · saldo ${fmt(r.credits.balance)}`}</p>`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  async function pesquisa() {
    const out = $('#out');
    const q = $('#kw').value.trim();
    if (!q) { out.innerHTML = '<p class="muted">Escreva uma palavra-chave.</p>'; return; }
    out.innerHTML = '<p class="muted">Pesquisando…</p>';
    try {
      const r = await api('/tools/keyword_research', { method: 'POST', body: { q } });
      out.innerHTML = `
        ${r.result.mock ? `<p class="err">⚠️ ${esc(r.result.aviso)}</p>` : ''}
        <div class="out"><table>${r.result.terms.slice(0, 10).map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${fmt(t.avgViews)} views médias</td></tr>`).join('')}</table></div>
        <p class="muted">${r.credits.unlimited ? 'Sem consumo de créditos (administrador).' : `Usados ${r.credits.charged} créditos · saldo ${fmt(r.credits.balance)}`}</p>`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
}

// Se algo quebrar fora dos cliques, o usuário vê na tela (nunca uma janela em branco)
window.addEventListener('error', (e) => { if (root.textContent.trim() === 'Carregando…') root.innerHTML = `<div class="err">Erro na extensão: ${esc(e.message)}</div>`; });
main();
