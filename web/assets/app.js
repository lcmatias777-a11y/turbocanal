/* TurboCanal — SPA sem build: roteador por hash + fetch na API do próprio servidor.
   Nada aqui decide permissão ou saldo: tudo é validado no backend. */

const $ = (sel, el = document) => el.querySelector(sel);
const appEl = () => $('#app');

const state = { user: null, pub: {}, costs: [] };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const money = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const dt = (s) => (s ? new Date(s).toLocaleString('pt-BR') : '—');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(data.error || 'Erro na requisição.');
    e.status = r.status; e.data = data;
    throw e;
  }
  return data;
}

function alertBox(kind, html) { return `<div class="alert ${kind}">${html}</div>`; }
function showErr(el, e) { el.innerHTML = alertBox('err', esc(e.message)); }

/* ------------------------------ Navegação ------------------------------ */
const TOOL_LINKS = [
  ['#/ferramentas/palavras', 'Palavras-chave'],
  ['#/ferramentas/video', 'Analisar vídeo'],
  ['#/ferramentas/canal', 'Analisar canal'],
  ['#/ferramentas/tendencias', '🔥 Tendências do seu nicho'],
  ['#/ferramentas/insights', '✨ IA do vídeo (assiste e sugere)'],
  ['#/ferramentas/ideias', '💡 Ideias de vídeos'],
  ['#/ferramentas/preparar', '📝 Preparar publicação'],
  ['#/ferramentas/transformar', '🔁 Transformar vídeo (IA)'],
  ['#/ferramentas/editor', '✂️ Editor de vídeo'],
  ['#/ferramentas/criar-capa', '🎨 Criar capa'],
  ['#/ferramentas/concorrentes', '🏆 Concorrentes'],
  ['#/ferramentas/busca', 'Buscar vídeos']
];

function renderNav() {
  const u = state.user;
  const isAdmin = u && (u.role === 'owner' || u.role === 'admin');
  const route = location.hash || '#/';
  const link = (href, label) =>
    `<a class="navlink ${route.startsWith(href) && href !== '#/' ? 'active' : route === href ? 'active' : ''}" href="${href}">${label}</a>`;
  $('#topbar').innerHTML = `
    <div class="container nav">
      <a class="brand" href="#/">🚀 Turbo<b>Canal</b></a>
      <div class="links">
        ${u ? link('#/dashboard', 'Painel') + link('#/ferramentas/palavras', 'Ferramentas') + link('#/canal', '📺 Meu canal') + link('#/historico', 'Histórico') : ''}
        ${link('#/planos', 'Planos')}
        ${link('#/extensao', 'Extensão')}
        ${link('#/ajuda', 'Ajuda')}
        ${isAdmin ? link('#/admin', '🛠 Admin') : ''}
      </div>
      <div class="spacer"></div>
      ${u
        ? `<span class="badge credits" title="Seu saldo de créditos">💎 ${u.unlimited ? 'Ilimitado' : fmt(u.credits)}</span>
           ${u.role !== 'user' ? `<span class="badge role">${u.role === 'owner' ? 'Administrador principal' : 'Administrador'}</span>` : ''}
           <a class="navlink" href="#/conta">⚙️ Conta</a>
           <a class="navlink" href="#/sair">Sair</a>`
        : `<a class="btn sm" href="#/login">Entrar com Google</a>`}
    </div>`;
}

async function refreshMe() {
  try { state.user = (await api('/me')).user; } catch { state.user = null; }
  renderNav();
}

/* ------------------------------ Páginas ------------------------------ */
const views = {};

views.home = async () => {
  const plans = (await api('/plans')).items;
  appEl().innerHTML = `
    <section class="hero">
      <h1>Faça seu canal crescer com dados de verdade</h1>
      <p>Pesquisa de palavras-chave, análise de SEO de vídeos e canais, tendências e ferramentas de IA para criadores do YouTube. Plano gratuito generoso com recarga mensal de créditos, site e extensão para Chrome na mesma conta.</p>
      <p>
        <a class="btn" href="#/login">Entrar com Google e ganhar 5.000 créditos</a>
        <a class="btn ghost" href="#/planos">Ver planos</a>
        <a class="btn ghost" href="#/extensao">⬇️ Baixar extensão</a>
      </p>
    </section>
    <section class="grid cols3">
      ${[
        ['🔎 Palavras-chave e tendências do seu nicho', 'Descobre o nicho pelos seus vídeos e mostra o que está bombando nele agora, com views por hora (VPH) e vídeos que estão estourando (outliers).'],
        ['📺 Seu canal, como no Studio', 'Postar vídeo com agendamento, criar live com chave de transmissão, editar título, tags e visibilidade, playlists, analytics, comentários, capas e testes A/B.'],
        ['✂️ Editor de vídeo grátis', 'Corte trechos, transforme em Shorts 9:16, acelere, tire o áudio. Roda no seu navegador, sem gastar créditos.'],
        ['🎨 Capas que chamam clique', 'Crie capas com texto grande a partir de um quadro do vídeo e veja a prévia no feed (claro, escuro e celular).'],
        ['🤖 IA que assiste o seu vídeo', 'Você só escolhe o vídeo: a IA assiste, sugere título, descrição, tags e capítulos e acha os 3 melhores cortes para Shorts. Você tira o que não quiser e salva.'],
        ['🏆 Concorrentes', 'Acompanhe canais do seu nicho e descubra quais vídeos deles estão performando acima da média.'],
        ['📈 SEO de cada vídeo', 'Nota de SEO com o que falta arrumar em cada vídeo do seu canal.'],
        ['🧩 Extensão Chrome', 'Painel na página do vídeo do YouTube: VPH, engajamento, tags e SEO, com a mesma conta.']
      ].map(([t, d]) => `<div class="card"><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </section>
    <p class="center" style="margin-top:18px"><a class="btn ghost" href="#/extensao">🧩 Baixar a extensão para Chrome</a></p>
    <h2 class="center" style="margin-top:34px">Planos</h2>
    <p class="center muted small">Créditos renovam todo mês. As comparações de capacidade são metas internas de referência, não números auditados.</p>
    <section class="grid cols3">${plans.map(planCard).join('')}</section>`;
};

function planCard(p) {
  return `<div class="card planCard">
    <h3>${esc(p.name)}</h3>
    <div class="price">${p.price_cents ? money(p.price_cents) : 'Grátis'}<small>/mês</small></div>
    <div><b>${fmt(p.monthly_credits)}</b> créditos por mês</div>
    <p class="muted small">${esc(p.description || '')}</p>
    ${p.price_cents
      ? `<a class="btn" href="#/checkout?plan=${esc(p.id)}">Assinar via Pix</a>`
      : `<a class="btn secondary" href="#/login">Entrar com Google</a>`}
  </div>`;
}

// Botão do Google: aparece sempre; se as credenciais ainda não foram configuradas no
// servidor, explica em vez de fingir que funciona.
function googleButton(label, connect = false) {
  const href = connect ? '/api/auth/google?connect=1' : '/api/auth/google';
  if (state.pub.google_login) return `<p class="center"><a class="btn ghost" href="${href}">🔵 ${label}</a></p>`;
  return `<p class="center"><button class="btn ghost" type="button" onclick="alert('O login com Google ainda não foi ativado neste servidor: falta o administrador criar as credenciais no Google Cloud (que exige verificação em duas etapas na conta Google) e colocá-las no servidor. Assim que ativar, este botão funciona.')">🔵 ${label}</button>
    <br><span class="muted small">aguardando configuração do administrador</span></p>`;
}

views.login = async (params) => {
  appEl().innerHTML = `
    <div class="card" style="max-width:440px;margin:30px auto;text-align:center">
      <h2>Entrar no TurboCanal</h2>
      ${params.get('erro') ? alertBox('err', esc(params.get('erro'))) : ''}
      <p class="muted">Entre com sua conta do Google (a mesma do seu canal do YouTube). Sua conta é criada automaticamente na primeira vez, com 5.000 créditos.</p>
      ${googleButton('Entrar com Google')}
      <p class="muted small">Ao entrar, você autoriza a leitura de dados públicos do YouTube para as ferramentas de pesquisa. Gerenciar o seu canal (capas, vídeos, lives) é uma autorização separada, feita em "Meu canal".</p>
      <p class="small"><a href="/privacidade">Privacidade</a> · <a href="/termos">Termos de uso</a></p>
    </div>`;
};

views.cadastro = async (p) => views.login(p);

views.sair = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  state.user = null; renderNav();
  location.hash = '#/';
};

function needLogin() {
  appEl().innerHTML = `<div class="card center" style="max-width:420px;margin:40px auto">
    <h3>Faça login para continuar</h3>
    <p><a class="btn" href="#/login">Entrar com Google</a></p></div>`;
}

views.dashboard = async () => {
  if (!state.user) return needLogin();
  const u = state.user;
  const hist = (await api('/history')).items.slice(0, 8);
  const ytBanner = u.youtube?.connected ? ''
    : !u.youtube?.readonly
      ? `<div class="card" style="border-color:var(--warn)"><h3>⚠️ Falta 1 passo: autorizar o YouTube</h3>
          <p class="muted">Sem essa autorização as ferramentas de pesquisa, o painel da extensão e o "Meu canal" não conseguem falar com o YouTube. Clique abaixo, escolha a sua conta e aceite as permissões. Leva 10 segundos e só precisa ser feito uma vez.</p>
          ${googleButton('Vincular meu canal do YouTube', true)}</div>`
      : `<div class="card"><p class="small">✅ Pesquisas liberadas. Para <b>postar, editar, criar lives, responder comentários e testar capas</b>, <a href="/api/auth/google?connect=1">vincule também o seu canal</a>.</p></div>`;
  const admin = u.role === 'owner' || u.role === 'admin';
  const aiBanner = admin && !state.pub.gemini_configured
    ? `<div class="card" style="border-color:var(--warn)"><h3>🤖 Falta ligar a IA (só você, administrador, vê este aviso)</h3>
        <p class="muted">Sem a chave do Gemini, a IA do vídeo, os cortes para Shorts, ideias, preparar e sugestões de resposta ficam desligados (e não cobram nada). A chave é sua e só você pode criar e colar:</p>
        <ol class="muted"><li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Abra o Google AI Studio ↗</a> com a conta lcmatias777@gmail.com e clique em <b>Criar chave de API</b>.</li>
          <li>Copie a chave e cole em <a href="#/admin/config">Admin &gt; Configurações</a>, no campo do Gemini. Salve e clique em <b>Testar a IA</b>.</li></ol>
        <p class="muted small">O uso é gratuito, com limites por minuto e por dia do próprio Google.</p></div>`
    : '';
  appEl().innerHTML = `
    <h1>Olá, ${esc(u.name || u.email.split('@')[0])} 👋</h1>
    ${aiBanner}
    ${ytBanner}
    <section class="grid cols3">
      <div class="card"><h3>Créditos</h3><div class="kpi">💎 ${u.unlimited ? 'Ilimitado' : fmt(u.credits)}</div>
        <p class="muted small">${u.unlimited ? 'Conta do administrador principal: uso ilimitado e isento de cobrança.' : 'Plano Free recarrega todo mês. Cada ferramenta mostra o custo antes de usar.'}</p></div>
      <div class="card"><h3>Seu plano</h3><div class="kpi">${esc(u.plan?.name || u.plan_id)}</div>
        <p class="muted small">${u.plan?.price_cents ? money(u.plan.price_cents) + '/mês' : 'Gratuito'} · ${fmt(u.plan?.monthly_credits)} créditos/mês</p>
        ${u.unlimited ? '' : '<a class="btn sm secondary" href="#/planos">Fazer upgrade</a>'}</div>
      <div class="card"><h3>📺 Meu canal</h3><p class="muted small">${u.youtube?.connected ? `Conectado: <b>${esc(u.youtube.channel_title || 'canal')}</b>. Capas, A/B, edição de títulos.` : 'Conecte seu canal do YouTube para gerenciar capas, títulos e testes A/B.'}</p>
        <a class="btn sm secondary" href="#/canal">${u.youtube?.connected ? 'Abrir meu canal' : 'Conectar canal'}</a></div>
      <div class="card"><h3>Extensão Chrome</h3><p class="muted small">Analise vídeos direto no YouTube com a mesma conta.</p>
        <a class="btn sm secondary" href="#/extensao">Baixar e instalar</a></div>
    </section>
    <h2>Ferramentas</h2>
    <section class="grid cols3">
      ${TOOL_LINKS.map(([h, l]) => `<a class="card" href="${h}" style="display:block"><h3>${l}</h3><span class="muted small">${toolCostLabel(h)}</span></a>`).join('')}
    </section>
    <h2>Atividade recente</h2>
    <div class="card scroll">${histTable(hist)}
      <p class="small"><a href="#/historico">Ver histórico completo →</a></p></div>`;
};

function toolCostLabel(hash) {
  const map = {
    palavras: 'keyword_research', video: 'video_analysis', canal: 'channel_analysis',
    tendencias: 'trends', titulos: 'title_ai', descricao: 'description_ai', busca: 'video_search',
    insights: 'video_insights_ai', preparar: 'prep_ai', transformar: 'transform_ai', concorrentes: 'competitor_check', ideias: 'ideas_ai'
  };
  const last = hash.split('/').pop();
  if (last === 'editor' || last === 'criar-capa') return 'Grátis (roda no seu navegador)';
  const key = map[last];
  const c = state.costs.find((x) => x.tool === key);
  if (!c) return '';
  return state.user?.unlimited ? 'Incluído (ilimitado)' : `${c.cost} créditos por uso`;
}

function histTable(items) {
  if (!items.length) return '<p class="muted">Nenhuma atividade ainda. Experimente uma ferramenta!</p>';
  return `<table><tr><th>Quando</th><th>Operação</th><th>Créditos</th><th>Saldo</th></tr>
    ${items.map((h) => `<tr><td>${dt(h.created_at)}</td><td>${esc(h.note || h.tool || '')}</td>
      <td style="color:${h.delta >= 0 ? 'var(--ok)' : 'var(--err)'}">${h.delta >= 0 ? '+' : ''}${fmt(h.delta)}</td>
      <td>${fmt(h.balance_after)}</td></tr>`).join('')}</table>`;
}

views.historico = async () => {
  if (!state.user) return needLogin();
  const items = (await api('/history')).items;
  appEl().innerHTML = `<h1>Histórico de créditos e análises</h1><div class="card scroll">${histTable(items)}</div>`;
};

/* ------------------------------ Ferramentas ------------------------------ */
function creditsNote(credits) {
  if (!credits) return '';
  if (credits.unlimited) return alertBox('info', 'Conta do administrador principal: nenhum crédito foi consumido (uso ilimitado).');
  if (credits.reused) return alertBox('info', 'Requisição repetida detectada: nenhum crédito foi cobrado de novo.');
  return alertBox('ok', `${credits.charged === 1 ? 'Foi usado <b>1</b> crédito' : `Foram usados <b>${credits.charged}</b> créditos`}. Saldo atual: <b>${fmt(credits.balance)}</b>.`);
}
function resultAviso(result) {
  const parts = [];
  if (result?.mock) parts.push('⚠️ ' + esc(result.aviso || 'Dados de exemplo (modo de teste).'));
  else if (result?.aviso) parts.push('ℹ️ ' + esc(result.aviso));
  return parts.length ? alertBox('warn', parts.join('<br>')) : '';
}

function toolPage({ title, desc, toolKey, formHtml, getBody, render, after, onMount }) {
  return async (params) => {
    if (!state.user) return needLogin();
    // Campos podem vir no endereço (ex.: #/ferramentas/insights?video=ID, usado pela extensão).
    // Só preenche: nada roda nem cobra crédito sem o clique em "Executar".
    const fromUrl = {};
    if (params) for (const [k, v] of params) fromUrl[k] = v;
    if (Object.keys(fromUrl).length) state.toolPrefill = { ...fromUrl, ...(state.toolPrefill || {}) };
    const cost = state.costs.find((c) => c.tool === toolKey)?.cost;
    appEl().innerHTML = `
      <h1>${title}</h1>
      <p class="muted">${desc} ${cost != null ? `· <span class="pill">${state.user.unlimited ? 'Incluído (ilimitado)' : cost + ' créditos por uso'}</span>` : ''}</p>
      <div class="card"><form id="f">${formHtml}
        <p><button class="btn">Executar <span id="sp"></span></button></p></form></div>
      <div id="msg"></div><div id="out"></div>`;
    if (onMount) onMount($('#f'));
    if (state.toolPrefill) {
      for (const [k, v] of Object.entries(state.toolPrefill)) { const inp = $('#f').querySelector(`[name="${k}"]`); if (inp) inp.value = v; }
      state.toolPrefill = null;
    }
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const body = getBody(new FormData(ev.target));
      $('#sp').innerHTML = '<span class="spin"></span>'; $('#msg').innerHTML = ''; $('#out').innerHTML = '';
      try {
        const r = await api('/tools/' + toolKey, { method: 'POST', body });
        await refreshMe();
        $('#msg').innerHTML = creditsNote(r.credits) + resultAviso(r.result);
        $('#out').innerHTML = render(r.result);
        if (after) after(r.result, $('#out'));
      } catch (e) {
        const needsGoogle = e.status === 409 && /Entre com o Google/i.test(e.message);
        $('#msg').innerHTML = alertBox(needsGoogle ? 'warn' : 'err', esc(e.message) + (e.status === 402 ? ' <a href="#/planos">Ver planos</a>' : '') + (e.status === 409 ? ' <span class="muted small">(nenhum crédito foi cobrado)</span>' : ''))
          + (needsGoogle ? googleButton('Autorizar o YouTube agora (1 clique)', true) : '');
      }
      $('#sp').innerHTML = '';
    };
  };
}

function outlierPill(v) {
  if (v.outlier == null) return '';
  if (v.outlier >= 2) return `<span class="pill ok" title="Views ${v.outlier}x a mediana do grupo">🔥 ${v.outlier}x</span>`;
  if (v.outlier <= 0.5) return `<span class="pill" title="Abaixo da mediana do grupo">${v.outlier}x</span>`;
  return `<span class="pill" title="Views em relação à mediana do grupo">${v.outlier}x</span>`;
}
function videoTable(items) {
  return `<div class="card scroll"><table><tr><th></th><th>Vídeo</th><th>Canal</th><th>Views</th><th title="Views por hora desde a publicação">VPH</th><th title="Views em relação à mediana dos vídeos desta lista">Outlier</th><th>Engaj.</th><th>Publicado</th></tr>
    ${items.map((v) => `<tr>
      <td>${v.thumb ? `<img src="${esc(v.thumb)}" width="96" style="border-radius:6px">` : '🎬'}</td>
      <td>${v.mock ? esc(v.title) : `<a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>`}</td>
      <td>${esc(v.channel)}</td><td>${fmt(v.views)}</td><td>${fmt(v.vph)}</td><td>${outlierPill(v)}</td><td class="small">${v.engagement != null ? v.engagement + '%' : '—'}</td><td class="small">${dt(v.publishedAt).split(',')[0]}</td></tr>`).join('')}
  </table><p class="muted small">VPH = views por hora desde a publicação. Outlier = views em relação à mediana desta lista (🔥 = 2x ou mais). Métricas calculadas com dados públicos.</p></div>`;
}

views['ferramentas/busca'] = toolPage({
  title: '🔎 Buscar vídeos', toolKey: 'video_search',
  desc: 'Pesquise vídeos públicos e veja estatísticas reais da API oficial do YouTube.',
  formHtml: `<label>O que você quer buscar?</label><input name="q" required maxlength="200" placeholder="ex.: minecraft bedwars dicas">`,
  getBody: (fd) => ({ q: fd.get('q') }),
  render: (r) => videoTable(r.items)
});

views['ferramentas/palavras'] = toolPage({
  title: '🔑 Pesquisa de palavras-chave', toolKey: 'keyword_research',
  desc: 'Termos relacionados extraídos de títulos e tags dos vídeos que performam na sua busca, com média de views.',
  formHtml: `<label>Palavra-chave base</label><input name="q" required maxlength="200" placeholder="ex.: geometry dash iniciante">`,
  getBody: (fd) => ({ q: fd.get('q') }),
  render: (r) => `
    <div class="card scroll"><h3>Termos sugeridos (base: ${r.baseadoEm} vídeos)</h3>
    <table><tr><th>Termo</th><th>Aparece em</th><th>Média de views</th><th>Máx. views</th><th>Score</th></tr>
      ${r.terms.map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${t.videos} vídeos</td><td>${fmt(t.avgViews)}</td><td>${fmt(t.maxViews)}</td><td>${t.score}</td></tr>`).join('')}
    </table></div>
    <h3>Vídeos que mais performam nessa busca</h3>${videoTable(r.topVideos)}`
});

views['ferramentas/video'] = toolPage({
  title: '🎬 Análise de vídeo (SEO)', toolKey: 'video_analysis',
  desc: 'Cole o link de qualquer vídeo público e receba estatísticas + checklist de SEO com dicas.',
  formHtml: `<label>Link ou ID do vídeo</label><input name="video" required placeholder="https://www.youtube.com/watch?v=...">`,
  getBody: (fd) => ({ video: fd.get('video') }),
  render: (r) => {
    const v = r.video, s = r.seo;
    return `<div class="card"><div class="thumbrow">
        ${v.thumb ? `<img src="${esc(v.thumb)}">` : ''}
        <div><h3>${esc(v.title)}</h3><p class="muted">${esc(v.channel)} · ${dt(v.publishedAt).split(',')[0]}</p>
        <p>👁 ${fmt(v.views)} views · 👍 ${fmt(v.likes)} · 💬 ${fmt(v.comments)} · ⏱ ${Math.round(v.durationSec / 60)} min</p>
        <p><span class="pill">⚡ ${fmt(v.vph)} views/hora</span> <span class="pill">💬 engajamento ${v.engagement != null ? v.engagement + '%' : '—'}</span></p>
        ${(v.tags || []).length ? `<p class="small">Tags: ${v.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')} <button class="btn sm ghost" type="button" onclick="navigator.clipboard.writeText(${esc(JSON.stringify((v.tags || []).join(', ')))})">copiar tags</button></p>` : '<p class="small muted">Sem tags públicas.</p>'}</div></div></div>
      <div class="card"><h3>Pontuação de SEO: ${s.score}/100 <span class="muted small">(heurística TurboCanal)</span></h3>
      <ul class="checklist">${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><b>${esc(c.item)}</b><br><span class="muted small">${esc(c.dica)}</span></li>`).join('')}</ul></div>`;
  }
});

views['ferramentas/canal'] = toolPage({
  title: '📺 Análise de canal', toolKey: 'channel_analysis',
  desc: 'Informe o @handle ou link de um canal público (o seu ou de concorrentes).',
  formHtml: `<label>@handle, link ou ID do canal</label><input name="channel" required placeholder="ex.: @canaldojogo">`,
  getBody: (fd) => ({ channel: fd.get('channel') }),
  render: (r) => `
    <div class="card"><div class="thumbrow">${r.channel.thumb ? `<img src="${esc(r.channel.thumb)}" style="border-radius:50%;width:90px">` : ''}
      <div><h3>${esc(r.channel.title)}</h3>
      <p>👥 ${r.channel.subs == null ? 'inscritos ocultos' : fmt(r.channel.subs) + ' inscritos'} · 👁 ${fmt(r.channel.views)} views totais · 🎬 ${fmt(r.channel.videos)} vídeos</p>
      <p class="muted small">No ar desde ${dt(r.channel.publishedAt).split(',')[0]} · Média de views dos últimos vídeos: <b>${fmt(r.mediaViewsRecentes)}</b></p></div></div></div>
    <h3>Últimos vídeos</h3>${videoTable(r.recent)}`
});

/* ------------------------------ Escolher vídeo (sem digitar) ------------------------------ */
const ytIdOf = (s) => { const m = String(s || '').trim().match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/); return m ? m[1] || m[2] || m[3] || m[4] : null; };
const costLabel = (tool) => { const c = state.costs.find((x) => x.tool === tool); if (!c) return ''; return state.user?.unlimited ? 'incluído (ilimitado)' : `${fmt(c.cost)} créditos`; };

function aiMissingBanner() {
  if (state.pub.gemini_configured) return '';
  const admin = state.user && (state.user.role === 'owner' || state.user.role === 'admin');
  return alertBox('warn', admin
    ? '🤖 A IA está desligada: falta colar a chave do Gemini. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">1) Criar chave grátis ↗</a> · <a href="#/admin/config">2) Colar em Configurações</a>'
    : '🤖 A IA ainda não foi ligada pelo administrador do site. Enquanto isso, nada é cobrado.');
}

/**
 * Lista os vídeos do canal vinculado para escolher com um clique (e, se permitido,
 * aceita o link de um vídeo público). Chama onPick({ id, title, thumb, privacy, own }).
 */
async function videoPicker(box, { onPick, allowLink = true, preselect = null }) {
  box.innerHTML = '<p class="muted small"><span class="spin"></span> carregando seus vídeos…</p>';
  let vids = [], note = '';
  if (state.user?.youtube?.connected) {
    try { vids = (await api('/channel/videos')).videos; } catch (e) { note = alertBox('warn', esc(e.message)); }
  } else {
    note = alertBox('info', 'Vincule seu canal para escolher os seus vídeos com um clique. <a href="/api/auth/google?connect=1">Vincular meu canal</a>');
  }
  box.innerHTML = `${note}
    ${vids.length ? `<p class="small muted">Escolha o vídeo:</p><div class="vpick">${vids.map((v) => `
      <button type="button" class="vp" data-vid="${esc(v.id)}">${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : '<div class="vpnone">🎬</div>'}
        <span class="vpt">${esc(v.title)}</span><span class="vpm">${esc(privLabel(v.privacy))} · ${fmt(v.views)} views</span></button>`).join('')}</div>` : ''}
    ${allowLink ? `<div class="row" style="margin-top:8px"><div><input id="vpLink" placeholder="${vids.length ? 'ou cole o link de outro vídeo público' : 'cole o link de um vídeo público do YouTube'}"></div><div class="fit"><button class="btn sm secondary" type="button" id="vpGo">Usar este link</button></div></div>` : ''}`;
  const choose = (id) => {
    for (const b of box.querySelectorAll('.vp')) b.classList.toggle('sel', b.dataset.vid === id);
    const v = vids.find((x) => x.id === id);
    onPick(v ? { id: v.id, title: v.title, thumb: v.thumb, privacy: v.privacy, own: true } : { id, title: null, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, privacy: null, own: false });
  };
  for (const b of box.querySelectorAll('.vp')) b.onclick = () => choose(b.dataset.vid);
  const go = $('#vpGo', box);
  if (go) go.onclick = () => { const id = ytIdOf($('#vpLink', box).value); if (!id) { $('#vpLink', box).focus(); return; } choose(id); };
  const pre = ytIdOf(preselect);
  if (pre && (allowLink || vids.some((v) => v.id === pre))) choose(pre);
  return vids;
}

/* ------------------------------ IA do vídeo (assiste e sugere) ------------------------------ */
async function videoAIView(params) {
  if (!state.user) return needLogin();
  appEl().innerHTML = `
    <h1>✨ IA do vídeo</h1>
    <p class="muted">Escolha o vídeo e pronto: a IA <b>assiste</b> (vídeos públicos), olha quadros reais dele e sugere título, descrição, tags, hashtags, capítulos e textos de capa. Você tira o que não quiser, revisa e salva direto no YouTube. Não precisa escrever nada. <span class="pill">${costLabel('video_insights_ai')}</span></p>
    ${aiMissingBanner()}
    <div class="card"><div id="vpBox"></div><div id="vaSel"></div></div>
    <div id="msg"></div><div id="out"></div>`;
  let picked = null;
  const sel = $('#vaSel');
  const onPick = (v) => {
    picked = v;
    sel.innerHTML = `<div class="thumbrow" style="margin-top:14px">${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}
      <div><b>${esc(v.title || 'Vídeo ' + v.id)}</b><p class="muted small">${v.own ? 'Vídeo do seu canal: dá para salvar as mudanças direto no YouTube.' : 'Vídeo por link: a IA analisa; salvar só funciona em vídeos do seu canal.'}</p>
      <p><button class="btn" id="vaGo" type="button">✨ Gerar sugestões</button> <span class="muted small">${costLabel('video_insights_ai')}</span></p></div></div>`;
    $('#vaGo').onclick = run;
  };
  await videoPicker($('#vpBox'), { onPick, preselect: params?.get('video') });

  async function run() {
    const btn = $('#vaGo'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> a IA está assistindo…';
    $('#msg').innerHTML = ''; $('#out').innerHTML = '';
    try {
      const r = await api('/tools/video_insights_ai', { method: 'POST', body: { video: picked.id } });
      await refreshMe();
      $('#msg').innerHTML = creditsNote(r.credits) + alertBox(r.result.assistiu ? 'ok' : 'info', esc(r.result.aviso));
      renderSuggestions($('#out'), r.result);
    } catch (e) {
      $('#msg').innerHTML = alertBox(e.status === 409 ? 'warn' : 'err', esc(e.message)) + aiAdminHint(e);
    }
    btn.disabled = false; btn.textContent = '✨ Gerar de novo';
  }
}

function aiAdminHint(e) {
  const admin = state.user && (state.user.role === 'owner' || state.user.role === 'admin');
  return admin && e.status === 409 && /Gemini|IA ainda não/i.test(e.message) ? '<p><a class="btn sm" href="#/admin/config">Ligar a IA agora</a></p>' : '';
}

/** Editor das sugestões: escolher título, editar descrição, tirar tags/hashtags, Pronto e Salvar. */
function renderSuggestions(out, r) {
  const s = r.sugestoes, v = r.video;
  const ed = { tags: [...s.tags], hashtags: [...s.hashtags], chapters: s.capitulos.length > 0 };
  out.innerHTML = `
    <div class="grid cols2">
      <div class="card"><h3>O que a IA entendeu</h3><p>${esc(s.resumo)}</p>
        ${s.melhorias.length ? `<p class="small"><b>Dicas para os próximos vídeos:</b></p><ul class="small">${s.melhorias.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>
      <div class="card"><h3>Textos para a capa</h3>${s.capa_textos.map((t) => `<p><span class="pill">${esc(t)}</span> <a href="#/ferramentas/criar-capa" data-capatxt="${esc(t)}" class="small">montar capa com este texto</a></p>`).join('') || '<p class="muted small">Sem sugestões.</p>'}
</div>
    </div>
    <div class="card"><h3>Título</h3>
      ${s.titulos.map((t, i) => `<label class="opt"><input type="radio" name="vaT" value="${i}" ${i === 0 ? 'checked' : ''}> ${esc(t)} <span class="muted small">(${t.length})</span></label>`).join('')}
      <label class="opt"><input type="radio" name="vaT" value="atual"> manter o atual: <span class="muted">${esc(v.title || '')}</span></label></div>
    <div class="card"><h3>Descrição</h3><textarea id="vaDesc" style="min-height:200px">${esc(s.descricao)}</textarea>
      ${s.capitulos.length ? `<p class="small"><label class="opt"><input type="checkbox" id="vaCap" checked> incluir os capítulos que a IA marcou:</label></p><pre class="small muted" style="white-space:pre-wrap">${s.capitulos.map((c) => `${esc(c.tempo)} ${esc(c.titulo)}`).join('\n')}</pre>` : '<p class="muted small">Sem capítulos (a IA só marca capítulos quando consegue assistir ao vídeo).</p>'}</div>
    <div class="card"><h3>Tags <span class="muted small" id="vaTagCount"></span></h3>
      <p class="muted small">Clique no ✕ para tirar as que não quiser.</p><div id="vaTags" class="chips"></div>
      <div class="row" style="margin-top:8px"><div><input id="vaTagNew" placeholder="adicionar uma tag e apertar Enter"></div>
        <div class="fit"><button class="btn sm ghost" type="button" id="vaTagsKeep">+ juntar com as ${fmt((v.tags || []).length)} tags atuais</button></div></div></div>
    <div class="card"><h3>Hashtags (vão no fim da descrição)</h3><div id="vaHash" class="chips"></div></div>
    <p><button class="btn" type="button" id="vaDone">✅ Pronto</button></p>
    <div id="vaReview"></div>`;
  const chips = (box, arr, onChange) => {
    box.innerHTML = arr.map((t, i) => `<span class="chip">${esc(t)} <button type="button" title="tirar" data-i="${i}">✕</button></span>`).join('') || '<span class="muted small">nenhuma</span>';
    for (const b of box.querySelectorAll('button')) b.onclick = () => { arr.splice(+b.dataset.i, 1); chips(box, arr, onChange); onChange(); };
    onChange();
  };
  const tagCount = () => { const n = ed.tags.join(',').length; $('#vaTagCount').innerHTML = `${ed.tags.length} tags · ${n}/500 caracteres${n > 500 ? ' <span class="pill err">passou do limite do YouTube</span>' : ''}`; };
  chips($('#vaTags'), ed.tags, tagCount);
  chips($('#vaHash'), ed.hashtags, () => {});
  $('#vaTagNew').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (const t of e.target.value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)) if (!ed.tags.includes(t.toLowerCase())) ed.tags.push(t.toLowerCase());
    e.target.value = ''; chips($('#vaTags'), ed.tags, tagCount);
  };
  $('#vaTagsKeep').onclick = () => { for (const t of v.tags || []) if (!ed.tags.includes(String(t).toLowerCase())) ed.tags.push(String(t).toLowerCase()); chips($('#vaTags'), ed.tags, tagCount); };
  for (const a of out.querySelectorAll('[data-capatxt]')) a.onclick = () => { state.thumbText = a.dataset.capatxt; };

  const finalData = () => {
    const ti = out.querySelector('input[name=vaT]:checked')?.value;
    const title = ti === 'atual' || ti == null ? v.title : s.titulos[+ti];
    let description = $('#vaDesc').value.trim();
    if ($('#vaCap')?.checked && s.capitulos.length) description += '\n\n' + s.capitulos.map((c) => `${c.tempo} ${c.titulo}`).join('\n');
    if (ed.hashtags.length) description += '\n\n' + ed.hashtags.join(' ');
    return { title: String(title || '').slice(0, 100), description: description.slice(0, 5000), tags: ed.tags };
  };
  $('#vaDone').onclick = () => {
    const f = finalData();
    const rv = $('#vaReview');
    rv.innerHTML = `<div class="card" style="border-color:var(--ok)"><h3>Revise antes de salvar</h3>
      <p><b>Título:</b> ${esc(f.title)}</p>
      <p><b>Descrição:</b></p><pre style="white-space:pre-wrap" class="small">${esc(f.description)}</pre>
      <p><b>Tags (${f.tags.length}):</b> ${f.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</p>
      ${r.own
        ? `<p><button class="btn" type="button" id="vaSave">💾 Salvar no YouTube</button> <span class="muted small">${costOf('video_update')}</span> <button class="btn sm ghost" type="button" id="vaBack">✏️ voltar a editar</button></p>`
        : `<p class="muted small">Este vídeo não é do seu canal: copie o que quiser.</p><p>${copyBtn(f.title, 'copiar título')} ${copyBtn(f.description, 'copiar descrição')} ${copyBtn(f.tags.join(', '), 'copiar tags')}</p>`}
      <div id="vaSaveMsg"></div></div>`;
    rv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const back = $('#vaBack'); if (back) back.onclick = () => { rv.innerHTML = ''; $('#vaDone').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const save = $('#vaSave');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        if (f.tags.join(',').length > 500) throw new Error('As tags passam de 500 caracteres (limite do YouTube). Tire algumas.');
        const x = await api('/channel/videos/' + v.id, { method: 'PUT', body: f });
        await refreshMe();
        $('#vaSaveMsg').innerHTML = alertBox('ok', `✅ Salvo no YouTube! <a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">ver o vídeo</a> · <a href="https://studio.youtube.com/video/${esc(v.id)}/edit" target="_blank" rel="noopener">abrir no Studio</a>. ` + creditsNote(x.credits));
      } catch (e) { $('#vaSaveMsg').innerHTML = alertBox('err', esc(e.message)); save.disabled = false; }
    };
  };
}

views['ferramentas/insights'] = videoAIView;
views['ferramentas/titulos'] = videoAIView; // sugerir título agora parte do próprio vídeo (sem caixa de texto)
views['ferramentas/descricao'] = videoAIView;

views['ferramentas/capa'] = (p) => views['ferramentas/criar-capa'](p); // capa com IA foi retirada: abre o criador de capas

/* ------------------------------ Tendências do seu nicho ------------------------------ */
const CATS = { 20: 'Jogos', 24: 'Entretenimento', 22: 'Pessoas e blogs', 23: 'Comédia', 27: 'Educação', 28: 'Ciência e tecnologia', 26: 'Estilo e dicas', 10: 'Música', 17: 'Esportes', 2: 'Carros', 15: 'Animais', 1: 'Filmes e animação', 19: 'Viagens', 25: 'Notícias' };
const NICHE_STOP = new Set('como para com que uma meu minha você voce mais muito isso esse essa dos das por sem the and you vídeo video videos shorts parte part live novo nova 2024 2025 2026 melhor melhores truque truques dica dicas tutorial ninguém ninguem nada gastar vencer ganhar jogando jogar jogo jogos gameplay iniciante iniciantes fácil facil rápido rapido guia completo todos tudo aqui agora hoje primeira primeiro vez dias muito minutos segredo incrível incrivel'.split(' '));
function detectNiche(videos) {
  const score = {}, cats = {};
  for (const v of videos) {
    const w = Math.log10(10 + (v.views || 0));
    for (const t of v.tags || []) { const k = String(t).toLowerCase().trim(); if (k.length >= 3 && k.length <= 30 && !NICHE_STOP.has(k)) score[k] = (score[k] || 0) + w * 3; }
    for (const word of String(v.title || '').toLowerCase().split(/[^a-zà-ú0-9]+/i)) if (word.length >= 4 && !NICHE_STOP.has(word)) score[word] = (score[word] || 0) + w;
    if (v.categoryId) cats[v.categoryId] = (cats[v.categoryId] || 0) + 1;
  }
  const terms = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const picked = [];
  for (const t of terms) { if (picked.some((p) => p.includes(t) || t.includes(p))) continue; picked.push(t); if (picked.length === 2) break; }
  const cat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { terms: picked, cat };
}

views['ferramentas/tendencias'] = async () => {
  if (!state.user) return needLogin();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('tc_nicho') || 'null'); } catch {}
  appEl().innerHTML = `
    <h1>🔥 Tendências do seu nicho</h1>
    <p class="muted">Vídeos bombando agora no SEU assunto: os mais vistos dos últimos 7 dias para os termos do seu canal (ordenados por views por hora) e o que está em alta na categoria do canal. <span class="pill">${costLabel('trends')}</span></p>
    <div class="card"><div id="trInfo" class="small muted"><span class="spin"></span> lendo os seus vídeos para descobrir o nicho…</div>
      <label>Seu nicho (até 2 termos, separados por vírgula)</label><input id="trKw" maxlength="120" placeholder="ex.: bedwars, geometry dash">
      <label>Categoria do canal</label><select id="trCat"><option value="">nenhuma</option>${Object.entries(CATS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <p><button class="btn" id="trGo" type="button">Ver tendências</button></p></div>
    <div id="msg"></div><div id="out"></div>`;
  let auto = { terms: [], cat: '' };
  if (state.user.youtube?.connected) {
    try {
      const d = await api('/channel/videos');
      auto = detectNiche(d.videos || []);
      $('#trInfo').innerHTML = auto.terms.length ? `✅ Pelos seus vídeos, o nicho do canal <b>${esc(d.channel.title || '')}</b> é: <b>${esc(auto.terms.join(', '))}</b>${auto.cat ? ` (categoria ${esc(CATS[auto.cat] || auto.cat)})` : ''}. Pode ajustar abaixo.` : 'Não deu para descobrir o nicho pelos seus vídeos ainda: escreva os termos abaixo.';
    } catch (e) { $('#trInfo').textContent = 'Não consegui ler seus vídeos agora (' + e.message + '). Escreva os termos do seu nicho.'; }
  } else {
    $('#trInfo').innerHTML = 'Escreva os termos do seu nicho. <a href="/api/auth/google?connect=1">Vincular meu canal</a> descobre isso sozinho.';
  }
  $('#trKw').value = (saved?.terms || auto.terms).join(', ');
  $('#trCat').value = saved?.cat ?? auto.cat ?? '';
  $('#trGo').onclick = async () => {
    const keywords = $('#trKw').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 2);
    const categoryId = $('#trCat').value;
    if (!keywords.length && !categoryId) { $('#msg').innerHTML = alertBox('warn', 'Escreva pelo menos um termo do seu nicho (ou escolha a categoria).'); return; }
    try { localStorage.setItem('tc_nicho', JSON.stringify({ terms: keywords, cat: categoryId })); } catch {}
    $('#msg').innerHTML = '<p class="center"><span class="spin"></span></p>'; $('#out').innerHTML = '';
    try {
      const r = await api('/tools/trends', { method: 'POST', body: { keywords, categoryId } });
      await refreshMe();
      $('#msg').innerHTML = creditsNote(r.credits) + resultAviso(r.result);
      $('#out').innerHTML = (r.result.groups || []).map((g) => `<h2>${esc(g.titulo)}</h2>${g.items.length ? videoTable(g.items) : '<p class="muted">Nada encontrado agora.</p>'}`).join('') || '<p class="muted">Nada encontrado.</p>';
    } catch (e) { $('#msg').innerHTML = alertBox('err', esc(e.message)); }
  };
};

/* ------------------------------ Preparar / Transformar / Editor / Capa / Concorrentes ------------------------------ */
const studioCtx = () => ({ esc, alertBox, fmt, state, api, refreshMe, go: (h) => (location.hash = h) });
const loadStudio = () => import('./studio.js');

function copyBtn(text, label = 'copiar') {
  return `<button class="btn sm ghost" type="button" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(String(text || '')))});this.textContent='copiado ✓'">${label}</button>`;
}

// Ideias de próximos vídeos: com o canal vinculado, usa os títulos mais vistos (leitura sem custo)
const ideasCtx = { titles: [], channel: '' };
views['ferramentas/ideias'] = toolPage({
  title: '💡 Ideias de vídeos para o seu canal', toolKey: 'ideas_ai',
  desc: 'Dez ideias de próximos vídeos (Shorts e longos), com o porquê e a palavra-chave de cada uma. Com o canal vinculado, partem dos seus vídeos que mais deram views.',
  formHtml: `<div id="idCanal" class="muted small">Verificando o seu canal…</div>
    <label>Tema ou nicho do canal (opcional com o canal vinculado)</label><input name="niche" maxlength="200" placeholder="ex.: minecraft, receitas fitness, finanças pessoais">`,
  onMount: async () => {
    ideasCtx.titles = []; ideasCtx.channel = '';
    const box = $('#idCanal');
    if (!state.user?.youtube?.connected) { if (box) box.innerHTML = 'Canal não vinculado: escreva o tema do canal abaixo. <a href="/api/auth/google?connect=1">Vincular meu canal</a> deixa as ideias baseadas nos seus vídeos.'; return; }
    try {
      const d = await api('/channel/videos');
      const vids = [...d.videos].sort((a, b) => b.views - a.views);
      ideasCtx.titles = vids.slice(0, 15).map((v) => v.title);
      ideasCtx.channel = d.channel.title || '';
      if (box) box.innerHTML = `✅ Vou usar os ${ideasCtx.titles.length} vídeos mais vistos de <b>${esc(ideasCtx.channel)}</b>.`;
    } catch (e) { if (box) box.innerHTML = 'Não consegui ler seus vídeos agora (' + esc(e.message) + '). Escreva o tema do canal.'; }
  },
  getBody: (fd) => ({ niche: fd.get('niche'), titles: ideasCtx.titles, channel: ideasCtx.channel }),
  render: (r) => `<div class="card scroll"><h3>Ideias <span class="pill">${r.metodo === 'ia' ? 'IA' : 'gerador local'}</span></h3>
    <table><tr><th>Ideia</th><th>Formato</th><th>Por quê</th><th></th></tr>
    ${(r.ideias || []).map((x, i) => `<tr><td><b>${esc(x.titulo)}</b><br><span class="muted small">🔑 ${esc(x.palavra_chave || '')}</span></td><td><span class="pill">${esc(x.formato || '')}</span></td><td class="small">${esc(x.porque || '')}</td>
      <td class="small"><a href="#/ferramentas/preparar" data-prep="${i}">📝 preparar</a><br><a href="#/ferramentas/palavras" data-kw="${i}">🔑 pesquisar</a></td></tr>`).join('')}</table></div>`,
  after: (r, out) => {
    for (const a of out.querySelectorAll('[data-prep]')) a.onclick = () => { state.toolPrefill = { topic: r.ideias[+a.dataset.prep].titulo }; };
    for (const a of out.querySelectorAll('[data-kw]')) a.onclick = () => { state.toolPrefill = { q: r.ideias[+a.dataset.kw].palavra_chave || r.ideias[+a.dataset.kw].titulo }; };
  }
});

views['ferramentas/preparar'] = toolPage({
  title: '📝 Preparar publicação', toolKey: 'prep_ai',
  desc: 'Antes de gravar ou postar: títulos, descrição, tags, hashtags, roteiro com gancho, textos para a capa e ideias dos próximos vídeos. Depois é um clique para levar tudo ao "Postar vídeo".',
  formHtml: `<label>Tema do vídeo</label><input name="topic" required maxlength="200" placeholder="ex.: como ganhar no bedwars sem gastar">
    <label>Anotações (opcional): o que acontece no vídeo, pontos principais</label><textarea name="notes" maxlength="2000"></textarea>
    <label>Público (opcional)</label><input name="audience" maxlength="200" placeholder="ex.: jogadores iniciantes de 12 a 18 anos">`,
  getBody: (fd) => ({ topic: fd.get('topic'), notes: fd.get('notes'), audience: fd.get('audience') }),
  render: (r) => {
    const list = (arr) => (arr || []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    return `<div class="grid cols2">
      <div class="card"><h3>Títulos <span class="pill">${r.metodo === 'ia' ? 'IA' : 'gerador local'}</span></h3>
        ${list(r.titulos).map((t, i) => `<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="radio" name="ptitle" value="${i}" ${i === 0 ? 'checked' : ''} style="width:auto"> ${esc(t)}</label>`).join('')}</div>
      <div class="card"><h3>Textos para a capa</h3>${list(r.capa_textos).map((t) => `<p><span class="pill">${esc(t)}</span> <a href="#/ferramentas/criar-capa" data-capa="${esc(t)}">criar capa com este texto →</a></p>`).join('')}</div>
      <div class="card"><h3>Descrição</h3><textarea id="pdesc" style="min-height:220px">${esc(r.descricao || '')}</textarea></div>
      <div class="card"><h3>Tags e hashtags</h3><p>${list(r.tags).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</p><p>${copyBtn(list(r.tags).join(', '), 'copiar tags')}</p>
        <p>${list(r.hashtags).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</p></div>
      <div class="card"><h3>Roteiro</h3><ol>${(r.roteiro || []).map((p) => `<li><b>${esc(p.parte || '')}</b>: ${esc(p.texto || p.fala || '')}</li>`).join('')}</ol></div>
      <div class="card"><h3>Ideias dos próximos vídeos</h3><ol>${list(r.ideias).map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>
    </div>
    <p><button class="btn" id="pUse" type="button">⬆️ Usar no "Postar vídeo"</button></p>`;
  },
  after: (r, out) => {
    for (const a of out.querySelectorAll('[data-capa]')) a.onclick = () => { state.thumbText = a.dataset.capa; };
    const use = out.querySelector('#pUse');
    if (use) use.onclick = () => {
      const i = +(out.querySelector('input[name=ptitle]:checked')?.value || 0);
      state.prepDraft = { title: (r.titulos || [])[i] || '', description: out.querySelector('#pdesc').value, tags: r.tags || [] };
      location.hash = '#/canal/postar';
    };
  }
});

views['ferramentas/transformar'] = toolPage({
  title: '🔁 Transformar vídeo (IA)', toolKey: 'transform_ai',
  desc: 'A IA assiste o vídeo e acha os 3 melhores trechos para Shorts (com os tempos); no editor você faz os 3 cortes de uma vez. Também transforma em post da Comunidade, artigo de blog ou sequência para redes.',
  onMount: (f) => {
    f.insertAdjacentHTML('afterbegin', '<div id="tfPick"></div>');
    videoPicker($('#tfPick'), { allowLink: false, onPick: (v) => { f.querySelector('[name=video]').value = 'https://www.youtube.com/watch?v=' + v.id; } });
  },
  formHtml: `<label>Link ou ID do vídeo (público)</label><input name="video" required placeholder="https://www.youtube.com/watch?v=...">
    <label>Transformar em</label><select name="mode"><option value="shorts">✂️ 3 cortes para Shorts (trechos com tempo)</option><option value="post">📣 Post da Comunidade + enquete</option><option value="artigo">📰 Artigo de blog</option><option value="thread">🧵 Sequência para redes sociais</option></select>`,
  getBody: (fd) => ({ video: fd.get('video'), mode: fd.get('mode') }),
  render: (r) => {
    const x = r.resultado || {};
    if (r.mode === 'shorts') {
      return `<div class="card"><h3>Os ${(x.cortes || []).length} melhores trechos para Shorts</h3>
        ${(x.cortes || []).length ? '<p><button class="btn" type="button" id="cutAll">✂️ Fazer os cortes no editor (todos de uma vez)</button></p>' : ''}${(x.cortes || []).map((c, i) => `
        <div style="border-bottom:1px solid var(--line);padding:8px 0"><b>${esc(c.titulo || 'Corte ' + (i + 1))}</b> <span class="pill">${esc(c.inicio)} → ${esc(c.fim)}</span>
          <p class="small">Gancho: ${esc(c.gancho || '')}<br><span class="muted">${esc(c.motivo || '')}</span></p>
          <button class="btn sm ghost" type="button" data-cut="${i}">✂️ Só este corte</button></div>`).join('') || '<p class="muted">Nenhum trecho sugerido.</p>'}
        <p class="muted small">O editor corta o arquivo ORIGINAL do seu computador (por direitos autorais, não baixamos vídeos do YouTube).</p></div>`;
    }
    if (r.mode === 'post') return `<div class="card"><h3>Post da Comunidade</h3><textarea style="min-height:160px">${esc(x.post || '')}</textarea><p>${copyBtn(x.post, 'copiar post')}</p>
      ${x.enquete ? `<h3>Enquete</h3><p><b>${esc(x.enquete.pergunta || '')}</b></p><ol>${(x.enquete.opcoes || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}</div>`;
    if (r.mode === 'artigo') return `<div class="card"><h3>${esc(x.titulo || 'Artigo')}</h3><textarea style="min-height:360px">${esc(x.texto || '')}</textarea><p>${copyBtn((x.titulo ? x.titulo + '\n\n' : '') + (x.texto || ''), 'copiar artigo')}</p></div>`;
    return `<div class="card"><h3>Sequência</h3><ol>${(x.posts || []).map((t) => `<li style="margin:6px 0">${esc(t)} ${copyBtn(t)}</li>`).join('')}</ol></div>`;
  },
  after: (r, out) => {
    const toSec = (t) => String(t || '0').split(':').reduce((a, n) => a * 60 + (parseFloat(n) || 0), 0);
    const cuts = (r.resultado?.cortes || []).map((c) => ({ start: toSec(c.inicio), end: toSec(c.fim), title: c.titulo || '' }));
    for (const b of out.querySelectorAll('[data-cut]')) b.onclick = () => {
      state.editorPreset = { ...cuts[+b.dataset.cut], shorts: true };
      location.hash = '#/ferramentas/editor';
    };
    const all = out.querySelector('#cutAll');
    if (all) all.onclick = () => { state.editorPreset = { cuts, shorts: true }; location.hash = '#/ferramentas/editor'; };
  }
});

views['ferramentas/editor'] = async () => {
  if (!state.user) return needLogin();
  const m = await loadStudio();
  await m.mountEditor(appEl(), studioCtx());
};
views['ferramentas/criar-capa'] = async () => {
  if (!state.user) return needLogin();
  const m = await loadStudio();
  await m.mountThumbMaker(appEl(), studioCtx());
};

views['ferramentas/concorrentes'] = async () => {
  if (!state.user) return needLogin();
  const cost = state.costs.find((c) => c.tool === 'competitor_check')?.cost;
  appEl().innerHTML = `<h1>🏆 Concorrentes</h1>
    <p class="muted">Acompanhe até 20 canais: últimos vídeos, views por hora e quais vídeos estão "estourando" (outliers 🔥) em relação ao próprio canal. ${cost != null ? `<span class="pill">${state.user.unlimited ? 'Incluído (ilimitado)' : cost + ' créditos por atualização'}</span>` : ''}</p>
    <div class="card"><div class="row"><div><label>@handle ou link do canal</label><input id="cq" placeholder="ex.: @canaldojogo"></div>
      <div class="fit"><button class="btn" id="cadd" type="button">Adicionar / atualizar</button></div></div><div id="cmsg"></div></div>
    <div id="clist"><span class="spin"></span></div>`;
  const load = async () => {
    const r = await api('/competitors');
    $('#clist').innerHTML = r.items.length ? r.items.map((c) => `
      <div class="card"><div class="thumbrow">${c.thumb ? `<img src="${esc(c.thumb)}" style="border-radius:50%;width:64px">` : ''}
        <div style="flex:1"><h3>${esc(c.title || c.channel_id)}</h3>
          <p class="muted small">${c.subs != null ? fmt(c.subs) + ' inscritos · ' : ''}média recente: ${fmt(c.last_data?.media)} views · atualizado ${dt(c.last_checked)}</p>
          <p><button class="btn sm secondary" data-up="${esc(c.channel_id)}">Atualizar</button> <button class="btn sm ghost" data-del="${esc(c.id)}">Remover</button></p></div></div>
        ${c.last_data?.recent?.length ? videoTable(c.last_data.recent) : ''}</div>`).join('') : '<p class="muted">Nenhum concorrente ainda. Adicione o primeiro acima.</p>';
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => { await api('/competitors/' + b.dataset.del, { method: 'DELETE' }); load(); };
    for (const b of document.querySelectorAll('[data-up]')) b.onclick = () => add(b.dataset.up);
  };
  const add = async (q) => {
    $('#cmsg').innerHTML = '<span class="spin"></span>';
    try {
      const r = await api('/competitors', { method: 'POST', body: { channel: q } });
      await refreshMe();
      $('#cmsg').innerHTML = creditsNote(r.credits);
      $('#cq').value = '';
      load();
    } catch (e) { $('#cmsg').innerHTML = alertBox('err', esc(e.message)); }
  };
  $('#cadd').onclick = () => { const q = $('#cq').value.trim(); if (q) add(q); };
  load();
};

/* ------------------------------ Meu canal (OAuth YouTube) ------------------------------ */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 2 * 1024 * 1024) return reject(new Error('A imagem precisa ter no máximo 2 MB.'));
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    fr.readAsDataURL(file);
  });
}

const privLabel = (p, fem = false) => ({ public: fem ? 'pública' : 'público', unlisted: fem ? 'não listada' : 'não listado', private: fem ? 'privada' : 'privado' }[p] || p || '');
const CANAL_TABS = [['videos', '🎬 Meus vídeos'], ['playlists', '📚 Playlists'], ['postar', '⬆️ Postar vídeo'], ['editar', '✂️ Editar vídeo'], ['capa', '🎨 Criar capa'], ['live', '🔴 Live'], ['analytics', '📊 Analytics'], ['comentarios', '💬 Comentários'], ['ab', '🧪 Testes A/B']];

views.canal = async (params, sub) => {
  if (!state.user) return needLogin();
  const u = state.user;
  if (!u.youtube?.connected) {
    appEl().innerHTML = `
      <h1>📺 Meu canal</h1>
      <div class="card" style="max-width:680px">
        <h3>Vincule seu canal do YouTube</h3>
        <p>Com o canal vinculado você tem, aqui dentro: seus vídeos e estatísticas, <b>postar vídeo</b> (com agendamento), <b>criar live</b> (com chave de transmissão), <b>analytics</b>, <b>comentários</b> (ler e responder), <b>capas</b>, <b>teste A/B de capas</b>, edição de título, descrição e tags e a <b>IA do vídeo</b>. Só vídeos do canal vinculado podem ser alterados, e tudo é verificado no servidor.</p>
        ${googleButton('Vincular meu canal do YouTube', true)}
        <p class="muted small">Você autoriza pelo próprio Google. Pode desvincular quando quiser (em Conta).</p>
      </div>`;
    return;
  }
  const tab = sub || 'videos';
  appEl().innerHTML = `<h1>📺 Meu canal <span class="muted small">${esc(u.youtube.channel_title || '')}</span></h1>
    <div class="tabs">${CANAL_TABS.map(([k, l]) => `<a href="#/canal/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div>
    <div id="cmsg"></div><div id="cbody"><span class="spin"></span></div>`;
  const el = $('#cbody');
  try { await canalTabs[tab]?.(el); } catch (e) {
    el.innerHTML = alertBox(e.status === 409 ? 'warn' : 'err', esc(e.message)) + (e.status === 409 ? googleButton('Vincular meu canal do YouTube', true) : '');
  }
};

const canalTabs = {
  async editar(el) { const m = await loadStudio(); await m.mountEditor(el, studioCtx()); },
  async capa(el) { const m = await loadStudio(); await m.mountThumbMaker(el, studioCtx()); },
  async videos(el) {
    const data = await api('/channel/videos');
    const c = data.channel;
    el.innerHTML = `
      <div class="card"><div class="thumbrow">${c.thumb ? `<img src="${esc(c.thumb)}" style="border-radius:50%;width:80px">` : ''}
        <div><h3>${esc(c.title)}</h3><p>👥 ${c.subs == null ? 'inscritos ocultos' : fmt(c.subs) + ' inscritos'} · 👁 ${fmt(c.views)} views · 🎬 ${fmt(c.videos)} vídeos</p>
        <p><a class="btn sm ghost" href="https://studio.youtube.com" target="_blank" rel="noopener">Abrir YouTube Studio</a> <button class="btn sm ghost" id="ytoff">Desvincular canal</button></p></div></div></div>
      <div class="grid cols2">${data.videos.map((v) => `
        <div class="card" id="v-${esc(v.id)}" data-privacy="${esc(v.privacy || '')}">
          <div class="thumbrow">${v.thumb ? `<img src="${esc(v.thumb)}">` : ''}<div><b>${esc(v.title)}</b>
            <p class="muted small">👁 ${fmt(v.views)} · 👍 ${fmt(v.likes)} · 💬 ${fmt(v.comments)} · ⚡ ${fmt(v.vph)}/h · ${dt(v.publishedAt).split(',')[0]} · ${esc(privLabel(v.privacy))}</p>
            <p class="small"><span class="pill ${v.seoScore >= 80 ? 'ok' : v.seoScore >= 50 ? 'warn' : 'err'}" title="${esc((v.seoTodo || []).join(' · ') || 'Tudo certo')}">SEO ${v.seoScore ?? '—'}/100</span>
              ${(v.seoTodo || []).length ? `<span class="muted">falta: ${esc((v.seoTodo || []).slice(0, 2).join(', '))}${v.seoTodo.length > 2 ? '…' : ''}</span>` : '<span class="muted">checklist completo ✅</span>'}</p>
            <p class="small"><a href="https://studio.youtube.com/video/${esc(v.id)}/edit" target="_blank" rel="noopener">editar no Studio ↗</a> · <a href="#/ferramentas/insights?video=${esc(v.id)}">✨ IA do vídeo</a> · <a href="#/ferramentas/transformar" data-transform="${esc(v.id)}">✂️ 3 cortes para Shorts</a></p></div></div>
          <details><summary class="small">✏️ Editar título, descrição, tags e visibilidade</summary>
            <p><a class="btn sm ghost" href="#/ferramentas/insights?video=${esc(v.id)}">✨ IA assiste e sugere tudo</a> <span class="muted small">${costOf('video_insights_ai')} · você tira o que não quiser e salva</span></p>
            <label>Título <span class="muted small" data-len="${esc(v.id)}">${(v.title || '').length}/100</span></label><input data-f="title" value="${esc(v.title)}" maxlength="100">
            <label>Descrição</label><textarea data-f="description">${esc(v.description)}</textarea>
            <label>Tags (separadas por vírgula)</label><input data-f="tags" value="${esc((v.tags || []).join(', '))}">
            <label>Visibilidade</label><select data-f="privacy">${[['public', 'Público'], ['unlisted', 'Não listado'], ['private', 'Privado']].map(([k, l]) => `<option value="${k}" ${v.privacy === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <p><button class="btn sm" data-save="${esc(v.id)}">Salvar no YouTube</button> <span class="muted small">${costOf('video_update')}</span></p></details>
          <details><summary class="small">🖼️ Enviar capa</summary>
            <label>Imagem (JPG/PNG, até 2 MB, 1280x720)</label><input type="file" accept="image/*" data-file="${esc(v.id)}">
            ${state.lastThumb ? `<p class="small"><label style="display:inline"><input type="checkbox" data-uselast="${esc(v.id)}" style="width:auto"> usar a última capa gerada</label></p>` : '<p class="small muted">Dica: monte uma capa em <a href="#/canal/capa">Criar capa</a> (pode usar um quadro do próprio vídeo no Editor).</p>'}
            <p><button class="btn sm" data-thumb="${esc(v.id)}">Enviar para o YouTube</button> <span class="muted small">${costOf('thumbnail_upload')}</span></p></details>
          <details><summary class="small">🧪 Teste A/B de capas</summary>
            <label>Capa A</label><input type="file" accept="image/*" data-a="${esc(v.id)}">
            <label>Capa B</label><input type="file" accept="image/*" data-b="${esc(v.id)}">
            <label>Trocar a cada (horas)</label><input type="number" min="1" max="168" value="24" data-h="${esc(v.id)}">
            <p><button class="btn sm" data-ab="${esc(v.id)}">Iniciar teste</button> <span class="muted small">${costOf('ab_test')}</span></p></details>
          <div class="small" id="m-${esc(v.id)}"></div>
        </div>`).join('')}</div>
      ${data.videos.length ? '' : '<p class="muted">Nenhum vídeo encontrado neste canal.</p>'}`;
    $('#ytoff').onclick = async () => {
      if (!confirm('Desvincular o canal do YouTube desta conta? O acesso é revogado no Google; para voltar a usar as ferramentas, entre com o Google de novo.')) return;
      await api('/auth/youtube/disconnect', { method: 'POST' });
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      state.user = null;
      location.hash = '#/login';
    };
    for (const a of el.querySelectorAll('[data-transform]')) a.onclick = () => { state.toolPrefill = { video: 'https://www.youtube.com/watch?v=' + a.dataset.transform, mode: 'shorts' }; };
    const msg = (id, kind, html) => ($('#m-' + id).innerHTML = alertBox(kind, html));
    for (const b of el.querySelectorAll('[data-save]')) b.onclick = async () => {
      const id = b.dataset.save, card = $('#v-' + id);
      try {
        const priv = card.querySelector('[data-f=privacy]').value;
        if (priv === 'public' && card.dataset.privacy !== 'public' && !confirm('Deixar este vídeo PÚBLICO agora? Se ele estava agendado, o agendamento é cancelado e ele aparece para todos.')) return;
        const tags = card.querySelector('[data-f=tags]').value.split(',').map((t) => t.trim()).filter(Boolean);
        const r = await api('/channel/videos/' + id, { method: 'PUT', body: { title: card.querySelector('[data-f=title]').value, description: card.querySelector('[data-f=description]').value, tags, privacy: priv } });
        card.dataset.privacy = r.result?.privacy || priv;
        await refreshMe(); msg(id, 'ok', 'Salvo no YouTube. ' + creditsNote(r.credits));
      } catch (e) { msg(id, 'err', esc(e.message)); }
    };
    for (const inp of el.querySelectorAll('[data-f=title]')) inp.oninput = () => { const c = inp.closest('.card'); const l = c.querySelector('[data-len]'); if (l) l.textContent = inp.value.length + '/100'; };
    for (const b of el.querySelectorAll('[data-thumb]')) b.onclick = async () => {
      const id = b.dataset.thumb, card = $('#v-' + id);
      try {
        const useLast = card.querySelector('[data-uselast]')?.checked;
        const image = useLast ? state.lastThumb : await fileToDataUrl(card.querySelector('[data-file]').files[0]);
        if (!image) throw new Error('Escolha uma imagem.');
        const r = await api('/channel/videos/' + id + '/thumbnail', { method: 'POST', body: { image } });
        await refreshMe(); msg(id, 'ok', 'Capa enviada ao YouTube (pode levar alguns minutos para aparecer). ' + creditsNote(r.credits));
      } catch (e) { msg(id, 'err', esc(e.message)); }
    };
    for (const b of el.querySelectorAll('[data-ab]')) b.onclick = async () => {
      const id = b.dataset.ab, card = $('#v-' + id);
      try {
        const thumb_a = await fileToDataUrl(card.querySelector('[data-a]').files[0]);
        const thumb_b = await fileToDataUrl(card.querySelector('[data-b]').files[0]);
        if (!thumb_a || !thumb_b) throw new Error('Escolha as duas capas (A e B).');
        const r = await api('/channel/ab', { method: 'POST', body: { video_id: id, thumb_a, thumb_b, hours: parseInt(card.querySelector('[data-h]').value, 10) || 24 } });
        await refreshMe(); msg(id, 'ok', 'Teste iniciado com a capa A. ' + esc(r.result.aviso) + ' ' + creditsNote(r.credits));
      } catch (e) { msg(id, 'err', esc(e.message)); }
    };
  },

  async playlists(el) {
    const [pl, vids] = await Promise.all([api('/channel/playlists'), api('/channel/videos').catch(() => ({ videos: [] }))]);
    const opts = vids.videos.map((v) => `<option value="${esc(v.id)}">${esc(v.title)}</option>`).join('');
    el.innerHTML = `
      <div class="card" style="max-width:720px"><h3>Nova playlist</h3>
        <div class="row"><div><label>Nome</label><input id="plT" maxlength="150" placeholder="ex.: Melhores momentos"></div>
          <div class="fit"><label>Visibilidade</label><select id="plP"><option value="public">Pública</option><option value="unlisted">Não listada</option><option value="private">Privada</option></select></div></div>
        <label>Descrição (opcional)</label><textarea id="plD" maxlength="5000" style="min-height:70px"></textarea>
        <p><button class="btn sm" id="plNew" type="button">Criar playlist</button> <span class="muted small">${costOf('playlist_create')}</span></p><div id="plMsg"></div></div>
      <div class="grid cols2">${pl.items.map((p) => `<div class="card">
        <div class="thumbrow">${p.thumb ? `<img src="${esc(p.thumb)}">` : ''}<div><b>${esc(p.title)}</b>
          <p class="muted small">${fmt(p.count)} ${p.count === 1 ? 'vídeo' : 'vídeos'} · ${esc(privLabel(p.privacy, true))} · <a href="https://www.youtube.com/playlist?list=${esc(p.id)}" target="_blank" rel="noopener">abrir ↗</a></p></div></div>
        ${opts ? `<div class="row"><div><select data-addv="${esc(p.id)}">${opts}</select></div><div class="fit"><button class="btn sm secondary" type="button" data-add="${esc(p.id)}">Adicionar ${costOf('playlist_add')}</button></div></div>` : '<p class="muted small">Você ainda não tem vídeos para adicionar.</p>'}
        <details data-items="${esc(p.id)}"><summary class="small">ver vídeos desta playlist</summary><div class="small">carregando…</div></details>
        <div class="small" data-plm="${esc(p.id)}"></div></div>`).join('')}</div>
      ${pl.items.length ? '' : '<p class="muted">Nenhuma playlist ainda. Crie a primeira acima.</p>'}`;
    $('#plNew').onclick = async () => {
      try {
        const title = $('#plT').value.trim();
        if (!title) throw new Error('Dê um nome para a playlist.');
        const r = await api('/channel/playlists', { method: 'POST', body: { title, description: $('#plD').value, privacy: $('#plP').value } });
        await refreshMe();
        await canalTabs.playlists(el);
        $('#plMsg').innerHTML = alertBox('ok', `Playlist "${esc(r.result.title)}" criada. ` + creditsNote(r.credits));
      } catch (e) { $('#plMsg').innerHTML = alertBox('err', esc(e.message)); }
    };
    const loadItems = async (d) => {
      const id = d.dataset.items, box = d.querySelector('div');
      try {
        const r = await api('/channel/playlists/' + id + '/items');
        box.innerHTML = r.items.length ? r.items.map((i) => `<div>${i.position + 1}. ${esc(i.title)} <a href="#" data-rm="${esc(i.itemId)}" class="muted">remover</a></div>`).join('') : '<span class="muted">Playlist vazia.</span>';
        for (const a of box.querySelectorAll('[data-rm]')) a.onclick = async (e) => {
          e.preventDefault();
          if (!confirm('Tirar este vídeo da playlist? (o vídeo continua no canal)')) return;
          try { await api('/channel/playlists/' + id + '/items/' + a.dataset.rm, { method: 'DELETE' }); await refreshMe(); loadItems(d); }
          catch (err) { box.insertAdjacentHTML('beforeend', alertBox('err', esc(err.message))); }
        };
      } catch (e) { box.innerHTML = alertBox('err', esc(e.message)); }
    };
    for (const d of el.querySelectorAll('[data-items]')) d.ontoggle = () => { if (d.open) loadItems(d); };
    for (const b of el.querySelectorAll('[data-add]')) b.onclick = async () => {
      const id = b.dataset.add, m = el.querySelector(`[data-plm="${id}"]`);
      try {
        const r = await api('/channel/playlists/' + id + '/items', { method: 'POST', body: { video_id: el.querySelector(`[data-addv="${id}"]`).value } });
        await refreshMe(); m.innerHTML = alertBox('ok', 'Vídeo adicionado. ' + creditsNote(r.credits));
        const d = el.querySelector(`[data-items="${id}"]`); if (d.open) loadItems(d);
      } catch (e) { m.innerHTML = alertBox('err', esc(e.message)); }
    };
  },

  async postar(el) {
    el.innerHTML = `<div class="card" style="max-width:720px"><h3>Postar vídeo no YouTube</h3>
      <p class="muted small">O arquivo vai direto do seu computador para o YouTube (não passa pelo nosso servidor). Para publicar em data marcada, escolha "Agendar". ${costOf('video_upload')}</p>
      <div id="pmsg"></div>
      ${state.pendingUpload ? alertBox('info', `Vídeo vindo do editor: <b>${esc(state.pendingUpload.name)}</b> (${(state.pendingUpload.size / 1048576).toFixed(1)} MB). <a href="#" id="pClear">usar outro arquivo</a>`) : ''}
      <p class="small"><a href="#/ferramentas/preparar">📝 Preparar título, descrição e tags com IA</a> · <a href="#/canal/editar">✂️ Editar o vídeo antes</a></p>
      <form id="pf">
        <div id="pFileWrap" style="${state.pendingUpload ? 'display:none' : ''}"><label>Arquivo de vídeo</label><input type="file" name="file" accept="video/*" ${state.pendingUpload ? '' : 'required'}></div>
        <label>Título</label><input name="title" maxlength="100" required value="${esc(state.prepDraft?.title || '')}">
        <label>Descrição</label><textarea name="description" maxlength="5000">${esc(state.prepDraft?.description || '')}</textarea>
        <label>Tags (separadas por vírgula)</label><input name="tags" value="${esc((state.prepDraft?.tags || []).join(', '))}">
        <div class="row">
          <div><label>Visibilidade</label><select name="privacy"><option value="private">Privado</option><option value="unlisted">Não listado</option><option value="public">Público</option></select></div>
          <div><label>Categoria</label><select name="categoryId"><option value="20">Jogos</option><option value="22">Pessoas e blogs</option><option value="24">Entretenimento</option><option value="27">Educação</option><option value="28">Ciência e tecnologia</option><option value="10">Música</option><option value="26">Como fazer e estilo</option></select></div>
          <div><label>Agendar publicação (opcional)</label><input type="datetime-local" name="publishAt"></div>
        </div>
        <p><button class="btn" id="pbtn">Enviar para o YouTube</button></p>
        <div id="pprog" class="muted small"></div>
      </form></div>`;
    const pc = $('#pClear');
    if (pc) pc.onclick = (e) => { e.preventDefault(); state.pendingUpload = null; canalTabs.postar(el); };
    $('#pf').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const picked = fd.get('file');
      const file = picked && picked.size ? picked : state.pendingUpload;
      const btn = $('#pbtn'); btn.disabled = true; $('#pmsg').innerHTML = '';
      try {
        if (!file || !file.size) throw new Error('Escolha um arquivo de vídeo.');
        const publishAt = fd.get('publishAt') ? new Date(fd.get('publishAt')).toISOString() : null;
        const r = await api('/channel/upload/start', { method: 'POST', body: { title: fd.get('title'), description: fd.get('description'), tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean), privacy: fd.get('privacy'), categoryId: fd.get('categoryId'), publishAt, size: file.size, mime: file.type || 'video/*' } });
        const videoId = await uploadToYouTube(r.result.uploadUrl, file, (pct) => ($('#pprog').textContent = `Enviando… ${pct}%`));
        const done = await api('/channel/upload/done', { method: 'POST', body: { videoId } });
        await refreshMe();
        state.pendingUpload = null;
        state.prepDraft = null;
        $('#pmsg').innerHTML = alertBox('ok', `✅ Vídeo enviado${r.result.scheduled ? ' e agendado' : ''}! <a href="${esc(done.url)}" target="_blank" rel="noopener">Ver no YouTube</a> · <a href="${esc(done.studio)}" target="_blank" rel="noopener">Abrir no Studio</a>. O processamento do YouTube pode levar alguns minutos. ` + creditsNote(r.credits));
        $('#pprog').textContent = '';
      } catch (e) { $('#pmsg').innerHTML = alertBox('err', esc(e.message)); }
      btn.disabled = false;
    };
  },

  async live(el) {
    el.innerHTML = `<div class="card" style="max-width:720px"><h3>Criar transmissão ao vivo</h3>
      <p class="muted small">Cria a live no seu canal e devolve a URL RTMP e a chave de transmissão para colar no OBS/Streamlabs. Seu canal precisa ter transmissões ao vivo habilitadas no YouTube. ${costOf('live_create')}</p>
      <div id="lmsg"></div>
      <form id="lf">
        <label>Título</label><input name="title" maxlength="100" required>
        <label>Descrição</label><textarea name="description"></textarea>
        <div class="row">
          <div><label>Visibilidade</label><select name="privacy"><option value="public">Pública</option><option value="unlisted">Não listada</option><option value="private">Privada</option></select></div>
          <div><label>Início (opcional; vazio = em 5 min)</label><input type="datetime-local" name="scheduledStart"></div>
        </div>
        <p><button class="btn">Criar live</button></p></form><div id="lout"></div></div>`;
    $('#lf').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        const r = await api('/channel/live', { method: 'POST', body: { title: fd.get('title'), description: fd.get('description'), privacy: fd.get('privacy'), scheduledStart: fd.get('scheduledStart') ? new Date(fd.get('scheduledStart')).toISOString() : null } });
        await refreshMe();
        const x = r.result;
        $('#lout').innerHTML = `<div class="alert ok">Live criada! <a href="${esc(x.watchUrl)}" target="_blank" rel="noopener">Página da live</a> · <a href="${esc(x.studioUrl)}" target="_blank" rel="noopener">Abrir no Studio</a></div>
          <p><b>URL do servidor (RTMP):</b> <span class="copybox">${esc(x.rtmpUrl)}</span></p>
          <p><b>Chave de transmissão:</b> <span class="copybox" id="skey">••••••••</span> <button class="btn sm secondary" id="showkey">mostrar</button> <button class="btn sm secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(x.streamKey || '')})">copiar</button></p>
          <p class="muted small">${esc(x.aviso)} ${creditsNote(r.credits)}</p>`;
        $('#showkey').onclick = () => ($('#skey').textContent = x.streamKey || '(indisponível)');
      } catch (e) { $('#lmsg').innerHTML = alertBox('err', esc(e.message)); }
    };
  },

  async analytics(el) {
    const a = await api('/channel/analytics?days=28');
    const max = Math.max(1, ...a.daily.map((d) => d.views));
    el.innerHTML = `
      <section class="grid cols3">
        <div class="card"><h3>Views (28 dias)</h3><div class="kpi">${fmt(a.totals.views)}</div></div>
        <div class="card"><h3>Horas assistidas</h3><div class="kpi">${fmt(Math.round(a.totals.minutes / 60))}</div></div>
        <div class="card"><h3>Inscritos (líquido)</h3><div class="kpi">${a.totals.subs >= 0 ? '+' : ''}${fmt(a.totals.subs)}</div></div>
      </section>
      <div class="card"><h3>Views por dia</h3>
        <div style="display:flex;align-items:flex-end;gap:3px;height:140px">${a.daily.map((d) => `<div title="${esc(d.day)}: ${fmt(d.views)} views" style="flex:1;background:var(--accent);height:${Math.max(2, Math.round((d.views / max) * 130))}px;border-radius:3px 3px 0 0"></div>`).join('')}</div>
        <p class="muted small">${esc(a.daily[0]?.day || '')} → ${esc(a.daily[a.daily.length - 1]?.day || '')} · dados oficiais da YouTube Analytics API</p></div>
      <div class="card scroll"><h3>Vídeos com mais views no período</h3>
        ${a.topVideos.length ? `<table><tr><th>Vídeo</th><th>Views</th><th>Min. assistidos</th><th>Duração média</th></tr>${a.topVideos.map((v) => `<tr><td><a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a></td><td>${fmt(v.views)}</td><td>${fmt(Math.round(v.minutes))}</td><td>${Math.round(v.avgSec)}s</td></tr>`).join('')}</table>` : '<p class="muted">Sem dados no período.</p>'}</div>`;
  },

  async comentarios(el) {
    const c = await api('/channel/comments');
    el.innerHTML = `<div class="card scroll"><h3>Comentários recentes do canal</h3>
      ${c.items.length ? c.items.map((m) => `<div style="border-bottom:1px solid var(--line);padding:8px 0" id="c-${esc(m.id)}">
        <b>${esc(m.author)}</b> <span class="muted small">${dt(m.publishedAt)} · 👍 ${fmt(m.likes)} · ${m.replies} respostas · <a href="https://www.youtube.com/watch?v=${esc(m.videoId)}" target="_blank" rel="noopener">vídeo</a></span>
        <p>${esc(m.text)}</p>
        <div class="row"><div><input placeholder="Responder…" data-reply="${esc(m.id)}"></div>
          <div class="fit"><button class="btn sm ghost" data-suggest="${esc(m.id)}" data-text="${esc(m.text)}">✨ Sugerir ${costOf('reply_ai')}</button></div>
          <div class="fit"><button class="btn sm secondary" data-send="${esc(m.id)}">Responder ${costOf('comment_reply')}</button></div></div>
        <div class="small" id="cm-${esc(m.id)}"></div></div>`).join('') : '<p class="muted">Nenhum comentário recente.</p>'}</div>`;
    for (const b of el.querySelectorAll('[data-suggest]')) b.onclick = async () => {
      const id = b.dataset.suggest, input = el.querySelector(`[data-reply="${id}"]`);
      try {
        const r = await api('/tools/reply_ai', { method: 'POST', body: { comment: b.dataset.text, channel: state.user?.youtube?.channel_title || '' } });
        await refreshMe();
        const opts = r.result.respostas || [];
        input.value = opts[0] || '';
        $('#cm-' + id).innerHTML = opts.slice(1).map((o) => `<a href="#" class="small" data-pick="${esc(o)}">↳ ${esc(o)}</a>`).join('<br>');
        for (const a of $('#cm-' + id).querySelectorAll('[data-pick]')) a.onclick = (e) => { e.preventDefault(); input.value = a.dataset.pick; };
      } catch (e) { $('#cm-' + id).innerHTML = alertBox('err', esc(e.message)); }
    };
    for (const b of el.querySelectorAll('[data-send]')) b.onclick = async () => {
      const id = b.dataset.send, input = el.querySelector(`[data-reply="${id}"]`);
      try {
        if (!input.value.trim()) throw new Error('Escreva a resposta.');
        const r = await api('/channel/comments/' + id + '/reply', { method: 'POST', body: { text: input.value } });
        await refreshMe(); input.value = ''; $('#cm-' + id).innerHTML = alertBox('ok', 'Resposta publicada. ' + creditsNote(r.credits));
      } catch (e) { $('#cm-' + id).innerHTML = alertBox('err', esc(e.message)); }
    };
  },

  async ab(el) {
    const ab = (await api('/channel/ab')).items;
    el.innerHTML = `<div class="card scroll"><h3>Testes A/B de capa</h3><p class="muted small">Para iniciar um teste, abra "Meus vídeos" e use "Teste A/B de capas" no vídeo. As capas alternam sozinhas no período escolhido e as views de cada período ficam registradas.</p>
      ${ab.length ? `<table><tr><th>Vídeo</th><th>Período</th><th>Capa atual</th><th>Status</th><th>Resultados</th><th></th></tr>
        ${ab.map((t) => `<tr><td>${esc(t.title || t.video_id)}</td><td>${t.hours}h</td><td>${esc(t.current)}</td><td><span class="pill ${t.status === 'running' ? 'ok' : ''}">${esc(t.status)}</span></td>
          <td class="small">${(t.log || []).map((l) => `${l.variant}: ${l.views_gain != null ? '+' + fmt(l.views_gain) + ' views' : 'em andamento'}`).join('<br>')}</td>
          <td>${t.status === 'running' ? `<button class="btn sm secondary" data-stop="${t.id}" data-keep="A">Parar e manter A</button> <button class="btn sm secondary" data-stop="${t.id}" data-keep="B">Parar e manter B</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhum teste ainda.</p>'}</div>`;
    for (const b of el.querySelectorAll('[data-stop]')) b.onclick = async () => {
      try { await api('/channel/ab/' + b.dataset.stop + '/stop', { method: 'POST', body: { keep: b.dataset.keep } }); route(); }
      catch (e) { $('#cmsg').innerHTML = alertBox('err', esc(e.message)); }
    };
  }
};

// Upload "resumable" direto do navegador para o YouTube (PUT na URL de sessão)
function uploadToYouTube(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'video/*');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) { const r = JSON.parse(xhr.responseText); resolve(r.id); }
        else reject(new Error('O YouTube recusou o envio (HTTP ' + xhr.status + '). ' + (xhr.responseText || '').slice(0, 200)));
      } catch { reject(new Error('Resposta inesperada do YouTube ao concluir o envio.')); }
    };
    xhr.onerror = () => reject(new Error('Falha de rede durante o envio. Tente novamente.'));
    xhr.send(file);
  });
}

function costOf(tool) {
  const c = state.costs.find((x) => x.tool === tool);
  if (!c) return '';
  return state.user?.unlimited ? '(ilimitado)' : `(${c.cost} créditos)`;
}

/* ------------------------------ Planos e pagamento ------------------------------ */
views.planos = async () => {
  const plans = (await api('/plans')).items;
  appEl().innerHTML = `
    <h1>Planos e preços</h1>
    <p class="muted">Pagamento mensal via Pix. Os créditos do plano são liberados após a confirmação do pagamento pelo provedor, nunca antes. Metas de capacidade comparativa são referências internas, não números auditados.</p>
    ${state.pub.payments_enabled ? '' : alertBox('warn', 'Os pagamentos ainda não foram ativados pelo administrador (falta configurar o provedor Pix). As assinaturas ficarão disponíveis assim que isso for concluído; nenhuma cobrança é simulada.')}
    <section class="grid cols3">${plans.map(planCard).join('')}</section>
    <h2>Como funcionam os créditos</h2>
    <div class="card scroll"><table><tr><th>Ferramenta</th><th>Custo por uso</th></tr>
      ${state.costs.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.cost} créditos</td></tr>`).join('')}
    </table><p class="muted small">Custos configuráveis pelo administrador. Operações com IA custam mais porque consomem APIs externas.</p></div>`;
};

views.checkout = async (params) => {
  if (!state.user) return needLogin();
  const planId = params.get('plan');
  const plans = (await api('/plans')).items;
  const plan = plans.find((p) => p.id === planId);
  if (!plan) { appEl().innerHTML = alertBox('err', 'Plano não encontrado.'); return; }
  appEl().innerHTML = `
    <h1>Assinar plano ${esc(plan.name)}</h1>
    <div class="card" style="max-width:560px">
      <p><b>${money(plan.price_cents)}</b>/mês · ${fmt(plan.monthly_credits)} créditos liberados após a confirmação do pagamento.</p>
      <div id="msg"></div>
      <p><button id="go" class="btn">Gerar cobrança Pix</button></p>
      <div id="pix"></div>
    </div>`;
  $('#go').onclick = async () => {
    $('#msg').innerHTML = ''; $('#go').disabled = true;
    try {
      const { payment } = await api('/payments/create', { method: 'POST', body: { plan_id: plan.id } });
      renderPix(payment);
      pollPayment(payment.id);
    } catch (e) {
      $('#msg').innerHTML = alertBox(e.status === 409 ? 'warn' : 'err', esc(e.message));
      $('#go').disabled = false;
    }
  };
  function renderPix(p) {
    const pix = p.pix || {};
    $('#pix').innerHTML = `
      <h3>Pague com Pix <span class="pill warn" id="st">${esc(p.status)}</span></h3>
      ${pix.qr_code_base64 ? `<div class="qr"><img alt="QR Code Pix" src="data:image/png;base64,${pix.qr_code_base64}"></div>` : ''}
      ${pix.qr_code ? `<p class="small muted">Ou use o Pix copia e cola:</p><div class="copybox">${esc(pix.qr_code)}</div>
        <p><button class="btn sm secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(pix.qr_code)})">Copiar código Pix</button></p>` : ''}
      <p class="muted small">Assim que o provedor confirmar o pagamento, seu plano é ativado automaticamente e os créditos aparecem na sua conta. Esta página atualiza sozinha.</p>`;
  }
  async function pollPayment(id) {
    try {
      const { payment } = await api('/payments/' + id);
      const st = $('#st'); if (st) st.textContent = payment.status;
      if (payment.status === 'approved') {
        await refreshMe();
        $('#pix').innerHTML = alertBox('ok', '✅ Pagamento confirmado! Seu plano foi ativado e os créditos já estão na sua conta.') + '<p><a class="btn" href="#/dashboard">Ir para o painel</a></p>';
        return;
      }
      if (['cancelled', 'expired', 'refunded'].includes(payment.status)) {
        $('#msg').innerHTML = alertBox('err', 'A cobrança ficou com status: ' + esc(payment.status) + '. Gere uma nova cobrança para tentar de novo.');
        $('#go').disabled = false;
        return;
      }
    } catch {}
    setTimeout(() => pollPayment(id), 5000);
  }
};

/* ------------------------------ Conta ------------------------------ */
views.conta = async () => {
  if (!state.user) return needLogin();
  const u = state.user;
  const pays = (await api('/payments')).items;
  appEl().innerHTML = `
    <h1>Configurações da conta</h1>
    <section class="grid cols2">
      <div class="card"><h3>Seus dados</h3>
        <p>E-mail: <b>${esc(u.email)}</b><br>Plano: <b>${esc(u.plan?.name)}</b> · Papel: <b>${esc(u.role)}</b></p>
        <p class="muted small">Login feito com o Google: não há senha para gerenciar aqui.</p>
        <p>Canal do YouTube: ${u.youtube?.connected ? `<span class="pill ok">conectado (${esc(u.youtube.channel_title || '')})</span>` : '<span class="pill warn">não conectado</span> <a href="#/canal">conectar</a>'}</p></div>
      <div class="card"><h3>Token para a extensão do Chrome</h3>
        <p class="muted small">Use este token para entrar na extensão. Ele dá acesso à sua conta: trate como uma senha e não compartilhe.</p>
        <p><button id="tok" class="btn sm secondary">Gerar e mostrar token</button></p><div id="tokout"></div></div>
      ${u.role === 'user' ? `
      <div class="card"><h3>Sou o administrador principal</h3>
        <p class="muted small">Se este servidor é seu, cadastre-se com o e-mail de administrador configurado e informe o token de setup impresso no console do servidor na primeira execução.</p>
        <div id="omsg"></div>
        <form id="of"><label>Token de setup</label><input name="token" required>
          <p><button class="btn sm">Reivindicar administração</button></p></form></div>` : ''}
    </section>
    <h2>Seus pagamentos</h2>
    <div class="card scroll">${pays.length ? `<table><tr><th>Data</th><th>Plano</th><th>Valor</th><th>Status</th></tr>
      ${pays.map((p) => `<tr><td>${dt(p.created_at)}</td><td>${esc(p.plan_id)}</td><td>${money(p.amount_cents)}</td><td><span class="pill ${p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'err'}">${esc(p.status)}</span></td></tr>`).join('')}</table>` : '<p class="muted">Nenhum pagamento ainda.</p>'}</div>`;
  $('#tok').onclick = async () => {
    const r = await api('/auth/token');
    $('#tokout').innerHTML = `<div class="copybox">${esc(r.token)}</div><p><button class="btn sm secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(r.token)})">Copiar token</button></p>`;
  };
  const of = $('#of');
  if (of) of.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('/auth/claim-owner', { method: 'POST', body: { token: new FormData(ev.target).get('token') } });
      await refreshMe(); location.hash = '#/admin';
    } catch (e) { showErr($('#omsg'), e); }
  };
};

/* ------------------------------ Ajuda ------------------------------ */
views.ajuda = async () => {
  appEl().innerHTML = `
    <h1>Central de ajuda</h1>
    <div class="grid cols2">
      <div class="card"><h3>Como funcionam os créditos?</h3>
        <p class="muted">Cada ferramenta tem um custo em créditos, mostrado antes de usar. No plano Free, seu saldo é completado até 5.000 créditos no início de cada mês. Planos pagos liberam mais créditos a cada pagamento confirmado. Se uma ferramenta falhar, os créditos daquela chamada são estornados automaticamente.</p></div>
      <div class="card"><h3>Como instalo a extensão do Chrome?</h3>
        <p><a class="btn sm" href="/turbocanal-extensao.zip" download id="extDl">⬇️ Baixar extensão (.zip)</a> <span class="muted small" id="extVer"></span></p>
        <ol class="muted">
        <li>Baixe o arquivo acima e descompacte (botão direito &gt; Extrair tudo).</li>
        <li>No Chrome, digite <b>chrome://extensions</b> na barra de endereço e aperte Enter.</li>
        <li>Ative o <b>Modo do desenvolvedor</b> (chavinha no canto superior direito).</li>
        <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta descompactada (a que contém o arquivo manifest.json).</li>
        <li>Clique no ícone laranja do TurboCanal (fica no quebra-cabeça 🧩 da barra do Chrome; use o alfinete para fixar).</li>
        <li>Abra qualquer vídeo do YouTube: o painel do TurboCanal já aparece ao lado do vídeo, preenchido.</li></ol>
        <p class="small muted"><b>Não existe tela de login na extensão.</b> O VPH, os outliers, a nota de SEO, as tags, a ordenação e os atalhos funcionam sem conta e sem gastar créditos. Se você já entrou com o Google aqui no site, a extensão reconhece a sua conta sozinha e mostra o saldo no alto do painel. Só a IA e as consultas ao servidor (aba Canal, análise de canal, termos relacionados) pedem a conta, e aí aparece um botão dentro do próprio painel.</p>
        <p class="small muted"><b>Para atualizar:</b> baixe o .zip de novo, <b>substitua os arquivos da MESMA pasta</b> que você usou ao instalar (se descompactar em outra pasta, o Chrome continua usando a antiga) e, em chrome://extensions, clique no botão de recarregar (↻) do TurboCanal.</p>
        <p class="small muted"><b>Como saber se atualizou:</b> clique no ícone do TurboCanal e veja o número da versão ao lado do nome. Se estiver diferente da versão mais nova, o Chrome ainda está com a pasta antiga. Em chrome://extensions, clique em "Detalhes" e confira o caminho em "Carregado de".</p>
        <p class="small muted"><b>Botões parados?</b> No ícone da extensão há o link <b>testar conexão</b>: ele diz se o site está no ar, se a sua sessão foi encontrada e se a extensão está atualizada.</p>
        <p class="small muted">A extensão ainda não está publicada na Chrome Web Store, por isso a instalação é manual (modo do desenvolvedor). Quando for publicada na loja, bastará um clique.</p></div>
      <div class="card"><h3>O que a extensão faz no YouTube?</h3>
        <ol class="muted">
        <li><b>Miniaturas:</b> mostra o VPH (views por hora) e o outlier (quantas vezes acima da média) em cima de cada vídeo, no início, na busca, nos relacionados e na aba Vídeos dos canais. É grátis: usa os números da própria página.</li>
        <li><b>Página do vídeo:</b> painel com 4 abas. <b>Vídeo</b> (views, VPH, likes, comentários, engajamento, duração, idade e canal) e <b>SEO</b> (pontuação de 0 a 100, checklist do que arrumar e as tags do vídeo, com ★ para as que estão no título e ▲ para as que estão na descrição) são calculados no seu navegador, de graça. <b>Canal</b> (inscritos, idade, tags do canal, mediana dos últimos vídeos e o quanto este vídeo está acima do normal) e <b>IA</b> (resumo, nota do gancho, por que foi bem ou mal, 3 ideias parecidas e dicas para ganhar inscritos) usam a sua conta.</li>
        <li><b>Busca:</b> resumo da busca (demanda, vídeos recentes, oportunidade) e pesquisa de palavras-chave.</li>
        <li><b>Canal:</b> botão para analisar o canal e adicionar aos concorrentes.</li>
        <li><b>Shorts e YouTube Studio:</b> botão do TurboCanal com SEO do vídeo e atalhos para a IA do vídeo e os 3 cortes.</li>
        <li><b>Ordenar a tela:</b> na busca e na página do canal, botões para reordenar os vídeos por mais vistos, melhor VPH, outliers ou mais novos (só muda a ordem do que já está na tela, de graça).</li>
        <li><b>Atalhos de graça:</b> baixar a capa do vídeo, copiar título, descrição e tags, copiar o código de incorporação no tempo atual e o botão 💡 na miniatura, que leva a ideia para o Preparar publicação.</li></ol>
        <p class="small muted">No ícone da extensão você liga ou desliga o VPH nas miniaturas e o painel automático, e vê quando sair versão nova.</p></div>
      <div class="card"><h3>De onde vêm os dados?</h3>
        <p class="muted">Das APIs oficiais e públicas do YouTube (YouTube Data API v3). Quando mostramos uma estimativa ou pontuação própria, isso vem identificado. Não inventamos métricas que a API não fornece.</p></div>
      <div class="card"><h3>Pagamentos</h3>
        <p class="muted">Aceitamos Pix por meio de provedor de pagamentos. Seu plano só é ativado depois que o provedor confirma o pagamento; não existe liberação por "já paguei". Problemas com uma cobrança? Fale com o administrador pela conta de contato do site.</p></div>
      <div class="card"><h3>Sou novo no YouTube, por onde começo?</h3>
        <p class="muted">1) Vincule seu canal e gere <a href="#/ferramentas/ideias">ideias de vídeos</a>; 2) pesquise as palavras-chave do seu nicho; 3) acompanhe 3 canais concorrentes; 4) use o Preparar publicação antes de gravar; 5) depois de postar, abra "Meu canal" e use a ✨ IA do vídeo nos vídeos com SEO baixo.</p></div>
      <div class="card"><h3>O editor de vídeo envia meu vídeo para algum lugar?</h3>
        <p class="muted">Não. O editor roda dentro do seu navegador: o arquivo não sai do seu computador e não gasta créditos. Só quando você clica em "Postar no meu canal" ele vai direto para o YouTube.</p></div>
      <div class="card"><h3>Por que preciso vincular o canal?</h3>
        <p class="muted">Para postar vídeos, criar lives, ver o analytics, responder comentários e trocar capas, o Google exige a sua autorização. Você vincula uma vez em "Meu canal" e pode desvincular quando quiser.</p></div>
      <div class="card"><h3>Privacidade e segurança</h3>
        <p class="muted">Você entra só com o Google: o TurboCanal não pede nem guarda a sua senha. Permissões, saldos e pagamentos são validados sempre no servidor, e só vídeos e playlists do seu próprio canal podem ser alterados. Detalhes na <a href="/privacidade">Política de Privacidade</a>.</p></div>
    </div>`;
  showExtVersion();
};

/* ------------------------------ Admin ------------------------------ */
const ADMIN_TABS = [
  ['geral', 'Visão geral'], ['usuarios', 'Usuários'], ['planos', 'Planos'], ['custos', 'Custos'],
  ['pagamentos', 'Pagamentos'], ['config', 'Configurações'], ['admins', 'Administradores'], ['auditoria', 'Auditoria']
];

// Mostra a versão atual no botão de baixar, para dar para comparar com a instalada
async function showExtVersion() {
  try {
    const r = await api('/extension/version');
    const b = $('#extDl'), v = $('#extVer');
    if (r.version && b) b.textContent = `⬇️ Baixar extensão v${r.version} (.zip)`;
    if (r.version && v) v.innerHTML = `Clique no ícone da extensão no Chrome: a versão ao lado do nome precisa ser a <b>${esc(r.version)}</b>.`;
  } catch {}
}

views.extensao = (p) => views.ajuda(p);

views.privacidade = async () => {
  appEl().innerHTML = `<h1>Política de Privacidade</h1><div class="card" style="max-width:820px">
    <p><b>Quem somos.</b> O TurboCanal é uma plataforma de ferramentas para criadores do YouTube. Não é afiliado ao YouTube, ao Google nem ao vidIQ.</p>
    <p><b>Dados que coletamos.</b> Ao entrar com o Google, recebemos seu nome, e-mail e identificador da conta Google, usados apenas para criar e identificar sua conta. Com sua autorização, acessamos dados do YouTube: dados públicos de vídeos e canais (para pesquisas e análises) e, se você conectar seu canal, dados e ações do seu próprio canal (vídeos, estatísticas, comentários, capas, transmissões), exclusivamente para executar as ações que você solicitar.</p>
    <p><b>Como usamos.</b> Para prestar o serviço: executar as ferramentas, registrar o uso de créditos e o histórico, e atender ao suporte. Não vendemos dados. Não usamos os dados do seu canal para treinar modelos de IA. Conteúdos enviados a provedores de IA (como títulos ou links públicos de vídeos) são usados só para gerar a resposta solicitada.</p>
    <p><b>Dados do Google.</b> O uso e a transferência de informações recebidas das APIs do Google seguem a <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Política de Dados do Usuário dos Serviços de API do Google</a>, inclusive os requisitos de uso limitado.</p>
    <p><b>Armazenamento e exclusão.</b> Tokens de acesso ficam cifrados em trânsito e guardados no servidor; você pode desconectar o canal a qualquer momento em "Meu canal" (os tokens são apagados) e revogar o acesso em <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>. Para excluir sua conta e seus dados, escreva para o e-mail de contato abaixo.</p>
    <p><b>Contato.</b> lcmatias777@gmail.com</p>
    <p class="muted small">Última atualização: outubro de 2026.</p></div>`;
};

views.termos = async () => {
  appEl().innerHTML = `<h1>Termos de Uso</h1><div class="card" style="max-width:820px">
    <p>1. O TurboCanal oferece ferramentas de pesquisa, análise e gestão para criadores do YouTube, por meio de um sistema de créditos. O plano Free é gratuito; os planos pagos são cobrados mensalmente e liberam créditos após a confirmação do pagamento.</p>
    <p>2. Você é responsável pelo conteúdo que publica no YouTube por meio da plataforma e por cumprir as regras do YouTube e do Google. As ações no seu canal (envio de vídeos, capas, lives, comentários) são executadas somente a seu pedido.</p>
    <p>3. Pontuações, estimativas e sugestões de IA são auxiliares e podem conter erros; confira antes de publicar.</p>
    <p>4. Não garantimos disponibilidade ininterrupta. Limites de uso podem ser aplicados para respeitar as cotas das APIs do Google.</p>
    <p>5. O uso abusivo (automação para burlar créditos, spam, violação de direitos) pode levar à suspensão da conta.</p>
    <p>6. Dúvidas: lcmatias777@gmail.com.</p>
    <p class="muted small">Última atualização: outubro de 2026.</p></div>`;
};

views.admin = async (params, sub) => {
  if (!state.user) return needLogin();
  if (!['owner', 'admin'].includes(state.user.role)) {
    appEl().innerHTML = alertBox('err', 'Acesso restrito ao painel administrativo.');
    return;
  }
  const tab = sub || 'geral';
  appEl().innerHTML = `
    <h1>🛠 Painel administrativo</h1>
    <div class="tabs">${ADMIN_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div>
    <div id="atab"><span class="spin"></span></div>`;
  const el = $('#atab');
  try { await adminTabs[tab]?.(el); } catch (e) { showErr(el, e); }
};

const adminTabs = {
  async geral(el) {
    const o = await api('/admin/overview');
    const cfgPill = (ok, okTxt, noTxt) => `<span class="pill ${ok ? 'ok' : 'warn'}">${ok ? okTxt : noTxt}</span>`;
    el.innerHTML = `
      <section class="grid cols3">
        <div class="card"><h3>Usuários</h3><div class="kpi">${fmt(o.users)}</div>
          <p class="muted small">${o.byPlan.map((p) => `${esc(p.plan_id)}: ${p.n}`).join(' · ')}</p></div>
        <div class="card"><h3>Créditos gastos (30 dias)</h3><div class="kpi">${fmt(o.creditsSpent30d)}</div>
          <p class="muted small">Indicador de uso e de custo operacional das APIs.</p></div>
        <div class="card"><h3>Pagamentos aprovados</h3><div class="kpi">${money(o.payments.approvedTotalCents)}</div>
          <p class="muted small">${o.payments.approvedCount} pagamentos confirmados.</p></div>
        <div class="card"><h3>Cota do YouTube hoje</h3><div class="kpi">${fmt(o.youtubeQuota?.usedToday || 0)} <small class="muted">/ ${fmt(o.youtubeQuota?.dailyLimit || 10000)}</small></div>
          <p class="muted small">Compartilhada por todo o site. Busca = 100 unidades, postar vídeo = 1.600, capa ou edição = 50, leitura = 1. Renova por volta das 4h ou 5h. Quando o site crescer, peça aumento gratuito ao Google no <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">formulário de cota da API do YouTube</a>.</p></div>
      </section>
      <div class="card"><h3>Status da configuração</h3>
        <p>YouTube API: ${cfgPill(o.config.youtubeApiConfigured, 'configurada', 'pendente')} ·
           IA Gemini: ${cfgPill(o.config.geminiConfigured, 'configurada', 'pendente')} ·
           Login Google: ${cfgPill(o.config.googleLoginConfigured, 'ativo', 'pendente')} ·
           Banco: ${cfgPill(o.config.database === 'postgres', 'Postgres persistente', esc(o.config.database || ''))} ·
           Provedor de pagamentos: ${cfgPill(o.config.paymentProviderConfigured, 'configurado', 'pendente')} ·
           Pagamentos: ${cfgPill(o.config.paymentsEnabled, 'ativados', 'desativados')} ·
           Chave Pix: ${cfgPill(o.config.pixKeyConfirmed, 'confirmada', 'não confirmada')}</p></div>
      <div class="card scroll"><h3>Uso por ferramenta (30 dias)</h3>
        ${o.usage30d.length ? `<table><tr><th>Ferramenta</th><th>Usos</th></tr>${o.usage30d.map((u) => `<tr><td>${esc(u.tool)}</td><td>${u.n}</td></tr>`).join('')}</table>` : '<p class="muted">Sem uso ainda.</p>'}</div>`;
  },

  async usuarios(el) {
    const load = async (q = '') => {
      const r = await api('/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      $('#ulist').innerHTML = `<table><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Plano</th><th>Créditos</th><th>Ações</th></tr>
        ${r.items.map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.name || '')}</td><td>${esc(u.role)}</td><td>${esc(u.plan_id)}</td>
          <td>${u.role === 'owner' ? '∞' : fmt(u.credits)}</td>
          <td class="small"><button class="btn sm ghost" data-cr="${u.id}">± créditos</button></td></tr>`).join('')}</table>`;
      for (const b of el.querySelectorAll('[data-cr]')) b.onclick = async () => {
        const delta = parseInt(prompt('Ajuste de créditos (ex.: 500 ou -200):'), 10);
        if (!delta) return;
        const note = prompt('Motivo do ajuste (fica na auditoria):') || '';
        try { await api(`/admin/users/${b.dataset.cr}/credits`, { method: 'POST', body: { delta, note } }); load($('#uq').value); }
        catch (e) { alert(e.message); }
      };
    };
    el.innerHTML = `<div class="card"><div class="row"><div><label>Buscar por e-mail ou nome</label><input id="uq"></div>
      <div class="fit"><button id="ub" class="btn sm secondary">Buscar</button></div></div>
      <div id="ulist" class="scroll" style="margin-top:12px"><span class="spin"></span></div></div>`;
    $('#ub').onclick = () => load($('#uq').value);
    await load();
  },

  async planos(el) {
    const r = await api('/admin/plans');
    el.innerHTML = `<div class="card scroll"><p class="muted small">Edite preço (em centavos), créditos mensais e status. O plano Free continua sempre gratuito.</p>
      <table><tr><th>ID</th><th>Nome</th><th>Preço (centavos)</th><th>Créditos/mês</th><th>Ativo</th><th></th></tr>
      ${r.items.map((p) => `<tr>
        <td>${esc(p.id)}</td>
        <td><input value="${esc(p.name)}" data-f="name" data-p="${p.id}" style="min-width:110px"></td>
        <td><input type="number" value="${p.price_cents}" data-f="price_cents" data-p="${p.id}" style="min-width:90px" ${p.id === 'free' ? 'disabled' : ''}></td>
        <td><input type="number" value="${p.monthly_credits}" data-f="monthly_credits" data-p="${p.id}" style="min-width:100px"></td>
        <td><input type="checkbox" ${p.active ? 'checked' : ''} data-f="active" data-p="${p.id}"></td>
        <td><button class="btn sm" data-save="${p.id}">Salvar</button></td></tr>`).join('')}</table></div>`;
    for (const b of el.querySelectorAll('[data-save]')) b.onclick = async () => {
      const id = b.dataset.save;
      const g = (f) => el.querySelector(`[data-p="${id}"][data-f="${f}"]`);
      try {
        await api('/admin/plans/' + id, { method: 'PUT', body: {
          name: g('name').value, price_cents: parseInt(g('price_cents').value, 10),
          monthly_credits: parseInt(g('monthly_credits').value, 10), active: g('active').checked
        }});
        b.textContent = 'Salvo ✓'; setTimeout(() => (b.textContent = 'Salvar'), 1500);
      } catch (e) { alert(e.message); }
    };
  },

  async custos(el) {
    const r = await api('/tools/costs');
    el.innerHTML = `<div class="card scroll"><p class="muted small">Custo em créditos de cada ferramenta. Ajuste conforme o custo real das APIs.</p>
      <table><tr><th>Ferramenta</th><th>Custo</th><th></th></tr>
      ${r.costs.map((c) => `<tr><td>${esc(c.label)} <span class="muted small">(${esc(c.tool)})</span></td>
        <td><input type="number" value="${c.cost}" data-t="${esc(c.tool)}" style="width:110px"></td>
        <td><button class="btn sm" data-save="${esc(c.tool)}">Salvar</button></td></tr>`).join('')}</table></div>`;
    for (const b of el.querySelectorAll('[data-save]')) b.onclick = async () => {
      const cost = parseInt(el.querySelector(`input[data-t="${b.dataset.save}"]`).value, 10);
      try { await api('/admin/tools/' + b.dataset.save, { method: 'PUT', body: { cost } }); b.textContent = 'Salvo ✓'; setTimeout(() => (b.textContent = 'Salvar'), 1500); }
      catch (e) { alert(e.message); }
    };
  },

  async pagamentos(el) {
    const r = await api('/admin/payments');
    el.innerHTML = `<div class="card scroll">${r.items.length ? `<table><tr><th>Data</th><th>Usuário</th><th>Plano</th><th>Valor</th><th>Status</th><th>Provedor</th><th></th></tr>
      ${r.items.map((p) => `<tr><td class="small">${dt(p.created_at)}</td><td>${esc(p.email || p.user_id)}</td><td>${esc(p.plan_id)}</td>
        <td>${money(p.amount_cents)}</td><td><span class="pill ${p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'err'}">${esc(p.status)}</span></td>
        <td class="small">${esc(p.provider || '')} ${esc(p.provider_id || '')}</td>
        <td>${p.status === 'pending' ? `<button class="btn sm secondary" data-c="${p.id}">Confirmar manualmente</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhum pagamento registrado.</p>'}
      <p class="muted small">A confirmação manual fica registrada na auditoria e deve ser usada só depois de conferir o recebimento de verdade (extrato/comprovante).</p></div>`;
    for (const b of el.querySelectorAll('[data-c]')) b.onclick = async () => {
      const note = prompt('Como você conferiu o recebimento? (obrigatório, vai para a auditoria)');
      if (!note) return;
      try { await api(`/admin/payments/${b.dataset.c}/confirm`, { method: 'POST', body: { note } }); adminTabs.pagamentos(el); }
      catch (e) { alert(e.message); }
    };
  },

  async config(el) {
    const { settings: s } = await api('/admin/settings');
    el.innerHTML = `
      <div class="grid cols2">
      <div class="card"><h3>Geral</h3><div id="cmsg"></div>
        <label>Nome do site</label><input id="c_site" value="${esc(s.site_name)}">
        <label>Recarga mensal do plano Free (créditos)</label><input id="c_topup" type="number" value="${esc(s.free_monthly_topup)}">
        <label>Chave da YouTube Data API ${s.yt_api_key.set ? `<span class="pill ok">configurada (${esc(s.yt_api_key.masked)})</span>` : '<span class="pill warn">pendente</span>'}</label>
        <input id="c_yt" placeholder="cole a chave para atualizar (vazio mantém a atual)">
        <label>Chave da API do Gemini (IA que assiste vídeos, sugere textos e acha cortes) ${s.gemini_api_key.set ? `<span class="pill ok">configurada (${esc(s.gemini_api_key.masked)})</span>` : '<span class="pill warn">pendente</span>'}</label>
        <input id="c_gem" placeholder="cole aqui a chave do Google AI Studio">
        <p class="small"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Criar chave grátis no Google AI Studio ↗</a> · <button class="btn sm secondary" type="button" id="c_gemTest">Testar a IA</button> <span id="c_gemOut" class="muted"></span></p>
        <p class="small muted">Uso gratuito, com limites por minuto e por dia do próprio Google. O site usa a IA só para textos e para achar os cortes (não gera imagens).</p>
        <p class="small muted">Login com Google: ${s.google_login_configured ? '<span class="pill ok">ativo</span>' : '<span class="pill warn">pendente</span> (variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor; URI de redirecionamento: <span class="copybox" style="display:inline-block">' + esc(s.google_redirect_uri) + '</span>)'}
        <br>Banco de dados: <span class="pill ${s.database === 'postgres' ? 'ok' : 'warn'}">${esc(s.database)}</span>${s.database !== 'postgres' ? ' (sem DATABASE_URL os dados não persistem em hospedagem com disco efêmero)' : ''}</p>
        <p><button id="csave" class="btn sm">Salvar</button></p></div>
      <div class="card"><h3>Pagamentos (Pix)</h3><div id="pmsg2"></div>
        <details class="small" ${s.payments_enabled === '1' ? '' : 'open'}><summary><b>Como ligar os pagamentos (passo a passo)</b></summary>
        <ol class="muted">
          <li><b>Chave Pix:</b> abra o app do seu banco e veja qual chave vai receber. Escreva ela aqui embaixo, escolha o tipo e marque a confirmação. O número do cadastro (54984398807) só vale se ele estiver mesmo cadastrado como chave Pix no banco.</li>
          <li><b>Conta no Mercado Pago:</b> entre em <a href="https://www.mercadopago.com.br/" target="_blank" rel="noopener">mercadopago.com.br</a> com o CPF/CNPJ que vai receber e cadastre a mesma chave Pix lá.</li>
          <li><b>Access Token:</b> vá em <a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" rel="noopener">Seus negócios &gt; Configurações &gt; Gestão e administração &gt; Credenciais</a>, crie uma aplicação e copie o <b>Access Token de produção</b> (começa com APP_USR-). Cole no campo abaixo. O de teste não recebe dinheiro de verdade.</li>
          <li><b>Webhook:</b> na mesma aplicação, em <b>Webhooks / Notificações</b>, cadastre o endereço que aparece abaixo e marque o evento <b>Pagamentos (payment)</b>. É assim que o site fica sabendo que você recebeu; sem isso o crédito não entra sozinho.</li>
          <li><b>Ativar:</b> marque "Pagamentos ativados" e salve. O site só deixa ativar depois que o token existe e a chave Pix está confirmada.</li>
          <li><b>Testar:</b> saia da conta de administrador (ela é isenta), entre com outra conta, escolha um plano e pague R$ 10 de verdade para você mesmo. Os créditos entram quando o Mercado Pago confirmar. Não existe botão de "já paguei".</li>
        </ol>
        <p class="muted">Custo: o Mercado Pago cobra uma taxa por Pix recebido (hoje em torno de 0,99%, confira na sua conta). O TurboCanal não cobra nada por fora.</p>
        </details>
        <label>Chave Pix de recebimento</label><input id="c_pix" value="${esc(s.pix_key_value)}">
        <label>Tipo da chave</label>
        <select id="c_pixt">${['phone|Telefone', 'cpf|CPF', 'cnpj|CNPJ', 'email|E-mail', 'random|Aleatória'].map((o) => { const [v, l] = o.split('|'); return `<option value="${v}" ${s.pix_key_type === v ? 'selected' : ''}>${l}</option>`; }).join('')}</select>
        <p class="small ${s.pix_key_confirmed === '1' ? 'muted' : ''}"><label style="display:inline"><input type="checkbox" id="c_pixok" style="width:auto" ${s.pix_key_confirmed === '1' ? 'checked' : ''}> Confirmo que esta chave Pix existe, é deste tipo e pertence ao recebedor.</label></p>
        ${s.pix_key_confirmed !== '1' ? alertBox('warn', 'O número informado no cadastro inicial (telefone) ainda NÃO foi validado como chave Pix. Confira no app do seu banco se ele está cadastrado como chave antes de confirmar.') : ''}
        <label>Access Token do Mercado Pago ${s.mp_access_token.set ? `<span class="pill ok">configurado (${esc(s.mp_access_token.masked)})</span>` : '<span class="pill warn">pendente</span>'}</label>
        <input id="c_mp" placeholder="APP_USR-... (vazio mantém o atual)">
        <p class="small muted">Webhook para cadastrar no Mercado Pago: <span class="copybox" style="display:inline-block">${esc(s.webhook_url)}</span></p>
        <p><label style="display:inline"><input type="checkbox" id="c_payon" style="width:auto" ${s.payments_enabled === '1' ? 'checked' : ''}> Pagamentos ativados</label></p>
        <p><button id="psave" class="btn sm">Salvar pagamentos</button></p></div>
      </div>`;
    $('#csave').onclick = async () => {
      try {
        const updates = { site_name: $('#c_site').value, free_monthly_topup: $('#c_topup').value };
        if ($('#c_yt').value.trim()) updates.yt_api_key = $('#c_yt').value.trim();
        if ($('#c_gem').value.trim()) updates.gemini_api_key = $('#c_gem').value.trim();
        await api('/admin/settings', { method: 'PUT', body: { updates } });
        state.pub = await api('/settings/public');
        $('#cmsg').innerHTML = alertBox('ok', 'Configurações salvas.');
      } catch (e) { showErr($('#cmsg'), e); }
    };
    // Salva a chave colada (se houver) e testa a IA na hora
    $('#c_gemTest').onclick = async () => {
      const o = $('#c_gemOut');
      o.innerHTML = '<span class="spin"></span>';
      try {
        const k = $('#c_gem').value.trim();
        if (k) await api('/admin/settings', { method: 'PUT', body: { updates: { gemini_api_key: k } } });
        const r = await api('/admin/ai-test', { method: 'POST' });
        state.pub = await api('/settings/public');
        o.innerHTML = r.ok ? `<span class="pill ok">✅ IA funcionando (${esc(r.modelo)})</span>` : `<span class="pill warn">a IA respondeu: ${esc(r.resposta)}</span>`;
        if (k) $('#c_gem').value = '';
      } catch (e) { o.innerHTML = `<span class="pill err">${esc(e.message)}</span>`; }
    };
    $('#psave').onclick = async () => {
      try {
        const updates = {
          pix_key_value: $('#c_pix').value, pix_key_type: $('#c_pixt').value,
          pix_key_confirmed: $('#c_pixok').checked ? '1' : '0',
          payments_enabled: $('#c_payon').checked ? '1' : '0'
        };
        if ($('#c_mp').value.trim()) updates.mp_access_token = $('#c_mp').value.trim();
        await api('/admin/settings', { method: 'PUT', body: { updates } });
        $('#pmsg2').innerHTML = alertBox('ok', 'Configurações de pagamento salvas.');
        adminTabs.config(el);
      } catch (e) { showErr($('#pmsg2'), e); }
    };
  },

  async admins(el) {
    const r = await api('/admin/admins');
    const isOwner = state.user.role === 'owner';
    el.innerHTML = `
      <div class="card"><h3>Administradores</h3>
        <p class="muted small">Somente o administrador principal pode promover ou remover administradores. O administrador principal nunca pode ser removido ou rebaixado, nem por outros administradores. Todas as alterações ficam na auditoria.</p>
        <div class="scroll"><table><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th></th></tr>
        ${r.items.map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(a.name || '')}</td>
          <td>${a.role === 'owner' ? '<span class="pill ok">principal</span>' : 'admin'}</td>
          <td>${isOwner && a.role === 'admin' ? `<button class="btn sm danger" data-d="${a.id}">Remover</button>` : ''}</td></tr>`).join('')}</table></div>
        ${isOwner ? `<h3>Adicionar administrador</h3><div id="amsg"></div>
          <div class="row"><div><label>E-mail de uma conta já cadastrada</label><input id="aemail" type="email"></div>
          <div class="fit"><button id="aadd" class="btn sm">Promover a admin</button></div></div>` : '<p class="muted small">Você é administrador, mas apenas o principal gerencia a lista.</p>'}
      </div>`;
    if (isOwner) {
      $('#aadd').onclick = async () => {
        try { await api('/admin/admins', { method: 'POST', body: { email: $('#aemail').value } }); adminTabs.admins(el); }
        catch (e) { showErr($('#amsg'), e); }
      };
      for (const b of el.querySelectorAll('[data-d]')) b.onclick = async () => {
        if (!confirm('Remover este administrador?')) return;
        try { await api('/admin/admins/' + b.dataset.d, { method: 'DELETE' }); adminTabs.admins(el); }
        catch (e) { alert(e.message); }
      };
    }
  },

  async auditoria(el) {
    const r = await api('/admin/audit');
    el.innerHTML = `<div class="card scroll"><table><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Detalhe</th></tr>
      ${r.items.map((a) => `<tr><td class="small">${dt(a.created_at)}</td><td class="small">${esc(a.actor_email)}</td>
        <td>${esc(a.action)}</td><td class="small">${esc(a.target || '')}</td><td class="small muted">${esc(a.detail || '')}</td></tr>`).join('')}</table></div>`;
  }
};

/* ------------------------------ Router ------------------------------ */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || '';
  const [pathPart, queryPart] = hash.split('?');
  const params = new URLSearchParams(queryPart || '');
  const segs = pathPart.split('/').filter(Boolean);
  renderNav();
  appEl().innerHTML = '<p class="center"><span class="spin"></span></p>';
  try {
    if (!segs.length) return await views.home(params);
    if (segs[0] === 'admin') return await views.admin(params, segs[1]);
    if (segs[0] === 'canal') return await views.canal(params, segs[1]);
    if (segs[0] === 'ferramentas' && views['ferramentas/' + segs[1]]) return await views['ferramentas/' + segs[1]](params);
    if (views[segs[0]]) return await views[segs[0]](params);
    appEl().innerHTML = alertBox('err', 'Página não encontrada.') + '<p><a class="btn" href="#/">Voltar ao início</a></p>';
  } catch (e) {
    appEl().innerHTML = alertBox('err', esc(e.message || 'Erro inesperado.'));
  }
}

window.addEventListener('hashchange', route);

(async function boot() {
  try { state.pub = await api('/settings/public'); } catch {}
  try { state.costs = (await api('/tools/costs')).costs; } catch {}
  await refreshMe();
  route();
})();
