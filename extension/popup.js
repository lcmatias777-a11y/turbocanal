import { api, baseUrl, getToken, setCfg, openTab, esc, fmt } from './common.js';

const root = document.getElementById('root');
const VERSION = chrome.runtime.getManifest().version;
const $ = (s) => root.querySelector(s);
let BASE = 'https://turbocanal.onrender.com';

/** Nenhum clique fica mudo: erro sempre aparece na tela. */
function on(sel, fn) {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try { await fn(ev); } catch (e) { msg('err', 'Não consegui: ' + (e?.message || e)); }
  });
}
const msg = (kind, html) => { const b = $('#msg'); if (b) b.innerHTML = `<div class="${kind}">${html}</div>`; };
const go = async (hash) => { if (!(await openTab(BASE + (hash ? '/#/' + hash : '/')))) msg('err', 'O Chrome não deixou abrir a aba. Entre em ' + esc(BASE)); };

async function videoAberto() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = String(tab?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|studio\.youtube\.com\/video\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] || m[2] || m[3] || m[4] : null;
  } catch { return null; }
}
const maisNovo = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
};
async function avisoVersao() {
  const el = $('#upd');
  if (!el) return;
  try {
    const r = await (await fetch(BASE + '/api/extension/version', { cache: 'no-store' })).json();
    if (r.version && maisNovo(r.version, VERSION)) {
      el.innerHTML = `<div class="warn">🆕 Saiu a v${esc(r.version)} (você tem a ${esc(VERSION)}). <a href="#" id="updDl">Baixar</a>, trocar os arquivos da mesma pasta e clicar em <b>recarregar</b> aqui embaixo.</div>`;
      on('#updDl', () => openTab(BASE + (r.download || '/turbocanal-extensao.zip')));
    }
  } catch {}
}

async function main() {
  BASE = await baseUrl();
  const vid = await videoAberto();
  let set = {};
  try { set = await chrome.storage.sync.get(['tc_badges', 'tc_autopanel']); } catch {}

  // A tela é SEMPRE a mesma: as ferramentas. A conta entra como uma linha, nunca como tela.
  root.innerHTML = `
    <h1>🚀 Turbo<b>Canal</b> <span class="ver">v${esc(VERSION)}</span></h1>
    <div id="upd"></div>
    <div id="conta" class="muted">Verificando a sua conta…</div>
    <div class="sw"><label><input type="checkbox" id="swB" ${set.tc_badges !== false ? 'checked' : ''}> VPH e outlier nas miniaturas <span class="muted">(grátis)</span></label></div>
    <div class="sw"><label><input type="checkbox" id="swP" ${set.tc_autopanel !== false ? 'checked' : ''}> Painel automático no vídeo</label></div>
    ${vid
      ? `<p class="muted" style="margin:10px 0 0">Vídeo aberto: <span class="mono">${esc(vid)}</span></p>
         <div class="rowb"><button class="btn" id="an">📈 Resumo rápido</button><button class="btn sec" id="ia">✨ IA do vídeo</button></div>
         <div class="rowb"><button class="btn sec" id="cut">✂️ 3 cortes</button><button class="btn sec" id="capa">🖼️ Baixar capa</button></div>`
      : '<p class="muted" style="margin:10px 0 0">Abra um vídeo do YouTube para ver o resumo e a IA.</p>'}
    <div class="rowb"><button class="btn sec" id="canal">📺 Meu canal</button><button class="btn sec" id="postar">⬆️ Postar</button></div>
    <div class="rowb"><button class="btn sec" id="tend">🔥 Tendências</button><button class="btn sec" id="ideias">💡 Ideias</button></div>
    <label for="kw">Pesquisa rápida de palavras-chave</label>
    <input type="text" id="kw" placeholder="ex.: bedwars dicas">
    <button class="btn sec" id="kwgo">Pesquisar</button>
    <div id="out"></div><div id="msg"></div>
    <p class="muted" style="margin-top:10px"><a href="#" id="dash">Abrir o site</a> · <a href="#" id="diag">testar conexão</a> · <a href="#" id="opt">opções</a> · <a href="#" id="rec">recarregar</a></p>`;

  const sw = (sel, key) => { const el = $(sel); if (el) el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked })); };
  sw('#swB', 'tc_badges');
  sw('#swP', 'tc_autopanel');
  on('#dash', () => go('dashboard'));
  on('#canal', () => go('canal'));
  on('#postar', () => go('canal/postar'));
  on('#tend', () => go('ferramentas/tendencias'));
  on('#ideias', () => go('ferramentas/ideias'));
  on('#opt', () => chrome.runtime.openOptionsPage());
  on('#rec', () => {
    // Depois de trocar os arquivos da pasta, isso evita ter que abrir chrome://extensions.
    msg('ok', 'Recarregando a extensão… feche e abra este menu, e atualize (F5) as abas do YouTube.');
    setTimeout(() => { try { chrome.runtime.reload(); } catch (e) { msg('err', 'Não consegui recarregar: ' + e.message); } }, 300);
  });
  on('#diag', diagnostico);
  if (vid) {
    on('#ia', () => go('ferramentas/insights?video=' + vid));
    on('#cut', () => go('ferramentas/transformar?video=' + vid + '&mode=shorts'));
    on('#capa', () => openTab(`https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`));
    on('#an', () => resumo(vid));
  }
  on('#kwgo', pesquisa);
  const kw = $('#kw');
  if (kw) kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') pesquisa(); });
  avisoVersao();
  mostrarConta();
}

async function mostrarConta() {
  const box = $('#conta');
  let me = null;
  try { me = (await api('/me', { timeout: 20000 })).user; } catch (e) {
    if (e.status !== 401) {
      box.innerHTML = `<div class="conta">⚠️ ${esc(e.message)} <a href="#" id="cRetry">tentar de novo</a></div>`;
      on('#cRetry', mostrarConta);
      return;
    }
  }
  if (me) {
    box.innerHTML = `${esc(me.name || me.email)} <span class="badge">💎 ${me.unlimited ? 'Ilimitado' : fmt(me.credits) + ' créditos'}</span>
      <span class="muted">plano ${esc(me.plan?.name || me.plan_id)}</span> · <a href="#" id="cSair">sair</a>`;
    on('#cSair', async () => {
      await setCfg({ token: '' });
      try { await chrome.cookies.remove({ url: BASE + '/', name: 'tc_token' }); } catch {}
      mostrarConta();
    });
    return;
  }
  box.innerHTML = `<div class="conta">As ferramentas acima que usam o servidor (IA, meu canal, tendências) precisam da sua conta.
    <br>O VPH e o outlier nas miniaturas funcionam sem conta.
    <div class="rowb"><button class="btn" id="cEntrar">🔵 Entrar com Google</button><button class="btn sec" id="cJa">🔄 Já entrei</button></div></div>`;
  on('#cEntrar', async () => {
    await openTab(BASE + '/api/auth/google');
    msg('ok', 'Abri o login do Google numa aba. Quando terminar, volte aqui e clique em "Já entrei".');
  });
  on('#cJa', mostrarConta);
}

async function diagnostico() {
  msg('muted', 'Testando…');
  const linhas = [];
  linhas.push((await getToken()) ? '✅ Sessão encontrada neste navegador' : '⚠️ Sem sessão: entre com o Google no site');
  try {
    const t0 = Date.now();
    const d = await (await fetch(BASE + '/api/health', { cache: 'no-store' })).json();
    linhas.push(`✅ Site no ar (${Date.now() - t0} ms, banco ${esc(d.db || '?')})`);
  } catch { linhas.push('❌ Não consegui falar com o site. Se ele estava parado, espere 1 minuto e tente de novo.'); }
  try {
    const r = await (await fetch(BASE + '/api/extension/version', { cache: 'no-store' })).json();
    linhas.push(r.version === VERSION ? `✅ Extensão atualizada (v${esc(VERSION)})`
      : maisNovo(r.version, VERSION) ? `🆕 Saiu a v${esc(r.version)} e você está na v${esc(VERSION)}: baixe de novo pelo site`
      : `✅ Você está na v${esc(VERSION)} (o site ainda oferece a v${esc(r.version)} para baixar)`);
  } catch {}
  msg('out', linhas.map((l) => `<div>${l}</div>`).join(''));
}

async function resumo(vid) {
  const out = $('#out');
  out.innerHTML = '<p class="muted">Analisando…</p>';
  try {
    const r = await api('/tools/video_panel', { method: 'POST', body: { video: vid } });
    const v = r.result.video, s = r.result.seo;
    out.innerHTML = `<div class="out"><b>${esc(v.title)}</b>
      <table><tr><td>👁 Views</td><td>${fmt(v.views)}</td></tr>
      <tr><td>⚡ VPH</td><td>${fmt(v.vph)}</td></tr>
      <tr><td>🔥 Outlier no canal</td><td>${r.result.outlierCanal != null ? String(r.result.outlierCanal).replace('.', ',') + 'x' : '—'}</td></tr>
      <tr><td>📈 SEO</td><td><b>${s.score}/100</b></td></tr></table></div>
      <p class="muted">${r.credits.unlimited ? 'Administrador: sem consumo.' : `Usado ${r.credits.charged} crédito · saldo ${fmt(r.credits.balance)}`}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="err">${esc(e.message)}</p>` + (e.status === 401 ? '<p class="muted">Entre com o Google acima.</p>' : '');
  }
}

async function pesquisa() {
  const out = $('#out');
  const q = $('#kw').value.trim();
  if (!q) { out.innerHTML = '<p class="muted">Escreva uma palavra-chave.</p>'; return; }
  out.innerHTML = '<p class="muted">Pesquisando…</p>';
  try {
    const r = await api('/tools/keyword_research', { method: 'POST', body: { q } });
    out.innerHTML = `<div class="out"><table>${r.result.terms.slice(0, 10).map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${fmt(t.avgViews)} views médias</td></tr>`).join('')}</table></div>
      <p class="muted">${r.credits.unlimited ? 'Sem consumo (administrador).' : `Usados ${r.credits.charged} créditos · saldo ${fmt(r.credits.balance)}`}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="err">${esc(e.message)}</p>` + (e.status === 401 ? '<p class="muted">Entre com o Google acima.</p>' : '');
  }
}

window.addEventListener('error', (e) => { if (!root.children.length) root.innerHTML = `<div class="err">Erro na extensão: ${esc(e.message)}</div>`; });
main();
