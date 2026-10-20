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
        ${u ? link('#/dashboard', 'Painel') + link('#/ferramentas/palavras', 'Ferramentas') + link('#/historico', 'Histórico') : ''}
        ${link('#/planos', 'Planos')}
        ${link('#/ajuda', 'Ajuda')}
        ${isAdmin ? link('#/admin', '🛠 Admin') : ''}
      </div>
      <div class="spacer"></div>
      ${u
        ? `<span class="badge credits" title="Seu saldo de créditos">💎 ${u.unlimited ? 'Ilimitado' : fmt(u.credits)}</span>
           ${u.role !== 'user' ? `<span class="badge role">${u.role === 'owner' ? 'Administrador principal' : 'Administrador'}</span>` : ''}
           <a class="navlink" href="#/conta">⚙️ Conta</a>
           <a class="navlink" href="#/sair">Sair</a>`
        : `<a class="navlink" href="#/login">Entrar</a> <a class="btn sm" href="#/cadastro">Criar conta grátis</a>`}
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
        <a class="btn" href="#/cadastro">Começar grátis com 5.000 créditos</a>
        <a class="btn ghost" href="#/planos">Ver planos</a>
      </p>
    </section>
    <section class="grid cols3">
      ${[
        ['🔎 Palavras-chave', 'Descubra termos com demanda real a partir de dados públicos da API oficial do YouTube.'],
        ['📈 Análise de SEO', 'Checklist com pontuação e dicas práticas para título, descrição, tags e duração.'],
        ['🏆 Concorrentes', 'Analise canais públicos: inscritos, média de views recentes e vídeos que performam.'],
        ['🔥 Tendências', 'Veja o que está em alta no Brasil e gere ideias de conteúdo.'],
        ['🤖 IA para criadores', 'Sugestões de títulos e descrições otimizadas (quando a IA está ativada no servidor, você é avisado do método usado).'],
        ['🧩 Extensão Chrome', 'Analise qualquer vídeo direto na página do YouTube, com a mesma conta e o mesmo saldo.']
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
      : `<a class="btn secondary" href="#/cadastro">Criar conta grátis</a>`}
  </div>`;
}

views.login = async (params) => {
  appEl().innerHTML = `
    <div class="card" style="max-width:420px;margin:30px auto">
      <h2>Entrar</h2>
      ${params.get('erro') ? alertBox('err', esc(params.get('erro'))) : ''}
      <div id="msg"></div>
      <form id="f">
        <label>E-mail</label><input name="email" type="email" required>
        <label>Senha</label><input name="password" type="password" required>
        <p><button class="btn" style="width:100%">Entrar</button></p>
      </form>
      ${state.pub.google_login ? `<p class="center"><a class="btn ghost" href="/api/auth/google">Entrar com Google</a></p>` : ''}
      <p class="muted small center">Não tem conta? <a href="#/cadastro">Crie grátis</a>.</p>
    </div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      await refreshMe();
      location.hash = '#/dashboard';
    } catch (e) { showErr($('#msg'), e); }
  };
};

views.cadastro = async () => {
  appEl().innerHTML = `
    <div class="card" style="max-width:460px;margin:30px auto">
      <h2>Criar conta grátis</h2>
      <p class="muted small">Você começa com 5.000 créditos, com recarga mensal automática no plano Free.</p>
      <div id="msg"></div>
      <form id="f">
        <label>Seu nome</label><input name="name" maxlength="120">
        <label>E-mail</label><input name="email" type="email" required>
        <label>Senha (mín. 8 caracteres)</label><input name="password" type="password" minlength="8" required>
        <p><button class="btn" style="width:100%">Criar conta</button></p>
      </form>
      ${state.pub.google_login ? `<p class="center"><a class="btn ghost" href="/api/auth/google">Cadastrar com Google</a></p>` : ''}
    </div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      await api('/auth/register', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') } });
      await refreshMe();
      location.hash = '#/dashboard';
    } catch (e) { showErr($('#msg'), e); }
  };
};

views.sair = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  state.user = null; renderNav();
  location.hash = '#/';
};

function needLogin() {
  appEl().innerHTML = `<div class="card center" style="max-width:420px;margin:40px auto">
    <h3>Faça login para continuar</h3>
    <p><a class="btn" href="#/login">Entrar</a> <a class="btn ghost" href="#/cadastro">Criar conta grátis</a></p></div>`;
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
      <div class="card"><h3>Extensão Chrome</h3><p class="muted small">Analise vídeos direto no YouTube com a mesma conta.</p>
        <a class="btn sm secondary" href="#/ajuda">Como instalar</a></div>
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
    tendencias: 'trends', titulos: 'title_ai', descricao: 'description_ai', busca: 'video_search'
  };
  const key = map[hash.split('/').pop()];
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
  return alertBox('ok', `Foram usados <b>${credits.charged}</b> créditos. Saldo atual: <b>${fmt(credits.balance)}</b>.`);
}
function resultAviso(result) {
  const parts = [];
  if (result?.mock) parts.push('⚠️ ' + esc(result.aviso || 'Dados de exemplo (modo de teste).'));
  else if (result?.aviso) parts.push('ℹ️ ' + esc(result.aviso));
  return parts.length ? alertBox('warn', parts.join('<br>')) : '';
}

function toolPage({ title, desc, toolKey, formHtml, getBody, render }) {
  return async () => {
    if (!state.user) return needLogin();
    const cost = state.costs.find((c) => c.tool === toolKey)?.cost;
    appEl().innerHTML = `
      <h1>${title}</h1>
      <p class="muted">${desc} ${cost != null ? `· <span class="pill">${state.user.unlimited ? 'Incluído (ilimitado)' : cost + ' créditos por uso'}</span>` : ''}</p>
      <div class="card"><form id="f">${formHtml}
        <p><button class="btn">Executar <span id="sp"></span></button></p></form></div>
      <div id="msg"></div><div id="out"></div>`;
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const body = getBody(new FormData(ev.target));
      $('#sp').innerHTML = '<span class="spin"></span>'; $('#msg').innerHTML = ''; $('#out').innerHTML = '';
      try {
        const r = await api('/tools/' + toolKey, { method: 'POST', body });
        await refreshMe();
        $('#msg').innerHTML = creditsNote(r.credits) + resultAviso(r.result);
        $('#out').innerHTML = render(r.result);
      } catch (e) {
        $('#msg').innerHTML = alertBox('err', esc(e.message) + (e.status === 402 ? ' <a href="#/planos">Ver planos</a>' : '') + (e.status === 409 ? ' <span class="muted small">(configuração pendente, nenhum crédito foi cobrado)</span>' : ''));
      }
      $('#sp').innerHTML = '';
    };
  };
}

function videoTable(items) {
  return `<div class="card scroll"><table><tr><th></th><th>Vídeo</th><th>Canal</th><th>Views</th><th>Likes</th><th>Publicado</th></tr>
    ${items.map((v) => `<tr>
      <td>${v.thumb ? `<img src="${esc(v.thumb)}" width="96" style="border-radius:6px">` : '🎬'}</td>
      <td>${v.mock ? esc(v.title) : `<a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>`}</td>
      <td>${esc(v.channel)}</td><td>${fmt(v.views)}</td><td>${fmt(v.likes)}</td><td class="small">${dt(v.publishedAt).split(',')[0]}</td></tr>`).join('')}
  </table></div>`;
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
        <p>👁 ${fmt(v.views)} views · 👍 ${fmt(v.likes)} · 💬 ${fmt(v.comments)} · ⏱ ${Math.round(v.durationSec / 60)} min</p></div></div></div>
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
        <h3>Trocar senha</h3><div id="pmsg"></div>
        <form id="pf"><label>Senha atual</label><input name="current" type="password" required>
          <label>Nova senha</label><input name="next" type="password" minlength="8" required>
          <p><button class="btn sm">Salvar nova senha</button></p></form></div>
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
  $('#pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try { await api('/me/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } }); $('#pmsg').innerHTML = alertBox('ok', 'Senha alterada.'); ev.target.reset(); }
    catch (e) { showErr($('#pmsg'), e); }
  };
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
      <div class="card"><h3>Privacidade e segurança</h3>
        <p class="muted">Senhas são armazenadas com hash (bcrypt). Permissões, saldos e pagamentos são validados sempre no servidor. O token da extensão equivale a uma senha: não compartilhe.</p></div>
    </div>`;
};

/* ------------------------------ Admin ------------------------------ */
const ADMIN_TABS = [
  ['geral', 'Visão geral'], ['usuarios', 'Usuários'], ['planos', 'Planos'], ['custos', 'Custos'],
  ['pagamentos', 'Pagamentos'], ['config', 'Configurações'], ['admins', 'Administradores'], ['auditoria', 'Auditoria']
];

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
      </section>
      <div class="card"><h3>Status da configuração</h3>
        <p>YouTube API: ${cfgPill(o.config.youtubeApiConfigured, 'configurada', 'pendente')} ·
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
