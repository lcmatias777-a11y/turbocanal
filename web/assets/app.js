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
  ['#/ferramentas/tendencias', 'Tendências'],
  ['#/ferramentas/titulos', 'Títulos (IA)'],
  ['#/ferramentas/descricao', 'Descrição (IA)'],
  ['#/ferramentas/insights', 'IA assiste o vídeo'],
  ['#/ferramentas/preparar', '📝 Preparar publicação'],
  ['#/ferramentas/transformar', '🔁 Transformar vídeo (IA)'],
  ['#/ferramentas/editor', '✂️ Editor de vídeo'],
  ['#/ferramentas/criar-capa', '🎨 Criar capa'],
  ['#/ferramentas/capa', 'Capa com IA'],
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
        ['🔎 Palavras-chave e tendências', 'Termos com demanda real a partir da API oficial do YouTube, com views por hora (VPH) e vídeos que estão estourando (outliers).'],
        ['📺 Seu canal, como no Studio', 'Postar vídeo com agendamento, criar live com chave de transmissão, analytics, comentários, capas e testes A/B, tudo daqui.'],
        ['✂️ Editor de vídeo grátis', 'Corte trechos, transforme em Shorts 9:16, acelere, tire o áudio. Roda no seu navegador, sem gastar créditos.'],
        ['🎨 Capas que chamam clique', 'Crie capas com texto grande a partir de um quadro do vídeo e veja a prévia no feed (claro, escuro e celular).'],
        ['🤖 IA para criadores', 'Prepara título, descrição, tags e roteiro; assiste o vídeo e acha os melhores cortes para Shorts.'],
        ['🏆 Concorrentes', 'Acompanhe canais do seu nicho e descubra quais vídeos deles estão performando acima da média.'],
        ['📈 SEO de cada vídeo', 'Nota de SEO com o que falta arrumar em cada vídeo do seu canal.'],
        ['🧩 Extensão Chrome', 'Painel na página do vídeo do YouTube: VPH, engajamento, tags e SEO, com a mesma conta.']
      ].map(([t, d]) => `<div class="card"><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </section>
    <p class="center" style="margin-top:18px"><a class="btn ghost" href="#/ajuda">🧩 Baixar a extensão para Chrome</a></p>
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
  appEl().innerHTML = `
    <h1>Olá, ${esc(u.name || u.email.split('@')[0])} 👋</h1>
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
    insights: 'video_insights_ai', capa: 'thumbnail_ai', preparar: 'prep_ai', transformar: 'transform_ai', concorrentes: 'competitor_check'
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
        $('#msg').innerHTML = alertBox('err', esc(e.message) + (e.status === 402 ? ' <a href="#/planos">Ver planos</a>' : '') + (e.status === 409 ? ' <span class="muted small">(configuração pendente, nenhum crédito foi cobrado)</span>' : ''));
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

views['ferramentas/tendencias'] = toolPage({
  title: '🔥 Tendências', toolKey: 'trends',
  desc: 'Vídeos em alta agora (dados oficiais "mostPopular" da API do YouTube).',
  formHtml: `<label>País</label><select name="region"><option value="BR">Brasil</option><option value="US">Estados Unidos</option><option value="PT">Portugal</option><option value="AR">Argentina</option></select>`,
  getBody: (fd) => ({ region: fd.get('region') }),
  render: (r) => videoTable(r.items)
});

views['ferramentas/titulos'] = toolPage({
  title: '🤖 Sugestões de títulos', toolKey: 'title_ai',
  desc: 'Receba 8 ideias de título para o seu próximo vídeo. O método usado (IA ou gerador local) é sempre informado.',
  formHtml: `<label>Tema do vídeo</label><input name="topic" required maxlength="200" placeholder="ex.: como vencer no bedwars">
    <label>Palavras-chave (opcional, separadas por vírgula)</label><input name="kw" placeholder="minecraft, pvp, dicas">`,
  getBody: (fd) => ({ topic: fd.get('topic'), keywords: String(fd.get('kw') || '').split(',').map((s) => s.trim()).filter(Boolean) }),
  render: (r) => `<div class="card"><h3>Títulos sugeridos <span class="pill">${r.metodo === 'ia' ? 'IA (' + esc(r.modelo) + ')' : 'gerador local'}</span></h3>
    <ol>${r.titles.map((t) => `<li style="margin:8px 0">${esc(t)} <button class="btn sm ghost" onclick="navigator.clipboard.writeText(this.previousSibling.textContent.trim())">copiar</button></li>`).join('')}</ol></div>`
});

views['ferramentas/descricao'] = toolPage({
  title: '📝 Otimização de descrição', toolKey: 'description_ai',
  desc: 'Gere ou melhore a descrição do seu vídeo com estrutura de SEO (promessa, capítulos, CTA, hashtags).',
  formHtml: `<label>Tema do vídeo</label><input name="topic" required maxlength="200">
    <label>Rascunho atual (opcional)</label><textarea name="draft" maxlength="4000"></textarea>
    <label>Palavras-chave (opcional)</label><input name="kw" placeholder="separadas por vírgula">`,
  getBody: (fd) => ({ topic: fd.get('topic'), draft: fd.get('draft'), keywords: String(fd.get('kw') || '').split(',').map((s) => s.trim()).filter(Boolean) }),
  render: (r) => `<div class="card"><h3>Descrição sugerida <span class="pill">${r.metodo === 'ia' ? 'IA (' + esc(r.modelo) + ')' : 'gerador local'}</span></h3>
    <textarea style="min-height:260px" readonly>${esc(r.description)}</textarea>
    <p><button class="btn sm secondary" onclick="navigator.clipboard.writeText(document.querySelector('#out textarea').value)">Copiar descrição</button></p></div>`
});

views['ferramentas/insights'] = toolPage({
  title: '🎥 IA assiste o vídeo', toolKey: 'video_insights_ai',
  desc: 'A IA (Gemini) assiste ao vídeo pela URL e devolve resumo, ganchos, títulos, tags, ideia de capa e melhorias.',
  formHtml: `<label>Link ou ID do vídeo (público)</label><input name="video" required placeholder="https://www.youtube.com/watch?v=...">`,
  getBody: (fd) => ({ video: fd.get('video') }),
  render: (r) => {
    const i = r.insights || {};
    const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>`;
    return `<div class="grid cols2">
      <div class="card"><h3>Resumo</h3><p>${esc(i.resumo || '')}</p><p class="muted small">Público: ${esc(i.publico || '')}</p>
        <p>Nota de retenção (heurística): <b>${esc(String(i.nota_retencao ?? ''))}</b></p></div>
      <div class="card"><h3>Ganchos de abertura</h3>${list(i.ganchos)}</div>
      <div class="card"><h3>Títulos sugeridos</h3>${list(i.titulos)}</div>
      <div class="card"><h3>Tags</h3><p>${(i.tags || []).map((t) => `<span class="pill">${esc(t)}</span> `).join('')}</p></div>
      <div class="card"><h3>Ideia de capa</h3><p>${esc(typeof i.capa === 'string' ? i.capa : JSON.stringify(i.capa || ''))}</p>
        <p><a class="btn sm secondary" href="#/ferramentas/capa">Gerar essa capa com IA →</a></p></div>
      <div class="card"><h3>Melhorias</h3>${list(i.melhorias)}</div>
    </div>`;
  }
});

views['ferramentas/capa'] = toolPage({
  title: '🖼️ Capa com IA', toolKey: 'thumbnail_ai',
  desc: 'Gere uma thumbnail 16:9 com IA (Gemini). Depois você pode enviá-la direto para um vídeo seu em "Meu canal".',
  formHtml: `<label>Título ou tema do vídeo</label><input name="title" required maxlength="200" placeholder="ex.: Como vencer no Bedwars">
    <label>Detalhes da cena (opcional)</label><textarea name="brief" maxlength="600" placeholder="ex.: personagem surpreso, explosão colorida ao fundo, texto 'IMPOSSÍVEL'"></textarea>
    <label>Estilo</label><select name="style"><option>vibrante</option><option>minimalista</option><option>gamer</option><option>cinematográfico</option><option>cartoon</option></select>`,
  getBody: (fd) => ({ title: fd.get('title'), brief: fd.get('brief'), style: fd.get('style') }),
  render: (r) => {
    const src = `data:${r.mime};base64,${r.base64}`;
    state.lastThumb = src;
    return `<div class="card"><img src="${src}" style="max-width:100%;border-radius:10px" alt="Capa gerada">
      <p><a class="btn sm" download="capa-turbocanal.png" href="${src}">Baixar imagem</a>
         <a class="btn sm secondary" href="#/canal">Enviar para um vídeo meu →</a></p>
      <p class="muted small">Modelo: ${esc(r.modelo)}. Confira o texto da imagem antes de usar.</p></div>`;
  }
});

/* ------------------------------ Preparar / Transformar / Editor / Capa / Concorrentes ------------------------------ */
const studioCtx = () => ({ esc, alertBox, fmt, state, api, refreshMe, go: (h) => (location.hash = h) });
const loadStudio = () => import('./studio.js');

function copyBtn(text, label = 'copiar') {
  return `<button class="btn sm ghost" type="button" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(String(text || '')))});this.textContent='copiado ✓'">${label}</button>`;
}

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
  desc: 'A IA assiste o vídeo e reaproveita: acha os melhores trechos para Shorts (com os tempos), ou transforma em post da Comunidade, artigo de blog ou sequência para redes.',
  formHtml: `<label>Link ou ID do vídeo (público)</label><input name="video" required placeholder="https://www.youtube.com/watch?v=...">
    <label>Transformar em</label><select name="mode"><option value="shorts">✂️ Cortes para Shorts (trechos com tempo)</option><option value="post">📣 Post da Comunidade + enquete</option><option value="artigo">📰 Artigo de blog</option><option value="thread">🧵 Sequência para redes sociais</option></select>`,
  getBody: (fd) => ({ video: fd.get('video'), mode: fd.get('mode') }),
  render: (r) => {
    const x = r.resultado || {};
    if (r.mode === 'shorts') {
      return `<div class="card"><h3>Trechos para Shorts</h3>${(x.cortes || []).map((c, i) => `
        <div style="border-bottom:1px solid var(--line);padding:8px 0"><b>${esc(c.titulo || 'Corte ' + (i + 1))}</b> <span class="pill">${esc(c.inicio)} → ${esc(c.fim)}</span>
          <p class="small">Gancho: ${esc(c.gancho || '')}<br><span class="muted">${esc(c.motivo || '')}</span></p>
          <button class="btn sm secondary" type="button" data-cut="${i}">✂️ Abrir no editor com estes tempos</button></div>`).join('') || '<p class="muted">Nenhum trecho sugerido.</p>'}
        <p class="muted small">O editor corta o arquivo ORIGINAL do seu computador (por direitos autorais, não baixamos vídeos do YouTube).</p></div>`;
    }
    if (r.mode === 'post') return `<div class="card"><h3>Post da Comunidade</h3><textarea style="min-height:160px">${esc(x.post || '')}</textarea><p>${copyBtn(x.post, 'copiar post')}</p>
      ${x.enquete ? `<h3>Enquete</h3><p><b>${esc(x.enquete.pergunta || '')}</b></p><ol>${(x.enquete.opcoes || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}</div>`;
    if (r.mode === 'artigo') return `<div class="card"><h3>${esc(x.titulo || 'Artigo')}</h3><textarea style="min-height:360px">${esc(x.texto || '')}</textarea><p>${copyBtn((x.titulo ? x.titulo + '\n\n' : '') + (x.texto || ''), 'copiar artigo')}</p></div>`;
    return `<div class="card"><h3>Sequência</h3><ol>${(x.posts || []).map((t) => `<li style="margin:6px 0">${esc(t)} ${copyBtn(t)}</li>`).join('')}</ol></div>`;
  },
  after: (r, out) => {
    const toSec = (t) => String(t || '0').split(':').reduce((a, n) => a * 60 + (parseFloat(n) || 0), 0);
    for (const b of out.querySelectorAll('[data-cut]')) b.onclick = () => {
      const c = (r.resultado?.cortes || [])[+b.dataset.cut] || {};
      state.editorPreset = { start: toSec(c.inicio), end: toSec(c.fim), title: c.titulo || '', shorts: true };
      location.hash = '#/ferramentas/editor';
    };
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

const CANAL_TABS = [['videos', '🎬 Meus vídeos'], ['postar', '⬆️ Postar vídeo'], ['editar', '✂️ Editar vídeo'], ['capa', '🎨 Criar capa'], ['live', '🔴 Live'], ['analytics', '📊 Analytics'], ['comentarios', '💬 Comentários'], ['ab', '🧪 Testes A/B']];

views.canal = async (params, sub) => {
  if (!state.user) return needLogin();
  const u = state.user;
  if (!u.youtube?.connected) {
    appEl().innerHTML = `
      <h1>📺 Meu canal</h1>
      <div class="card" style="max-width:680px">
        <h3>Vincule seu canal do YouTube</h3>
        <p>Com o canal vinculado você tem, aqui dentro: seus vídeos e estatísticas, <b>postar vídeo</b> (com agendamento), <b>criar live</b> (com chave de transmissão), <b>analytics</b>, <b>comentários</b> (ler e responder), <b>capas</b> (inclusive geradas por IA), <b>teste A/B de capas</b> e edição de título/descrição. Só vídeos do canal vinculado podem ser alterados, e tudo é verificado no servidor.</p>
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
        <div class="card" id="v-${esc(v.id)}">
          <div class="thumbrow">${v.thumb ? `<img src="${esc(v.thumb)}">` : ''}<div><b>${esc(v.title)}</b>
            <p class="muted small">👁 ${fmt(v.views)} · 👍 ${fmt(v.likes)} · 💬 ${fmt(v.comments)} · ⚡ ${fmt(v.vph)}/h · ${dt(v.publishedAt).split(',')[0]} · ${esc(v.privacy || '')}</p>
            <p class="small"><span class="pill ${v.seoScore >= 80 ? 'ok' : v.seoScore >= 50 ? 'warn' : 'err'}" title="${esc((v.seoTodo || []).join(' · ') || 'Tudo certo')}">SEO ${v.seoScore ?? '—'}/100</span>
              ${(v.seoTodo || []).length ? `<span class="muted">falta: ${esc((v.seoTodo || []).slice(0, 2).join(', '))}${v.seoTodo.length > 2 ? '…' : ''}</span>` : '<span class="muted">checklist completo ✅</span>'}</p>
            <p class="small"><a href="https://studio.youtube.com/video/${esc(v.id)}/edit" target="_blank" rel="noopener">editar no Studio ↗</a> · <a href="#/ferramentas/insights" data-insight="${esc(v.id)}">IA assiste este vídeo</a> · <a href="#/ferramentas/transformar" data-transform="${esc(v.id)}">transformar em Shorts</a></p></div></div>
          <details><summary class="small">✏️ Editar título e descrição</summary>
            <label>Título</label><input data-f="title" value="${esc(v.title)}" maxlength="100">
            <label>Descrição</label><textarea data-f="description">${esc(v.description)}</textarea>
            <p><button class="btn sm" data-save="${esc(v.id)}">Salvar no YouTube</button> <span class="muted small">${costOf('video_update')}</span></p></details>
          <details><summary class="small">🖼️ Enviar capa</summary>
            <label>Imagem (JPG/PNG, até 2 MB, 1280x720)</label><input type="file" accept="image/*" data-file="${esc(v.id)}">
            ${state.lastThumb ? `<p class="small"><label style="display:inline"><input type="checkbox" data-uselast="${esc(v.id)}" style="width:auto"> usar a última capa gerada por IA</label></p>` : '<p class="small muted">Dica: gere uma capa em <a href="#/ferramentas/capa">Capa com IA</a> e volte aqui.</p>'}
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
    for (const a of el.querySelectorAll('[data-insight]')) a.onclick = () => { state.toolPrefill = { video: 'https://www.youtube.com/watch?v=' + a.dataset.insight }; };
    for (const a of el.querySelectorAll('[data-transform]')) a.onclick = () => { state.toolPrefill = { video: 'https://www.youtube.com/watch?v=' + a.dataset.transform, mode: 'shorts' }; };
    const msg = (id, kind, html) => ($('#m-' + id).innerHTML = alertBox(kind, html));
    for (const b of el.querySelectorAll('[data-save]')) b.onclick = async () => {
      const id = b.dataset.save, card = $('#v-' + id);
      try {
        const r = await api('/channel/videos/' + id, { method: 'PUT', body: { title: card.querySelector('[data-f=title]').value, description: card.querySelector('[data-f=description]').value } });
        await refreshMe(); msg(id, 'ok', 'Salvo no YouTube. ' + creditsNote(r.credits));
      } catch (e) { msg(id, 'err', esc(e.message)); }
    };
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
        <p><a class="btn sm" href="/turbocanal-extensao.zip" download>⬇️ Baixar extensão (.zip)</a></p>
        <ol class="muted">
        <li>Baixe o arquivo acima e descompacte (botão direito &gt; Extrair tudo).</li>
        <li>No Chrome, digite <b>chrome://extensions</b> na barra de endereço e aperte Enter.</li>
        <li>Ative o <b>Modo do desenvolvedor</b> (chavinha no canto superior direito).</li>
        <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta descompactada (a que contém o arquivo manifest.json).</li>
        <li>Clique no 🚀 na barra do Chrome e entre com a mesma conta do site.</li></ol>
        <p class="small muted">A extensão ainda não está publicada na Chrome Web Store, por isso a instalação é manual (modo do desenvolvedor). Quando for publicada na loja, bastará um clique.</p></div>
      <div class="card"><h3>De onde vêm os dados?</h3>
        <p class="muted">Das APIs oficiais e públicas do YouTube (YouTube Data API v3). Quando mostramos uma estimativa ou pontuação própria, isso vem identificado. Não inventamos métricas que a API não fornece.</p></div>
      <div class="card"><h3>Pagamentos</h3>
        <p class="muted">Aceitamos Pix por meio de provedor de pagamentos. Seu plano só é ativado depois que o provedor confirma o pagamento; não existe liberação por "já paguei". Problemas com uma cobrança? Fale com o administrador pela conta de contato do site.</p></div>
      <div class="card"><h3>Sou novo no YouTube, por onde começo?</h3>
        <p class="muted">1) Pesquise palavras-chave do seu nicho; 2) analise 3 canais concorrentes e veja a média de views deles; 3) use as sugestões de título antes de gravar; 4) rode a análise de SEO no vídeo publicado e aplique as dicas.</p></div>
      <div class="card"><h3>O editor de vídeo envia meu vídeo para algum lugar?</h3>
        <p class="muted">Não. O editor roda dentro do seu navegador: o arquivo não sai do seu computador e não gasta créditos. Só quando você clica em "Postar no meu canal" ele vai direto para o YouTube.</p></div>
      <div class="card"><h3>Por que preciso vincular o canal?</h3>
        <p class="muted">Para postar vídeos, criar lives, ver o analytics, responder comentários e trocar capas, o Google exige a sua autorização. Você vincula uma vez em "Meu canal" e pode desvincular quando quiser.</p></div>
      <div class="card"><h3>Privacidade e segurança</h3>
        <p class="muted">Senhas são armazenadas com hash (bcrypt). Permissões, saldos e pagamentos são validados sempre no servidor. O token da extensão equivale a uma senha: não compartilhe.</p></div>
    </div>`;
};

/* ------------------------------ Admin ------------------------------ */
const ADMIN_TABS = [
  ['geral', 'Visão geral'], ['usuarios', 'Usuários'], ['planos', 'Planos'], ['custos', 'Custos'],
  ['pagamentos', 'Pagamentos'], ['config', 'Configurações'], ['admins', 'Administradores'], ['auditoria', 'Auditoria']
];

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
        <label>Chave da API do Gemini (IA que assiste vídeos e gera capas) ${s.gemini_api_key.set ? `<span class="pill ok">configurada (${esc(s.gemini_api_key.masked)})</span>` : '<span class="pill warn">pendente</span>'}</label>
        <input id="c_gem" placeholder="chave do Google AI Studio (aistudio.google.com), plano gratuito">
        <p class="small muted">Login com Google: ${s.google_login_configured ? '<span class="pill ok">ativo</span>' : '<span class="pill warn">pendente</span> (variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor; URI de redirecionamento: <span class="copybox" style="display:inline-block">' + esc(s.google_redirect_uri) + '</span>)'}
        <br>Banco de dados: <span class="pill ${s.database === 'postgres' ? 'ok' : 'warn'}">${esc(s.database)}</span>${s.database !== 'postgres' ? ' (sem DATABASE_URL os dados não persistem em hospedagem com disco efêmero)' : ''}</p>
        <p><button id="csave" class="btn sm">Salvar</button></p></div>
      <div class="card"><h3>Pagamentos (Pix)</h3><div id="pmsg2"></div>
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
        $('#cmsg').innerHTML = alertBox('ok', 'Configurações salvas.');
      } catch (e) { showErr($('#cmsg'), e); }
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
