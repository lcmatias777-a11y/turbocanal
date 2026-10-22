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
  ['#/ferramentas/auditoria', '🩺 Auditoria do meu canal (IA)'],
  ['#/ferramentas/horarios', '⏰ Melhor horário para publicar'],
  ['#/ferramentas/raiox', '🔬 Raio-X dos meus vídeos'],
  ['#/ferramentas/titulo', '🧲 Laboratório de título'],
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
        ${link('#/avaliacoes', '⭐ Avaliações')}
        ${link('#/ajuda', 'Ajuda')}
        ${isAdmin ? link('#/admin', '🛠 Admin') : ''}
      </div>
      <div class="spacer"></div>
      ${u
        ? `<button class="sino" id="sino" title="Notificações" aria-label="Notificações">🔔<span class="sino-n" id="sinoN" hidden>0</span></button>
           <span class="badge credits" title="Seu saldo de créditos">💎 ${u.unlimited ? 'Ilimitado' : fmt(u.credits)}</span>
           ${u.role !== 'user' ? `<span class="badge role">${u.role === 'owner' ? 'Administrador principal' : 'Administrador'}</span>` : ''}
           <a class="navlink" href="#/conta">⚙️ Conta</a>
           <a class="navlink" href="#/sair">Sair</a>`
        : `<a class="btn sm" href="#/login">Entrar com Google</a>`}
    </div>`;
  montarSino();
}

/* ------------------------------ Notificações ------------------------------ */
const nt = { itens: [], naoLidas: 0, aberto: false, timer: null };

function ntHtml(x) {
  const quando = new Date(x.criado_em);
  const min = Math.round((Date.now() - quando.getTime()) / 60000);
  const idade = min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : quando.toLocaleDateString('pt-BR');
  return `<div class="nt-item ${x.lida ? '' : 'nova'}" data-nt="${esc(x.id)}" data-link="${esc(x.link || '')}">
    <span class="nt-emoji">${esc(x.emoji)}</span>
    <div class="nt-txt"><b>${esc(x.titulo)}</b>${x.corpo ? `<p>${esc(x.corpo)}</p>` : ''}<span class="muted small">${idade}</span></div>
    <button class="nt-x" data-ntdel="${esc(x.id)}" title="Apagar">×</button>
  </div>`;
}

async function carregarNotificacoes() {
  if (!state.user) return;
  try {
    const d = await api('/notifications?limit=20');
    nt.itens = d.itens; nt.naoLidas = d.naoLidas;
    const b = $('#sinoN');
    if (b) { b.textContent = d.naoLidas > 9 ? '9+' : String(d.naoLidas); b.hidden = !d.naoLidas; }
    const cx = $('#ntcaixa');
    if (cx && nt.aberto) pintarCaixa(cx);
  } catch {}
}

function pintarCaixa(cx) {
  cx.innerHTML = `<div class="nt-cab"><b>Notificações</b>${nt.naoLidas ? '<button class="btn sm ghost" id="ntTodas">marcar todas como lidas</button>' : ''}</div>
    <div class="nt-lista">${nt.itens.length ? nt.itens.map(ntHtml).join('') : '<p class="muted" style="padding:14px">Nada por aqui ainda.</p>'}</div>`;
  const todas = $('#ntTodas');
  if (todas) todas.onclick = async (ev) => { ev.stopPropagation(); await api('/notifications/todas-lidas', { method: 'POST' }); await carregarNotificacoes(); };
  for (const el of cx.querySelectorAll('[data-nt]')) el.onclick = async (ev) => {
    if (ev.target.closest('[data-ntdel]')) return;
    try { await api(`/notifications/${el.dataset.nt}/lida`, { method: 'POST' }); } catch {}
    const destino = el.dataset.link;
    fecharSino();
    await carregarNotificacoes();
    if (destino) location.hash = destino.replace(/^#/, '');
  };
  for (const b of cx.querySelectorAll('[data-ntdel]')) b.onclick = async (ev) => {
    ev.stopPropagation();
    try { await api(`/notifications/${b.dataset.ntdel}`, { method: 'DELETE' }); } catch {}
    await carregarNotificacoes();
  };
}

function fecharSino() {
  nt.aberto = false;
  const cx = $('#ntcaixa');
  if (cx) cx.remove();
}

function montarSino() {
  const s = $('#sino');
  if (!s) return;
  s.onclick = (ev) => {
    ev.stopPropagation();
    if (nt.aberto) return fecharSino();
    nt.aberto = true;
    const cx = document.createElement('div');
    cx.id = 'ntcaixa';
    cx.className = 'nt-caixa';
    cx.onclick = (e) => e.stopPropagation();
    document.body.appendChild(cx);
    const r = s.getBoundingClientRect();
    cx.style.top = `${r.bottom + 8}px`;
    cx.style.right = `${Math.max(8, window.innerWidth - r.right - 8)}px`;
    pintarCaixa(cx);
    carregarNotificacoes();
  };
  if (!nt.ligado) {
    nt.ligado = true;
    document.addEventListener('click', () => { if (nt.aberto) fecharSino(); });
    nt.timer = setInterval(carregarNotificacoes, 45000);
    // administrador fica ouvindo chamada em qualquer página do site
    if (['owner', 'admin'].includes(state.user?.role)) {
      nt.ligTimer = setInterval(() => { ligOuvir(); }, lig.estado === 'parado' ? 5000 : 1500);
      ligOuvir();
    }
  }
  carregarNotificacoes();
}

async function refreshMe() {
  try { state.user = (await api('/me')).user; } catch { state.user = null; }
  renderNav();
}

/* ------------------------------ Páginas ------------------------------ */
const views = {};

views.notificacoes = async () => {
  if (!state.user) return needLogin();
  const d = await api('/notifications?limit=50');
  nt.itens = d.itens; nt.naoLidas = d.naoLidas;
  appEl().innerHTML = `<h1>🔔 Notificações</h1>
    <div class="card"><div id="ntpag" class="nt-lista nt-pagina">${d.itens.length ? d.itens.map(ntHtml).join('') : '<p class="muted">Nada por aqui ainda. Avisos sobre créditos, pagamentos e respostas aparecem aqui.</p>'}</div>
      ${d.naoLidas ? '<p style="margin-top:12px"><button class="btn sm secondary" id="ntTodasPag">Marcar todas como lidas</button></p>' : ''}</div>`;
  const t = $('#ntTodasPag');
  if (t) t.onclick = async () => { await api('/notifications/todas-lidas', { method: 'POST' }); await carregarNotificacoes(); views.notificacoes(); };
  for (const el of $('#ntpag').querySelectorAll('[data-nt]')) el.onclick = async (ev) => {
    if (ev.target.closest('[data-ntdel]')) return;
    try { await api(`/notifications/${el.dataset.nt}/lida`, { method: 'POST' }); } catch {}
    await carregarNotificacoes();
    if (el.dataset.link) location.hash = el.dataset.link.replace(/^#/, '');
    else views.notificacoes();
  };
  for (const b of $('#ntpag').querySelectorAll('[data-ntdel]')) b.onclick = async (ev) => {
    ev.stopPropagation();
    try { await api(`/notifications/${b.dataset.ntdel}`, { method: 'DELETE' }); } catch {}
    await carregarNotificacoes(); views.notificacoes();
  };
};


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
    <div data-slot="home-apos-hero" hidden></div>
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
    <div data-slot="home-apos-recursos" hidden></div>
    <p class="center" style="margin-top:18px"><a class="btn ghost" href="#/extensao">🧩 Baixar a extensão para Chrome</a></p>
    <div data-slot="home-antes-avaliacoes" hidden></div>
    <h2 class="center" style="margin-top:34px">Esse site é:</h2>
    <section class="card" id="rvhome"><p class="center"><span class="spin"></span></p></section>
    <p class="center"><a class="btn ghost" href="#/avaliacoes">⭐ Ver e escrever avaliações</a></p>
    <div data-slot="home-antes-planos" hidden></div>
    <h2 class="center" style="margin-top:34px">Planos</h2>
    <p class="center muted small">Créditos renovam todo mês. As comparações de capacidade são metas internas de referência, não números auditados.</p>
    <section class="grid cols3">${plans.map(planCard).join('')}</section>`;
  // o resumo das avaliações vem do banco; se ainda não houver nenhuma, a própria função avisa
  try {
    const r = await api('/reviews/summary');
    const alvo = $('#rvhome');
    if (alvo) alvo.innerHTML = rvResumoHtml(r);
  } catch { const alvo = $('#rvhome'); if (alvo) alvo.innerHTML = '<p class="muted center">Não foi possível carregar as avaliações agora.</p>'; }
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

const ICONE_ACAO = { oportunidade: '🎯', atencao: '⚠️', preparo: '🧭' };

async function carregarProximaAcao() {
  const box = $('#proxAcao');
  if (!box) return;
  let d;
  try { d = await api('/proxima-acao'); }
  catch (e) { box.innerHTML = `<h3>🎯 Sua próxima ação</h3><p class="muted small">${esc(e.message)}</p>`; return; }

  if (d.erro) {
    box.innerHTML = `<h3>🎯 Sua próxima ação</h3><p class="muted">${esc(d.erro)}</p>`;
    return;
  }
  const a = d.acao;
  if (!a) {
    box.innerHTML = `<h3>🎯 Sua próxima ação</h3>
      <p class="muted">Nada de urgente agora. ${d.dispensadas ? `Você dispensou ${d.dispensadas} sugestão(ões); elas voltam em alguns dias.` : 'Quando os seus números mostrarem uma oportunidade, ela aparece aqui.'}</p>`;
    return;
  }
  box.innerHTML = `<div class="prox-cab"><span class="prox-ico">${ICONE_ACAO[a.tipo] || '🎯'}</span>
      <div><span class="muted small">Sua próxima ação${d.total > 1 ? ` · ${d.total} sugestões na fila` : ''}</span>
        <h3 style="margin:2px 0 0">${esc(a.titulo)}</h3></div></div>
    <p>${esc(a.porque)}</p>
    ${a.dado ? `<p class="prox-dado">📊 ${esc(a.dado)}</p>` : ''}
    <div class="prox-acoes">
      <a class="btn sm" href="${esc(a.botao.href)}"${a.botao.externo ? ' rel="noopener"' : ''}>${esc(a.botao.texto)}</a>
      <button class="btn sm ghost" id="proxDisp">dispensar por 14 dias</button>
    </div>`;
  $('#proxDisp').onclick = async () => {
    try { await api('/proxima-acao/dispensar', { method: 'POST', body: { chave: a.chave } }); } catch (e) { alert(e.message); }
    carregarProximaAcao();
  };
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
    <div id="proxAcao" class="card prox"><p class="center"><span class="spin"></span></p></div>
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
  carregarProximaAcao();
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

views['ferramentas/auditoria'] = toolPage({
  title: '🩺 Auditoria do meu canal (IA)', toolKey: 'audit_ai',
  desc: 'A IA olha os seus últimos vídeos públicos (views, likes, comentários, duração, tags, descrição e nota de SEO) e devolve uma nota do canal, o que já está funcionando e 5 melhorias para o próximo vídeo. Cada recomendação vem com o número que a sustenta.',
  formHtml: `<div id="audCanal" class="muted small">Verificando o seu canal…</div>`,
  onMount: async () => {
    const box = $('#audCanal');
    if (!box) return;
    box.innerHTML = state.user?.youtube?.connected
      ? `✅ Vou buscar os últimos vídeos de <b>${esc(state.user.youtube.channel_title || 'seu canal')}</b> direto no YouTube.`
      : 'Para auditar, vincule seu canal primeiro: <a href="/api/auth/google?connect=1">Vincular meu canal</a>.';
  },
  getBody: () => ({}),
  render: (r) => `<div class="card">
      <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap">
        <div class="kpi" style="font-size:2.6rem">${r.nota}<span class="muted" style="font-size:1rem">/100</span></div>
        <div><b>Nota do canal</b><div class="muted small">${esc(r.resumo || '')}</div></div>
      </div>
      <p class="muted small">Base: ${r.base?.videos || 0} vídeos públicos · mediana de ${fmt(r.base?.medianaViews || 0)} views.</p>
    </div>
    <div class="card" style="margin-top:12px"><h3>✅ O que já está funcionando</h3>
      ${(r.funciona || []).map((f) => `<p><b>${esc(f.ponto)}</b><br><span class="muted small">📊 ${esc(f.dado || '')}</span></p>`).join('') || '<p class="muted">—</p>'}</div>
    <div class="card" style="margin-top:12px"><h3>🔧 5 melhorias para o próximo vídeo</h3>
      ${(r.melhorias || []).map((m, i) => `<div class="rv-item"><div class="rv-cab"><span class="pill">${i + 1}</span> <b>${esc(m.titulo)}</b></div>
        <p class="muted small">📊 ${esc(m.dado || '')}</p><p>${esc(m.acao || '')}</p></div>`).join('')}</div>
    <div class="card" style="margin-top:12px"><h3>💡 Próximos vídeos sugeridos</h3>
      ${(r.proximos || []).map((x) => `<p><b>${esc(x.titulo)}</b><br><span class="muted small">${esc(x.porque || '')}</span></p>`).join('') || '<p class="muted">—</p>'}
      <p class="small muted">${esc(r.aviso || '')}</p></div>`
});

views['ferramentas/titulo'] = toolPage({
  title: '🧲 Laboratório de título', toolKey: 'title_lab',
  desc: 'Cola o título que você pensou. A nota sai de critérios medidos aqui (tamanho, número, palavra-chave no começo, caixa alta, promessa e emoji) e a IA escreve 5 alternativas melhores, explicando cada uma.',
  formHtml: `<label>Título que você pensou</label><input name="titulo" required maxlength="200" placeholder="ex.: Transformei FINGERDASH em uma fase IMPOSSÍVEL!">
    <label>Palavra-chave que você quer rankear (opcional)</label><input name="palavra" maxlength="60" placeholder="ex.: geometry dash">`,
  getBody: (fd) => ({ titulo: fd.get('titulo'), palavra: fd.get('palavra'), canal: state.user?.youtube?.channel_title || '' }),
  render: (r) => `<div class="card">
      <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap">
        <div class="kpi" style="font-size:2.6rem">${r.nota}<span class="muted" style="font-size:1rem">/100</span></div>
        <div><b>${esc(r.original)}</b><div class="muted small">${esc(r.diagnostico || '')}</div></div>
      </div>
      ${(r.checagem || []).map((c) => `<div class="small">${c.ok ? '✅' : '⚠️'} ${esc(c.item)}${c.ok ? '' : ` <span class="muted">— ${esc(c.dica)}</span>`}</div>`).join('')}
    </div>
    <div class="card" style="margin-top:12px"><h3>5 alternativas</h3>
      ${(r.alternativas || []).map((a, i) => `<div class="rv-item"><div class="rv-cab"><span class="pill">${i + 1}</span> <b>${esc(a.titulo)}</b> <span class="muted small">${a.titulo.length} caracteres</span></div>
        <p class="muted small">${esc(a.porque || '')}</p>
        <div class="rv-acoes"><button data-copiar="${esc(a.titulo)}">📋 copiar</button></div></div>`).join('')}
      <p class="small muted">${esc(r.aviso || '')}</p></div>`,
  after: (r, out) => {
    for (const b of out.querySelectorAll('[data-copiar]')) b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = '✅ copiado'; } catch { b.textContent = '❌ não deu'; }
    };
  }
});

views['ferramentas/horarios'] = toolPage({
  title: '⏰ Melhor horário para publicar', toolKey: 'best_time',
  desc: 'Sem IA e sem adivinhação: eu pego a data de publicação e as views dos seus vídeos públicos no YouTube e comparo as medianas por dia da semana e por faixa de horário. Se não houver vídeos suficientes para comparar, o resultado diz isso em vez de inventar um horário.',
  formHtml: `<label>Seu fuso horário</label><select name="fuso" id="btFuso"></select>
    <div id="btCanal" class="muted small" style="margin-top:8px">Verificando o seu canal…</div>`,
  onMount: async () => {
    const sel = $('#btFuso');
    if (sel) {
      let aqui = 'America/Sao_Paulo';
      try { aqui = Intl.DateTimeFormat().resolvedOptions().timeZone || aqui; } catch {}
      const zonas = [...new Set([aqui, 'America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'UTC'])];
      sel.innerHTML = zonas.map((z) => `<option value="${esc(z)}"${z === aqui ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}${z === aqui ? ' (o seu)' : ''}</option>`).join('');
    }
    const box = $('#btCanal');
    if (box) {
      box.innerHTML = state.user?.youtube?.connected
        ? `✅ Vou ler os vídeos públicos de <b>${esc(state.user.youtube.channel_title || 'seu canal')}</b> direto no YouTube.`
        : 'Para calcular, vincule seu canal primeiro: <a href="/api/auth/google?connect=1">Vincular meu canal</a>.';
    }
  },
  getBody: (fd) => ({ fuso: fd.get('fuso') }),
  render: (r) => {
    const barras = (grupos, melhorId) => {
      const max = Math.max(1, ...grupos.map((g) => g.mediana));
      return grupos.map((g) => {
        const w = Math.round((g.mediana / max) * 100);
        const cor = !g.videos ? 'var(--line)' : g.suficiente ? (g.id === melhorId ? 'var(--ok)' : 'var(--accent)') : 'var(--line)';
        const nota = !g.videos ? 'nenhum vídeo' : `${fmt(g.mediana)} views · ${g.videos} vídeo${g.videos > 1 ? 's' : ''}${g.suficiente ? '' : ' (pouco para comparar)'}`;
        return `<div class="bt-linha"><span class="bt-nome">${esc(g.nome)}</span>
          <span class="bt-trilho"><span class="bt-barra" style="width:${w}%;background:${cor}"></span></span>
          <span class="bt-val muted small">${nota}</span></div>`;
      }).join('');
    };
    const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
    return `<div class="card">
        <h3>${r.recomendacao ? '⏰ O que os seus próprios números dizem' : '🤔 Ainda não dá para dizer'}</h3>
        <p>${r.recomendacao ? esc(r.recomendacao) : 'Não há vídeos suficientes com views maduras para comparar horários. Publique mais alguns e volte aqui — eu não vou chutar um horário.'}</p>
        <p class="muted small">Base: ${r.base.considerados} vídeo${r.base.considerados === 1 ? '' : 's'} público${r.base.considerados === 1 ? '' : 's'} com mais de ${r.base.diasMaturacao} dias${r.base.considerados ? ` (de ${dataBr(r.base.primeiro)} a ${dataBr(r.base.ultimo)})` : ''} · mediana geral de ${fmt(r.base.medianaGeral)} views · fuso ${esc(r.fuso)}.</p>
      </div>
      <div class="grid cols2" style="margin-top:12px">
        <div class="card"><h3>Por dia da semana</h3>${barras(r.dias, r.melhorDia?.id)}</div>
        <div class="card"><h3>Por faixa de horário</h3>${barras(r.faixas, r.melhorFaixa?.id)}</div>
      </div>
      ${r.piorDia || r.piorFaixa ? `<div class="card" style="margin-top:12px"><h3>O outro lado</h3>
        ${r.piorDia ? `<p>Dia mais fraco: <b>${esc(r.piorDia.nome)}</b> — mediana ${fmt(r.piorDia.mediana)} views em ${r.piorDia.videos} vídeos (${r.piorDia.diferenca >= 0 ? '+' : ''}${r.piorDia.diferenca}% em relação à mediana geral).</p>` : ''}
        ${r.piorFaixa ? `<p>Faixa mais fraca: <b>${esc(r.piorFaixa.nome)}</b> — mediana ${fmt(r.piorFaixa.mediana)} views em ${r.piorFaixa.videos} vídeos (${r.piorFaixa.diferenca >= 0 ? '+' : ''}${r.piorFaixa.diferenca}% em relação à mediana geral).</p>` : ''}</div>` : ''}
      <div class="card" style="margin-top:12px"><h3>Leia antes de mudar sua rotina</h3>
        <ul class="small muted">${(r.avisos || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        <p class="small muted">Um grupo só vira recomendação com no mínimo ${r.base.minAmostra} vídeos. Os que têm menos aparecem em cinza.</p></div>`;
  }
});

views['ferramentas/raiox'] = async (params) => {
  if (!state.user) return needLogin();
  const dias = Math.min(365, Math.max(28, parseInt(params?.get?.('dias'), 10) || 90));
  appEl().innerHTML = `<h1>🔬 Raio-X dos meus vídeos</h1>
    <p class="muted">Duas perguntas que só os seus próprios números respondem: <b>quais vídeos trazem inscrito</b> (e não só view) e <b>que formato prende</b> o público. Os dados vêm do YouTube Analytics do seu canal. Não custa crédito.</p>
    <div class="card"><label for="rxDias">Período</label>
      <select id="rxDias" style="max-width:260px">
        ${[28, 90, 180, 365].map((d) => `<option value="${d}"${d === dias ? ' selected' : ''}>últimos ${d} dias</option>`).join('')}
      </select></div>
    <div id="rxOut" style="margin-top:12px"><p class="center"><span class="spin"></span></p></div>`;
  $('#rxDias').onchange = (ev) => { location.hash = `/ferramentas/raiox?dias=${ev.target.value}`; };

  const out = $('#rxOut');
  let r;
  try { r = await api(`/channel/raiox?dias=${dias}`); }
  catch (e) {
    out.innerHTML = alertBox('warn', esc(e.message)) +
      (state.user?.youtube?.connected ? '' : '<p><a class="btn" href="/api/auth/google?connect=1">Vincular meu canal do YouTube</a></p>');
    return;
  }

  const num = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const tabela = (lista, campo, rotulo, unidade) => lista.length
    ? `<table><tr><th>Vídeo</th><th>${rotulo}</th><th>Views</th></tr>${lista.map((v) => `<tr>
        <td><a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.titulo)}</a></td>
        <td><b>${num(campo(v))}${unidade}</b></td><td>${fmt(v.views)}</td></tr>`).join('')}</table>`
    : '<p class="muted">Sem vídeos suficientes no período.</p>';

  const maxRet = Math.max(1, ...r.faixas.map((f) => f.retencaoMediana));
  out.innerHTML = `
    ${r.conclusoes.length ? `<div class="card"><h3>O que os seus números dizem</h3>
      ${r.conclusoes.map((c) => `<p>• ${esc(c)}</p>`).join('')}</div>` : `<div class="card"><h3>Ainda não dá para concluir</h3>
      <p>Faltam vídeos com views suficientes no período para comparar. Troque o período ou volte depois de publicar mais alguns.</p></div>`}

    <div class="grid cols2" style="margin-top:12px">
      <div class="card"><h3>🧲 Os que mais trazem inscrito</h3>
        <p class="muted small">Inscritos ganhos menos perdidos, por mil views. A mediana do seu canal é ${num(r.base.medianaInscritosPorMil)}.</p>
        ${tabela(r.campeoes, (v) => v.inscritosPorMil, 'por mil views', '')}</div>
      <div class="card"><h3>👀 Muita view, pouco inscrito</h3>
        <p class="muted small">Muita view e inscrito nenhum. Não prova que o público é de fora do nicho, mas é por aqui que eu começaria a olhar.</p>
        ${tabela(r.soView, (v) => v.inscritosPorMil, 'por mil views', '')}</div>
      <div class="card"><h3>⏳ Os que mais prendem</h3>
        <p class="muted small">Percentual médio assistido. A mediana do canal é ${num(r.base.retencaoMediana)}%.${r.temAcimaDeCem ? ' Acima de 100% quer dizer que a mesma pessoa assistiu mais de uma vez (Shorts repetem sozinhos).' : ''}</p>
        ${tabela(r.prendemMais, (v) => Math.round(v.percentualMedio), 'assistido', '%')}</div>
      <div class="card"><h3>💤 Os que menos prendem</h3>
        ${tabela(r.prendemMenos, (v) => Math.round(v.percentualMedio), 'assistido', '%')}</div>
    </div>

    <div class="card" style="margin-top:12px"><h3>Retenção por tamanho de vídeo</h3>
      <p class="muted small">Shorts aparecem separados de propósito: eles rodam em loop, então a retenção deles não dá para comparar com a de vídeo longo.</p>
      ${r.faixas.map((f) => {
        const w = Math.round((f.retencaoMediana / maxRet) * 100);
        const cor = !f.videos ? 'var(--line)' : f.suficiente ? (f.id === r.melhorFaixa?.id ? 'var(--ok)' : f.id === 0 ? 'var(--warn)' : 'var(--accent)') : 'var(--line)';
        return `<div class="bt-linha"><span class="bt-nome">${esc(f.nome)}</span>
          <span class="bt-trilho"><span class="bt-barra" style="width:${w}%;background:${cor}"></span></span>
          <span class="bt-val muted small">${f.videos ? `${num(f.retencaoMediana)}% · ${f.videos} vídeo${f.videos > 1 ? 's' : ''}${f.suficiente ? '' : ' (pouco para comparar)'}` : 'nenhum vídeo'}</span></div>`;
      }).join('')}
      <p class="small muted">Faixa com menos de ${r.base.minGrupo} vídeos aparece em cinza e não vira conclusão.</p></div>

    <div class="card" style="margin-top:12px"><h3>De onde vêm esses números</h3>
      <p class="small muted">${esc(r.canal)} · ${r.periodo.de} a ${r.periodo.ate} · ${r.base.analisados} de ${r.base.total} vídeos entraram na comparação.</p>
      <ul class="small muted">${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
};

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
        <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
        <h3 style="margin-top:0">Segurança</h3>
        <p class="small">O TurboCanal não tem senha própria: quem entra na sua conta do Google entra aqui. Por isso o que mais protege é a <b>verificação em duas etapas</b> na conta Google, em <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">myaccount.google.com/security</a>.</p>
        <p class="small">Se desconfiar que alguém entrou na sua conta, encerre tudo: todos os aparelhos e a extensão caem na hora e precisam entrar de novo.</p>
        <p><button class="btn sm secondary" id="sairTudo">🔒 Sair de todos os aparelhos</button></p>
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
  const st = $('#sairTudo');
  if (st) st.onclick = async () => {
    if (!confirm('Encerrar todas as sessões? Você vai sair daqui também e precisa entrar de novo com o Google. A extensão do Chrome também vai pedir para entrar.')) return;
    st.disabled = true;
    try {
      const r = await api('/me/sair-de-tudo', { method: 'POST' });
      alert(r.aviso || 'Sessões encerradas.');
      state.user = null;
      location.hash = '/';
      location.reload();
    } catch (e) { alert(e.message); st.disabled = false; }
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
/* ---------------------- Ligação de voz entre administradores ----------------------
   O áudio vai DIRETO de um computador para o outro (WebRTC). O servidor só passa
   os recados de conexão. Por isso não custa nada e nada fica gravado.
   Limite honesto: sem servidor TURN (que é pago), algumas redes não deixam a
   conexão direta acontecer. Quando isso ocorre a tela diz exatamente isso. */
const lig = { pc: null, local: null, conversa: null, com: null, comNome: '', estado: 'parado', timer: null, prazo: null, entrando: null };
window.lig = lig; // deixa o estado visível para diagnóstico e para os testes de navegador
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

function ligPainel() {
  let el = $('#ligCaixa');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ligCaixa';
    el.className = 'lig-caixa';
    document.body.appendChild(el);
  }
  return el;
}

function ligFechar(msg) {
  if (lig.timer) { clearInterval(lig.timer); lig.timer = null; }
  if (lig.prazo) { clearTimeout(lig.prazo); lig.prazo = null; }
  try { lig.pc?.close(); } catch {}
  try { lig.local?.getTracks().forEach((t) => t.stop()); } catch {}
  lig.pc = null; lig.local = null; lig.estado = 'parado'; lig.conversa = null; lig.com = null; lig.entrando = null;
  const el = $('#ligCaixa');
  if (!el) return;
  if (msg) {
    el.innerHTML = `<div class="lig-corpo"><b>Ligação encerrada</b><p class="small">${esc(msg)}</p>
      <div class="lig-bts"><button class="btn sm secondary" id="ligOk">Fechar</button></div></div>`;
    $('#ligOk').onclick = () => el.remove();
  } else el.remove();
}

window.ligSinal = ligSinal; window.ligFechar = ligFechar;
async function ligSinal(conversa, para, tipo, dados = {}) {
  try { await api(`/admin/chats/${conversa}/sinal`, { method: 'POST', body: { para, tipo, dados } }); } catch {}
}

function ligDesenhar(texto, botoes = []) {
  const el = ligPainel();
  el.innerHTML = `<div class="lig-corpo"><span class="lig-ico">📞</span>
      <div><b>${esc(lig.comNome || 'Ligação')}</b><p class="small muted" id="ligEstado">${esc(texto)}</p></div>
      <div class="lig-bts">${botoes.map((b) => `<button class="btn sm ${b.cor || 'secondary'}" id="${b.id}">${esc(b.texto)}</button>`).join('')}</div>
    </div><audio id="ligAudio" autoplay></audio>`;
  for (const b of botoes) { const n = $('#' + b.id); if (n) n.onclick = b.acao; }
}

function ligEstado(t) { const e = $('#ligEstado'); if (e) e.textContent = t; }

async function ligCriarPc(conversa, com) {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  lig.pc = pc;
  lig.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  for (const t of lig.local.getTracks()) pc.addTrack(t, lig.local);
  pc.ontrack = (ev) => { const a = $('#ligAudio'); if (a) a.srcObject = ev.streams[0]; };
  pc.onicecandidate = (ev) => { if (ev.candidate) ligSinal(conversa, com, 'ice', { c: ev.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { lig.estado = 'falando'; ligEstado('Conectado. Pode falar.'); if (lig.prazo) { clearTimeout(lig.prazo); lig.prazo = null; } }
    if (pc.connectionState === 'failed') {
      ligSinal(conversa, com, 'falhou', {});
      ligFechar('Não consegui abrir a conexão direta entre os dois computadores. Isso acontece quando as duas redes bloqueiam ligação direta. Para funcionar sempre seria preciso um servidor TURN, que é pago — eu não liguei nada pago sem avisar o custo antes.');
    }
  };
  return pc;
}

async function ligar(conversa, com, nome) {
  if (lig.estado !== 'parado') return alert('Já existe uma ligação em andamento.');
  lig.conversa = conversa; lig.com = com; lig.comNome = nome; lig.estado = 'chamando';
  ligDesenhar('Chamando…', [{ id: 'ligCancel', texto: 'Cancelar', cor: 'secondary', acao: () => { ligSinal(conversa, com, 'desligou', {}); ligFechar(); } }]);
  try {
    const pc = await ligCriarPc(conversa, com);
    await ligSinal(conversa, com, 'chamando', {});
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    await ligSinal(conversa, com, 'oferta', { sdp: pc.localDescription });
    lig.prazo = setTimeout(() => {
      if (lig.estado !== 'falando') ligFechar('Ninguém atendeu, ou a conexão direta não foi possível entre as duas redes.');
    }, 45000);
  } catch (e) {
    ligFechar(/Permission|NotAllowed/i.test(String(e)) ? 'Você precisa permitir o microfone no navegador para ligar.' : `Não deu para ligar: ${e.message || e}`);
  }
}

async function ligAtender(s) {
  lig.conversa = s.conversa; lig.com = s.de; lig.comNome = s.deNome; lig.estado = 'conectando';
  ligDesenhar('Conectando…', [{ id: 'ligFim', texto: 'Desligar', cor: 'secondary', acao: () => { ligSinal(s.conversa, s.de, 'desligou', {}); ligFechar(); } }]);
  try {
    const pc = await ligCriarPc(s.conversa, s.de);
    await pc.setRemoteDescription(new RTCSessionDescription(lig.entrando.dados.sdp));
    const resp = await pc.createAnswer();
    await pc.setLocalDescription(resp);
    await ligSinal(s.conversa, s.de, 'resposta', { sdp: pc.localDescription });
    lig.prazo = setTimeout(() => { if (lig.estado !== 'falando') ligFechar('A conexão direta não foi possível entre as duas redes.'); }, 45000);
  } catch (e) {
    ligFechar(/Permission|NotAllowed/i.test(String(e)) ? 'Você precisa permitir o microfone no navegador para atender.' : `Não deu para atender: ${e.message || e}`);
  }
}

/** Fica de olho em recados de ligação, mesmo com o painel fechado. */
async function ligOuvir() {
  if (!state.user || !['owner', 'admin'].includes(state.user.role)) return;
  let d;
  try { d = await api('/admin/chats/sinais'); } catch { return; }
  for (const s of d.itens) {
    if (s.tipo === 'oferta') {
      if (lig.estado !== 'parado') { await ligSinal(s.conversa, s.de, 'recusou', { motivo: 'ocupado' }); continue; }
      lig.estado = 'tocando'; lig.comNome = s.deNome; lig.entrando = s;
      ligDesenhar('está te ligando', [
        { id: 'ligAceita', texto: '✅ Atender', cor: '', acao: () => ligAtender(s) },
        { id: 'ligRecusa', texto: '❌ Recusar', cor: 'secondary', acao: () => { ligSinal(s.conversa, s.de, 'recusou', {}); ligFechar(); } }
      ]);
    } else if (s.tipo === 'resposta' && lig.pc && !lig.pc.currentRemoteDescription) {
      try { await lig.pc.setRemoteDescription(new RTCSessionDescription(s.dados.sdp)); ligEstado('Conectando…'); } catch {}
    } else if (s.tipo === 'ice' && lig.pc) {
      try { await lig.pc.addIceCandidate(s.dados.c); } catch {}
    } else if (s.tipo === 'recusou') {
      ligFechar(s.dados?.motivo === 'ocupado' ? 'A pessoa está em outra ligação.' : 'A pessoa recusou a ligação.');
    } else if (s.tipo === 'desligou') {
      ligFechar('A outra pessoa desligou.');
    } else if (s.tipo === 'falhou') {
      ligFechar('A conexão direta não foi possível entre as duas redes.');
    }
  }
}

/* ------------------------------ Chat entre administradores ------------------------------ */
const ch = { aberta: null, lista: [], timer: null, arrastando: null };

async function chPintarLista() {
  const alvo = $('#chLista');
  if (!alvo) return;
  const d = await api('/admin/chats');
  ch.lista = d.itens;
  const cartao = (c) => `<div class="ch-conv ${ch.aberta === c.id ? 'on' : ''}" data-conv="${esc(c.id)}" draggable="true">
      <span class="ch-ava">${c.tipo === 'dm' ? '👤' : c.tipo === 'geral' ? '🏛' : '👥'}</span>
      <div class="ch-info"><b>${esc(c.nome)}</b>
        <span class="muted small">${c.ultima ? `${c.ultima.minha ? 'você: ' : ''}${esc(String(c.ultima.texto).slice(0, 40))}` : esc(c.subtitulo)}</span></div>
      ${c.naoLidas ? `<span class="ch-n">${c.naoLidas}</span>` : ''}
      <button class="ch-pin" data-pin="${esc(c.id)}" data-fix="${c.fixado ? 1 : 0}" title="${c.fixado ? 'Tirar dos principais' : 'Deixar nos principais'}">${c.fixado ? '📌' : '📍'}</button>
    </div>`;
  const fix = d.itens.filter((c) => c.fixado), resto = d.itens.filter((c) => !c.fixado);
  alvo.innerHTML = `<div class="ch-sec" id="chFix" data-zona="fix"><span class="ch-sec-t">Principais</span>
      ${fix.length ? fix.map(cartao).join('') : '<p class="muted small ch-vazio">Arraste uma conversa para cá.</p>'}</div>
    <div class="ch-sec" id="chTodos" data-zona="todos"><span class="ch-sec-t">Todas</span>
      ${resto.length ? resto.map(cartao).join('') : '<p class="muted small ch-vazio">Nada aqui.</p>'}</div>
    <div class="ch-sec"><span class="ch-sec-t">Começar conversa</span><div id="chPessoas"><span class="spin"></span></div></div>`;

  for (const el of alvo.querySelectorAll('[data-conv]')) {
    el.onclick = (ev) => { if (!ev.target.closest('[data-pin]')) chAbrir(el.dataset.conv); };
    el.ondragstart = () => { ch.arrastando = el.dataset.conv; };
    el.ondragend = () => { ch.arrastando = null; };
  }
  for (const b of alvo.querySelectorAll('[data-pin]')) b.onclick = async (ev) => {
    ev.stopPropagation();
    await api(`/admin/chats/${b.dataset.pin}/fixar`, { method: 'POST', body: { fixado: b.dataset.fix !== '1' } });
    await chPintarLista();
  };
  for (const z of alvo.querySelectorAll('[data-zona]')) {
    z.ondragover = (ev) => { ev.preventDefault(); z.classList.add('ch-alvo'); };
    z.ondragleave = () => z.classList.remove('ch-alvo');
    z.ondrop = async (ev) => {
      ev.preventDefault(); z.classList.remove('ch-alvo');
      if (!ch.arrastando) return;
      await api(`/admin/chats/${ch.arrastando}/fixar`, { method: 'POST', body: { fixado: z.dataset.zona === 'fix' } });
      ch.arrastando = null;
      await chPintarLista();
    };
  }
  try {
    const p = await api('/admin/chats/pessoas');
    const jaTem = new Set(ch.lista.filter((c) => c.tipo === 'dm').flatMap((c) => c.membros.map((m) => m.id)));
    $('#chPessoas').innerHTML = p.itens.map((x) => `<div class="ch-pessoa" data-dm="${esc(x.id)}">
        <span class="ch-ava">${x.papel === 'owner' ? '👑' : '🛠'}</span>
        <div class="ch-info"><b>${esc(x.nome || x.email)}</b><span class="muted small">${esc(x.email)}${jaTem.has(x.id) ? ' · já tem conversa' : ''}</span></div></div>`).join('')
      || '<p class="muted small">Você é o único administrador por enquanto.</p>';
    for (const el of $('#chPessoas').querySelectorAll('[data-dm]')) el.onclick = async () => {
      const r = await api('/admin/chats/dm', { method: 'POST', body: { com: el.dataset.dm } });
      await chPintarLista();
      await chAbrir(r.conversa);
    };
  } catch {}
}

async function chAbrir(id) {
  ch.aberta = id;
  const c = ch.lista.find((x) => x.id === id);
  const p = $('#chPainel');
  if (!p) return;
  p.innerHTML = `<div class="ch-cab"><b>${esc(c?.nome || 'Conversa')}</b>
      <span class="muted small">${esc(c?.subtitulo || '')}</span>
      <span class="spacer"></span>
      <button class="btn sm ghost" id="chLigar" title="Ligação de voz entre administradores">📞 Ligar</button></div>
    <div class="ch-msgs" id="chMsgs"><span class="spin"></span></div>
    <form class="ch-escrever" id="chForm"><input id="chTxt" maxlength="2000" placeholder="Escreva para ${esc(c?.nome || '')}" autocomplete="off">
      <button class="btn sm" type="submit">Enviar</button></form>`;
  await chMensagens(id);
  $('#chForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const t = $('#chTxt').value.trim();
    if (!t) return;
    $('#chTxt').value = '';
    try { await api(`/admin/chats/${id}/mensagens`, { method: 'POST', body: { texto: t } }); } catch (e) { alert(e.message); }
    await chMensagens(id);
    await chPintarLista();
  };
  $('#chLigar').onclick = () => {
    const outro = c?.tipo === 'dm' ? c.membros.find((m) => m.id !== state.user.id) : null;
    if (!outro) return alert('Por enquanto a ligação funciona só na conversa de um a um. Abra a conversa com a pessoa e ligue de lá.');
    ligar(id, outro.id, outro.nome || outro.email);
  };
  await chPintarLista();
}

async function chMensagens(id, silencioso = false) {
  const box = $('#chMsgs');
  if (!box) return;
  try {
    const d = await api(`/admin/chats/${id}/mensagens?limit=80`);
    const antes = box.scrollHeight - box.scrollTop;
    box.innerHTML = d.itens.map((m) => m.sistema
      ? `<p class="ch-sis">${esc(m.texto)}</p>`
      : `<div class="ch-msg ${m.minha ? 'minha' : ''}" data-msg="${esc(m.id)}">
          <div class="ch-bolha"><span class="ch-autor">${esc(m.autor)}${m.papel === 'owner' ? ' 👑' : ''}</span>
            <p>${esc(m.texto)}</p>
            <span class="ch-hora">${new Date(m.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            ${m.minha || state.user?.role === 'owner' ? `<button class="ch-del" data-msgdel="${esc(m.id)}" title="Apagar">×</button>` : ''}</div>
        </div>`).join('') || '<p class="muted" style="padding:16px">Ainda não tem mensagem aqui. Escreva a primeira.</p>';
    if (!silencioso || antes < 80) box.scrollTop = box.scrollHeight;
    for (const b of box.querySelectorAll('[data-msgdel]')) b.onclick = async () => {
      if (!confirm('Apagar esta mensagem? Some para todo mundo e fica registrado na auditoria.')) return;
      try { await api(`/admin/chats/${id}/mensagens/${b.dataset.msgdel}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
      await chMensagens(id);
    };
  } catch (e) { if (!silencioso) showErr(box, e); }
}

async function chNovoGrupo() {
  const p = await api('/admin/chats/pessoas');
  if (!p.itens.length) return alert('Você é o único administrador: não há com quem montar um grupo.');
  const nome = prompt('Nome do grupo:');
  if (!nome) return;
  const escolha = prompt(`Quem entra? Escreva os números separados por vírgula:\n${p.itens.map((x, i) => `${i + 1}. ${x.email}`).join('\n')}`);
  if (!escolha) return;
  const membros = escolha.split(',').map((x) => p.itens[parseInt(x.trim(), 10) - 1]?.id).filter(Boolean);
  if (!membros.length) return alert('Nenhuma pessoa válida escolhida.');
  try {
    const r = await api('/admin/chats/grupo', { method: 'POST', body: { nome, membros } });
    alert(r.executado ? 'Grupo criado.' : 'Pedido enviado ao administrador principal. O grupo nasce quando ele disser Sim.');
    await chPintarLista();
    await carregarNotificacoes();
  } catch (e) { alert(e.message); }
}

const ADMIN_TABS = [
  ['geral', 'Visão geral'], ['usuarios', 'Usuários'], ['planos', 'Planos'], ['custos', 'Custos'],
  ['pagamentos', 'Pagamentos'], ['pedidos', '🙋 Pedidos'], ['chats', '💬 Chats'], ['avaliacoes', 'Avaliações'], ['blocos', 'Avisos e cards'], ['config', 'Configurações'], ['admins', 'Administradores'], ['auditoria', 'Auditoria']
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
    <div class="tabs">${ADMIN_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'active' : ''}">${l}<span class="aba-n" data-contador="${k}" hidden></span></a>`).join('')}</div>
    <div id="atab"><span class="spin"></span></div>`;
  const el = $('#atab');
  contarPendentes();
  try { await adminTabs[tab]?.(el); } catch (e) { showErr(el, e); }
};

/** Contador nas abas do painel: quantos pedidos esperam resposta e quantas
 *  mensagens de chat ainda não foram lidas. Sem isso o administrador só
 *  descobre abrindo a aba. */
async function contarPendentes() {
  const pinta = (k, n) => {
    const el = document.querySelector(`[data-contador="${k}"]`);
    if (!el) return;
    el.textContent = n > 9 ? '9+' : String(n);
    el.hidden = !n;
  };
  try {
    const p = await api('/admin/pedidos');
    pinta('pedidos', p.sou_dono ? p.pendentes : p.itens.filter((x) => x.status === 'pendente').length);
  } catch { pinta('pedidos', 0); }
  try { pinta('chats', (await api('/admin/chats/novidades')).naoLidas); } catch { pinta('chats', 0); }
}

const adminTabs = {
  // ---------- Pedidos que esperam o Sim do administrador principal ----------
  async pedidos(el) {
    const d = await api('/admin/pedidos');
    const cor = { pendente: 'warn', aprovado: 'ok', recusado: 'err', falhou: 'err' };
    const rot = { pendente: 'esperando você', aprovado: 'aprovado', recusado: 'recusado', falhou: 'aprovado, mas falhou' };
    const linha = (p) => `<div class="rv-item" data-ped="${esc(p.id)}">
      <div class="rv-cab"><span class="pill ${cor[p.status] || ''}">${rot[p.status] || esc(p.status)}</span>
        <b>${esc(p.pedido_por)}</b> quer ${esc(p.frase)}</div>
      ${p.motivo ? `<p class="small">Motivo: ${esc(p.motivo)}</p>` : '<p class="small muted">Sem motivo informado.</p>'}
      <p class="small muted">${new Date(p.criado_em).toLocaleString('pt-BR')}${p.resposta ? ` · sua resposta: "${esc(p.resposta)}"` : ''}${p.erro ? ` · erro: ${esc(p.erro)}` : ''}</p>
      ${d.sou_dono && p.status === 'pendente' ? `<div class="rv-acoes">
        <button class="btn sm" data-sim="${esc(p.id)}">✅ Sim</button>
        <button class="btn sm secondary" data-nao="${esc(p.id)}">❌ Não</button>
        <button class="btn sm ghost" data-papo="${esc(p.pedido_por_id)}">💬 Conversar</button></div>` : ''}
    </div>`;
    const pend = d.itens.filter((p) => p.status === 'pendente');
    const resto = d.itens.filter((p) => p.status !== 'pendente');
    el.innerHTML = `<div class="card">
        <h3>${d.sou_dono ? 'Pedidos esperando você' : 'Pedidos que você mandou'}</h3>
        <p class="muted small">${d.sou_dono
          ? 'Administrador comum não mexe sozinho na conta de ninguém: ajustar créditos, banir, remover comentário, adicionar administrador e criar grupo chegam aqui primeiro. Nada acontece até você dizer Sim.'
          : 'Suas ações que mexem na conta de outras pessoas passam pelo administrador principal. Você vê aqui em que pé estão.'}</p>
        ${pend.length ? pend.map(linha).join('') : '<p class="muted">Nenhum pedido pendente.</p>'}
      </div>
      ${resto.length ? `<div class="card" style="margin-top:12px"><h3>Já decididos</h3>${resto.map(linha).join('')}</div>` : ''}`;
    for (const b of el.querySelectorAll('[data-sim]')) b.onclick = async () => {
      const resposta = prompt('Quer deixar um recado junto do Sim? (pode deixar em branco)') ?? '';
      b.disabled = true;
      try { await api(`/admin/pedidos/${b.dataset.sim}/decidir`, { method: 'POST', body: { decisao: 'sim', resposta } }); await carregarNotificacoes(); adminTabs.pedidos(el); }
      catch (e) { alert(e.message); b.disabled = false; }
    };
    for (const b of el.querySelectorAll('[data-nao]')) b.onclick = async () => {
      const resposta = prompt('Por que não? (a pessoa recebe esse texto)') ?? '';
      b.disabled = true;
      try { await api(`/admin/pedidos/${b.dataset.nao}/decidir`, { method: 'POST', body: { decisao: 'nao', resposta } }); await carregarNotificacoes(); adminTabs.pedidos(el); }
      catch (e) { alert(e.message); b.disabled = false; }
    };
    for (const b of el.querySelectorAll('[data-papo]')) b.onclick = async () => {
      try { const r = await api('/admin/chats/dm', { method: 'POST', body: { com: b.dataset.papo } }); ch.aberta = r.conversa; location.hash = '/admin/chats'; }
      catch (e) { alert(e.message); }
    };
  },

  // ---------- Chats entre administradores ----------
  async chats(el) {
    el.innerHTML = `<div class="ch-tela">
        <aside class="ch-lado"><div class="ch-topo"><b>Conversas</b><button class="btn sm ghost" id="chNovo">+ grupo</button></div>
          <div id="chLista"><span class="spin"></span></div></aside>
        <section class="ch-painel" id="chPainel"><p class="muted" style="padding:20px">Escolha uma conversa à esquerda.</p></section>
      </div>`;
    await chPintarLista();
    $('#chNovo').onclick = chNovoGrupo;
    if (ch.aberta) await chAbrir(ch.aberta);
    if (ch.timer) clearInterval(ch.timer);
    ch.timer = setInterval(async () => {
      if (!location.hash.startsWith('#/admin/chats')) { clearInterval(ch.timer); ch.timer = null; return; }
      await chPintarLista();
      if (ch.aberta) await chMensagens(ch.aberta, true);
    }, 8000);
  },

  async blocos(el) {
    const d = await api('/admin/blocks');
    const nomeSlot = (id) => d.slots.find((x) => x.id === id)?.nome || id;
    const nomePag = (id) => d.paginas.find((x) => x.id === id)?.nome || id;
    const porLugar = {};
    for (const b of d.itens) (porLugar[b.pagina + '|' + b.slot] ||= []).push(b);
    const opts = (lista, atual) => lista.map((o) => `<option value="${esc(o.id)}" ${o.id === atual ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
    const form = (b) => `
      <div class="card" id="blform" data-id="${esc(b.id || '')}">
        <h3>${b.id ? 'Editar' : 'Novo'} ${b.tipo === 'card' ? 'card' : 'aviso'}</h3>
        <div class="grid cols2">
          <div><label>Tipo</label>
            <select id="b_tipo">${opts([{ id: 'aviso', nome: 'Aviso (faixa com título e texto)' }, { id: 'card', nome: 'Card (bloquinho com link)' }], b.tipo)}</select></div>
          <div><label>Estilo (cor da borda)</label>
            <select id="b_estilo">${opts([{ id: 'info', nome: 'Informação (amarelo)' }, { id: 'aviso', nome: 'Atenção' }, { id: 'ok', nome: 'Tudo certo (verde)' }, { id: 'destaque', nome: 'Destaque (laranja)' }], b.estilo || 'info')}</select></div>
          <div><label>Página</label><select id="b_pagina">${opts(d.paginas, b.pagina || 'home')}</select></div>
          <div><label>Posição na página</label><select id="b_slot">${opts(d.slots, b.slot || 'topo')}</select></div>
        </div>
        <label>Título (é o que a pessoa lê)</label><input id="b_titulo" maxlength="120" value="${esc(b.titulo || '')}">
        <label>Texto</label><textarea id="b_texto" maxlength="600">${esc(b.texto || '')}</textarea>
        <div class="grid cols2">
          <div><label>Emoji (opcional)</label><input id="b_emoji" maxlength="8" value="${esc(b.emoji || '')}" placeholder="⚠️"></div>
          <div><label>Imagem (endereço, opcional)</label><input id="b_img" value="${esc(b.imagem_url || '')}" placeholder="https://..."></div>
          <div><label>Link (opcional)</label><input id="b_link" value="${esc(b.link_url || '')}" placeholder="https://..."></div>
          <div><label>Texto do botão</label><input id="b_linktxt" maxlength="40" value="${esc(b.link_texto || '')}" placeholder="Acessar"></div>
        </div>
        <p class="small"><label style="display:inline"><input type="checkbox" id="b_mostrarurl" style="width:auto" ${b.mostrar_url ? 'checked' : ''}> Mostrar o endereço do link na tela (por padrão aparece só o nome)</label></p>
        <p class="small"><label style="display:inline"><input type="checkbox" id="b_pub" style="width:auto" ${b.publicado === false ? '' : 'checked'}> Publicado (desmarque para deixar oculto)</label></p>
        <p><button class="btn sm" id="b_salvar">${b.id ? 'Salvar alterações' : 'Criar'}</button>
           <button class="btn sm secondary" id="b_cancelar">Cancelar</button></p>
        <div id="b_msg"></div>
        <h4>Prévia</h4><div class="bl-previa" id="b_previa"></div>
      </div>`;

    el.innerHTML = `
      <p><button class="btn sm" data-novo="aviso">➕ Novo aviso</button>
         <button class="btn sm secondary" data-novo="card">➕ Novo card</button>
         <a class="btn sm secondary" href="#/" target="_blank">Ver a página inicial</a></p>
      <p class="muted small">Os avisos e cards ficam salvos no banco: continuam depois de recarregar e de reiniciar o site. Use ↑ e ↓ para mudar a ordem dentro da mesma posição.</p>
      <div id="blform-area"></div>
      ${Object.keys(porLugar).length === 0 ? '<div class="card"><p class="muted">Nenhum aviso ou card criado ainda.</p></div>' : ''}
      ${Object.entries(porLugar).map(([chave, lista]) => {
        const [pag, slot] = chave.split('|');
        return `<div class="card" style="margin-top:12px"><h3>${esc(nomePag(pag))} · ${esc(nomeSlot(slot))}</h3>
          ${lista.map((b, i) => `<div class="rv-item">
            <div class="rv-cab">
              <span class="rv-autor">${b.emoji ? esc(b.emoji) + ' ' : ''}${esc(b.titulo || '(sem título)')}</span>
              <span class="pill">${b.tipo === 'card' ? 'card' : 'aviso'}</span>
              <span class="pill ${b.publicado ? 'ok' : 'warn'}">${b.publicado ? 'publicado' : 'oculto'}</span>
              ${b.link_url ? '<span class="muted small">com link</span>' : ''}
            </div>
            ${b.texto ? `<p class="muted small">${esc(b.texto.slice(0, 160))}</p>` : ''}
            <div class="rv-acoes">
              <button data-mover="cima" data-id="${esc(b.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-mover="baixo" data-id="${esc(b.id)}" ${i === lista.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-editar="${esc(b.id)}">✏️ Editar</button>
              <button data-pub="${esc(b.id)}" data-valor="${b.publicado ? '0' : '1'}">${b.publicado ? '🙈 Ocultar' : '👁 Publicar'}</button>
              <button data-excluir="${esc(b.id)}">🗑 Excluir</button>
            </div></div>`).join('')}
        </div>`;
      }).join('')}`;

    const abrirForm = (b) => {
      $('#blform-area').innerHTML = form(b);
      const previa = () => {
        $('#b_previa').innerHTML = blocoHtml({
          tipo: $('#b_tipo').value, estilo: $('#b_estilo').value, titulo: $('#b_titulo').value,
          texto: $('#b_texto').value, emoji: $('#b_emoji').value, imagem_url: $('#b_img').value,
          link_url: $('#b_link').value, link_texto: $('#b_linktxt').value, mostrar_url: $('#b_mostrarurl').checked
        });
      };
      $('#blform').querySelectorAll('input, textarea, select').forEach((c) => { c.oninput = previa; c.onchange = previa; });
      previa();
      $('#b_cancelar').onclick = () => { $('#blform-area').innerHTML = ''; };
      $('#b_salvar').onclick = async () => {
        const corpo = {
          tipo: $('#b_tipo').value, pagina: $('#b_pagina').value, slot: $('#b_slot').value,
          titulo: $('#b_titulo').value, texto: $('#b_texto').value, emoji: $('#b_emoji').value,
          imagem_url: $('#b_img').value, link_url: $('#b_link').value, link_texto: $('#b_linktxt').value,
          mostrar_url: $('#b_mostrarurl').checked, estilo: $('#b_estilo').value, publicado: $('#b_pub').checked
        };
        try {
          const id = $('#blform').dataset.id;
          if (id) await api('/admin/blocks/' + id, { method: 'PUT', body: corpo });
          else await api('/admin/blocks', { method: 'POST', body: corpo });
          blocos.carregado = null;
          await adminTabs.blocos(el);
        } catch (e) { showErr($('#b_msg'), e); }
      };
    };

    el.onclick = async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.novo) return abrirForm({ tipo: b.dataset.novo, pagina: 'home', slot: b.dataset.novo === 'card' ? 'lateral-direita' : 'topo', publicado: true });
        if (b.dataset.editar) return abrirForm(d.itens.find((x) => x.id === b.dataset.editar));
        if (b.dataset.mover) await api(`/admin/blocks/${b.dataset.id}/move`, { method: 'POST', body: { direcao: b.dataset.mover } });
        else if (b.dataset.pub) {
          const alvo = d.itens.find((x) => x.id === b.dataset.pub);
          await api('/admin/blocks/' + alvo.id, { method: 'PUT', body: { ...alvo, publicado: b.dataset.valor === '1' } });
        } else if (b.dataset.excluir) {
          if (!confirm('Excluir este item? Isso não apaga mais nada do site.')) return;
          await api('/admin/blocks/' + b.dataset.excluir, { method: 'DELETE' });
        } else return;
        blocos.carregado = null;
        await adminTabs.blocos(el);
      } catch (e) { alert(e.message); }
    };
  },

  async avaliacoes(el) {
    const [den, lista] = await Promise.all([api('/admin/reviews/reports'), api('/reviews?sort=recentes&limit=50')]);
    const acoes = (tipo, id, ativo) => `<button class="btn sm ${ativo ? 'secondary' : ''}" data-mod="${tipo}" data-id="${id}" data-remover="${ativo ? '1' : '0'}">${ativo ? 'Remover' : 'Restaurar'}</button>`;
    el.innerHTML = `
      <div class="card"><h3>Denúncias abertas (${den.itens.length})</h3>
        ${den.itens.length ? den.itens.map((d) => `<div class="rv-item">
            <div class="rv-cab"><span class="rv-autor">${esc(d.alvo?.autor || '—')}</span>
              <span class="muted small">${d.tipo === 'review' ? 'avaliação' : 'resposta'} · denunciada por ${esc(d.denunciante || '—')} · ${dt(d.criado_em)}</span></div>
            <p>${esc(d.alvo?.texto || '(conteúdo apagado)')}</p>
            <p class="muted small">Motivo: ${esc(d.motivo || '(não informado)')}</p>
            <div class="rv-acoes">${acoes(d.tipo, d.alvo_id, true)}</div>
          </div>`).join('') : '<p class="muted">Nenhuma denúncia aberta.</p>'}
      </div>
      <div class="card" style="margin-top:14px"><h3>Tudo o que está publicado (${lista.total})</h3>
        <p class="muted small">Média ${String(lista.resumo.media.toFixed(1)).replace('.', ',')} · ${fmt(lista.total)} avaliações. Remover tira da média na hora.</p>
        ${lista.itens.map((i) => `<div class="rv-item">
            <div class="rv-cab"><span class="rv-autor">${esc(i.autor)}</span>${i.doDesenvolvedor ? '<span class="rv-selo">Desenvolvedor</span>' : i.daEquipe ? '<span class="rv-selo equipe">Equipe</span>' : ''}${i.tipo === 'avaliacao' ? `<span class="rv-estrelas">${estrelasTxt(i.estrelas)}</span>` : '<span class="pill">comentário</span>'}
              <span class="muted small">${dt(i.criado_em)} · 👍 ${fmt(i.gostei)} 👎 ${fmt(i.naoGostei)}</span></div>
            <p>${esc(i.comentario || '(sem comentário)')}</p>
            <div class="rv-acoes">${acoes(i.tipo, i.id, true)}</div>
          </div>`).join('') || '<p class="muted">Nenhuma avaliação ainda.</p>'}
      </div>
      <div id="amodmsg"></div>`;
    el.onclick = async (ev) => {
      const b = ev.target.closest('[data-mod]');
      if (!b) return;
      const motivo = prompt(b.dataset.remover === '1' ? 'Motivo da remoção (fica na auditoria):' : 'Motivo da restauração:') ?? null;
      if (motivo === null) return;
      b.disabled = true;
      try {
        await api('/admin/moderate', { method: 'POST', body: { alvo_tipo: b.dataset.mod, alvo_id: b.dataset.id, remover: b.dataset.remover === '1', motivo } });
        await adminTabs.avaliacoes(el);
      } catch (e) { showErr($('#amodmsg'), e); b.disabled = false; }
    };
  },

  async geral(el) {
    const o = await api('/admin/overview');
    el.innerHTML = `
      <section class="grid cols3">
        <div class="card"><h3>Usuários</h3><div class="kpi">${fmt(o.users)}</div>
          <p class="muted small">${o.byPlan.map((p) => `${esc(p.plan_id)}: ${p.n}`).join(' · ')}</p></div>
        <div class="card"><h3>Créditos gastos em ferramentas (30 dias)</h3><div class="kpi">${fmt(o.creditsSpent30d)}</div>
          <p class="muted small">Só uso de ferramenta: é o indicador de custo operacional das APIs.${o.creditsAdjusted30d ? ` Fora isso, ${fmt(o.creditsAdjusted30d)} crédito(s) foram retirados por ajuste manual, que não gasta API nenhuma.` : ''}</p></div>
        <div class="card"><h3>Pagamentos aprovados</h3><div class="kpi">${money(o.payments.approvedTotalCents)}</div>
          <p class="muted small">${o.payments.approvedCount} pagamentos confirmados.</p></div>
        <div class="card"><h3>Cota do YouTube hoje</h3><div class="kpi">${fmt(o.youtubeQuota?.usedToday || 0)} <small class="muted">/ ${fmt(o.youtubeQuota?.dailyLimit || 10000)}</small></div>
          <p class="muted small">Compartilhada por todo o site. Busca = 100 unidades, postar vídeo = 1.600, capa ou edição = 50, leitura = 1. Renova por volta das 4h ou 5h. Quando o site crescer, peça aumento gratuito ao Google no <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">formulário de cota da API do YouTube</a>.</p></div>
      </section>
      <div class="card"><h3>O que já está pronto e o que falta</h3><div id="achk"><span class="spin"></span></div></div>
      <div class="card scroll"><h3>Uso por ferramenta (30 dias)</h3>
        ${o.usage30d.length ? `<table><tr><th>Ferramenta</th><th>Usos</th></tr>${o.usage30d.map((u) => `<tr><td>${esc(u.tool)}</td><td>${u.n}</td></tr>`).join('')}</table>` : '<p class="muted">Sem uso ainda.</p>'}</div>`;
    try {
      const c = await api('/admin/checklist');
      $('#achk').innerHTML = `<p>${c.prontos} de ${c.total} prontos.${c.bloqueios.length ? ` <b class="warn">Bloqueia o site:</b> ${c.bloqueios.map(esc).join(', ')}.` : c.faltando ? ' Nada bloqueia o site, mas ainda falta configurar o de baixo.' : ' Está tudo configurado.'}</p>
        ${c.itens.map((i) => `<div class="rv-item"><div class="rv-cab">${i.ok ? '✅' : i.critico ? '⛔' : '⚠️'} <b>${esc(i.titulo)}</b>
          <span class="muted small">— ${esc(i.estado)}</span></div>
          ${i.resolver ? `<p class="small">👉 ${esc(i.resolver)}</p>` : ''}</div>`).join('')}
        <p class="small muted">Nenhuma chave aparece aqui, só se está preenchida ou não.</p>`;
    } catch (e) { showErr($('#achk'), e); }
  },

  async usuarios(el) {
    const load = async (q = '') => {
      const r = await api('/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      $('#ulist').innerHTML = `<table><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Plano</th><th>Créditos</th><th>Ações</th></tr>
        ${r.items.map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.name || '')}</td><td>${esc(u.role)}</td><td>${esc(u.plan_id)}</td>
          <td>${u.role === 'owner' ? '∞' : fmt(u.credits)}</td>
          <td class="small"><button class="btn sm ghost" data-cr="${u.id}">± créditos</button>
            ${state.user?.role === 'owner' ? `<button class="btn sm ghost" data-sess="${u.id}" title="Derruba todos os acessos desta conta agora">🔒 encerrar sessões</button>` : ''}
            <button class="btn sm ghost" data-ban="${u.id}" data-banido="${u.banido ? 1 : 0}">${u.banido ? '♻️ tirar banimento' : '🚫 banir'}</button></td></tr>`).join('')}</table>`;
      for (const b of el.querySelectorAll('[data-sess]')) b.onclick = async () => {
        if (!confirm('Derrubar todos os acessos desta conta agora? A pessoa precisa entrar de novo com o Google.')) return;
        try { await api(`/admin/users/${b.dataset.sess}/encerrar-sessoes`, { method: 'POST' }); alert('Acessos encerrados.'); }
        catch (e) { alert(e.message); }
      };
      for (const b of el.querySelectorAll('[data-ban]')) b.onclick = async () => {
        const desfazer = b.dataset.banido === '1';
        const motivo = desfazer ? '' : (prompt('Motivo do banimento (a pessoa vê isso ao tentar entrar):') ?? '');
        if (!desfazer && motivo === null) return;
        try {
          const r = await api(`/admin/users/${b.dataset.ban}/banir`, { method: 'POST', body: { desfazer, motivo } });
          alert(r.executado ? (desfazer ? 'Banimento retirado.' : 'Conta banida.') : 'Pedido enviado ao administrador principal.');
          await carregarNotificacoes(); load($('#uq').value);
        } catch (e) { alert(e.message); }
      };
      for (const b of el.querySelectorAll('[data-cr]')) b.onclick = async () => {
        const delta = parseInt(prompt('Ajuste de créditos (ex.: 500 ou -200):'), 10);
        if (!delta) return;
        const note = prompt('Motivo do ajuste (fica na auditoria):') || '';
        try {
          const r = await api(`/admin/users/${b.dataset.cr}/credits`, { method: 'POST', body: { delta, note } });
          if (!r.executado) alert('Pedido enviado ao administrador principal. Os créditos só mudam depois do Sim dele.');
          await carregarNotificacoes(); load($('#uq').value);
        } catch (e) { alert(e.message); }
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
      <div class="card"><h3>Backup do banco</h3><div id="bkp"><span class="spin"></span></div>
        <p class="small muted">O Postgres gratuito do Render expira em 19/11/2026. Baixe uma cópia de vez em quando: o arquivo traz usuários, créditos, histórico, pagamentos, avaliações e os avisos. Chaves de API e senhas <b>não</b> vão no arquivo.</p>
        <p><a class="btn sm" href="/api/admin/backup" download>⬇️ Baixar backup agora</a></p></div>
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
    (async () => {
      const el = $('#bkp');
      if (!el) return;
      try {
        const b = await api('/admin/backup/resumo');
        const linhas = Object.entries(b.resumo).filter(([, n]) => n > 0).map(([t, n]) => `${esc(t)}: ${fmt(n)}`).join(' · ');
        el.innerHTML = `<p><b>${fmt(b.total)}</b> linhas no banco agora.<br><span class="muted small">${linhas || 'banco vazio'}</span></p>
          <p class="small ${b.ultimo_backup ? 'muted' : ''}">${b.ultimo_backup ? 'Último backup: ' + dt(b.ultimo_backup) : '⚠️ Você ainda não baixou nenhum backup.'}</p>`;
      } catch (e) { el.innerHTML = alertBox('warn', esc(e.message)); }
    })();
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


/* ------------------------------ Avaliações do site ------------------------------ */
const estrelasTxt = (n) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));
const rv = { ordem: 'recentes', pagina: 1, paginas: 1, itens: [], minha: null, nota: 0 };

function rvResumoHtml(r) {
  if (!r || !r.total) {
    return `<div class="rv-vazio"><p class="muted">Este site ainda não recebeu avaliações. Seja o primeiro a avaliar!</p></div>`;
  }
  return `<div class="rv-topo">
      <div class="rv-media">
        <div class="rv-nota">${String(r.media.toFixed(1)).replace('.', ',')}</div>
        <div class="rv-estrelas big">${estrelasTxt(Math.round(r.media))}</div>
        <div class="muted small">${fmt(r.total)} ${r.total === 1 ? 'avaliação' : 'avaliações'}${r.comentarios ? ` · ${fmt(r.comentarios)} ${r.comentarios === 1 ? 'comentário' : 'comentários'}` : ''}</div>
      </div>
      <div class="rv-barras">
        ${[5, 4, 3, 2, 1].map((e) => `<div class="rv-linha"><span>${e}</span>
            <span class="rv-trilho"><span class="rv-cheio" style="width:${r.percentuais[e]}%"></span></span>
            <span class="muted">${fmt(r.distribuicao[e])}</span></div>`).join('')}
      </div>
    </div>`;
}

const rvSelo = (a) => (a.doDesenvolvedor ? '<span class="rv-selo">Resposta do desenvolvedor</span>'
  : a.daEquipe ? '<span class="rv-selo equipe">Resposta da equipe</span>' : '');

function rvRespostaHtml(a) {
  return `<div class="rv-resp ${a.doDesenvolvedor ? 'dev' : a.daEquipe ? 'equipe' : ''}">
      <div class="rv-cab"><span class="rv-autor">${esc(a.autor)}</span>${rvSelo(a)}
        <span class="muted small">${dt(a.criado_em)}</span></div>
      <div>${esc(a.texto)}</div>
      <div class="rv-acoes">
        <button data-voto="resposta" data-id="${a.id}" data-valor="1" class="${a.meuVoto === 1 ? 'on' : ''}">👍 ${fmt(a.gostei)}</button>
        <button data-voto="resposta" data-id="${a.id}" data-valor="-1" class="${a.meuVoto === -1 ? 'on' : ''}">👎 ${fmt(a.naoGostei)}</button>
        ${a.minha ? `<button data-apagar-resp="${a.id}">apagar</button>` : `<button data-denuncia="resposta" data-id="${a.id}">denunciar</button>`}
      </div>
    </div>`;
}

function rvItemHtml(it) {
  const ehAvaliacao = it.tipo === 'avaliacao';
  return `<article class="rv-item" data-item="${it.id}" data-tipo="${it.tipo}">
      <div class="rv-cab">
        <span class="rv-autor">${esc(it.autor)}</span>${it.doDesenvolvedor ? '<span class="rv-selo">Desenvolvedor</span>' : it.daEquipe ? '<span class="rv-selo equipe">Equipe</span>' : ''}
        ${ehAvaliacao ? `<span class="rv-estrelas">${estrelasTxt(it.estrelas)}</span>` : '<span class="pill">comentário</span>'}
        <span class="muted small">${dt(it.criado_em)}${it.editado_em ? ' · editado' : ''}${it.minha ? ' · seu' : ''}</span>
      </div>
      ${it.comentario ? `<p>${esc(it.comentario)}</p>` : '<p class="muted small">(sem comentário)</p>'}
      <div class="rv-acoes">
        <button data-voto="${it.tipo}" data-id="${it.id}" data-valor="1" class="${it.meuVoto === 1 ? 'on' : ''}">👍 ${fmt(it.gostei)}</button>
        <button data-voto="${it.tipo}" data-id="${it.id}" data-valor="-1" class="${it.meuVoto === -1 ? 'on' : ''}">👎 ${fmt(it.naoGostei)}</button>
        <button data-responder="${it.id}" data-tipo="${it.tipo}">💬 Responder</button>
        ${it.minha
          ? (ehAvaliacao ? '' : `<button data-apagar-coment="${it.id}">apagar</button>`)
          : `<button data-denuncia="${it.tipo}" data-id="${it.id}">denunciar</button>`}
      </div>
      <div class="rv-respostas" ${it.respostas.length ? '' : 'hidden'}>${it.respostas.map(rvRespostaHtml).join('')}</div>
      <div class="rv-caixa" data-caixa="${it.id}" hidden>
        <textarea placeholder="Escreva sua resposta" maxlength="1000"></textarea>
        <p><button class="btn sm" data-enviar-resp="${it.id}" data-tipo="${it.tipo}">Enviar resposta</button></p>
      </div>
    </article>`;
}

function rvFormHtml() {
  if (!state.user) return `<p class="muted">Entre com o Google para avaliar ou comentar. Nada disso gasta créditos.</p><p><a class="btn sm" href="#/login">Entrar com Google</a></p>`;
  const nota = rv.nota || rv.minha?.estrelas || 0;
  return `<div class="rv-pick" id="rvpick">${[1, 2, 3, 4, 5].map((e) =>
      `<button type="button" data-nota="${e}" class="${e <= nota ? 'on' : ''}" title="${e} estrela${e === 1 ? '' : 's'}">★</button>`).join('')}</div>
    <p class="small muted">Clique nas estrelas e, se quiser, escreva junto. Você tem uma avaliação, que pode editar quando quiser.</p>
    <textarea id="rvtxt" maxlength="1000" placeholder="O que você achou do site? (opcional)">${esc(rv.minha?.comentario || '')}</textarea>
    <p><button class="btn sm" id="rvsave">${rv.minha ? 'Atualizar minha avaliação' : 'Enviar avaliação'}</button>
      ${rv.minha ? '<button class="btn sm secondary" id="rvdel">Apagar</button>' : ''}</p>
    <div id="rvmsg"></div>`;
}

function rvComentarioFormHtml() {
  if (!state.user) return '';
  return `<p class="small muted">Sem nota, só o que você quer dizer. Pode escrever quantos quiser.</p>
    <textarea id="rvctxt" maxlength="1000" placeholder="Escreva um comentário sobre o site"></textarea>
    <p><button class="btn sm" id="rvcsave">Comentar</button></p><div id="rvcmsg"></div>`;
}

async function rvCarregar(reset = true) {
  if (reset) { rv.pagina = 1; rv.itens = []; }
  const d = await api(`/reviews?sort=${rv.ordem}&page=${rv.pagina}&limit=10`);
  rv.paginas = d.paginas;
  rv.itens = reset ? d.itens : rv.itens.concat(d.itens);
  const resumoEl = $('#rvresumo'), listaEl = $('#rvlista'), maisEl = $('#rvmais');
  if (resumoEl) resumoEl.innerHTML = rvResumoHtml(d.resumo);
  if (listaEl) listaEl.innerHTML = rv.itens.map(rvItemHtml).join('') || '<p class="muted">Nenhum comentário ainda.</p>';
  if (maisEl) maisEl.innerHTML = rv.pagina < rv.paginas ? '<button class="btn sm secondary" id="rvmaisbtn">Carregar mais</button>' : '';
}

views.avaliacoes = async () => {
  if (state.user) {
    try { rv.minha = (await api('/reviews/mine')).avaliacao; } catch { rv.minha = null; }
    rv.nota = rv.minha?.estrelas || 0;
  } else { rv.minha = null; rv.nota = 0; }
  appEl().innerHTML = `
    <h1>Avaliações e comentários sobre o site</h1>
    <div class="card"><h3>Esse site é:</h3><div id="rvresumo"><p class="center"><span class="spin"></span></p></div></div>
    <div class="grid cols2" style="margin-top:14px">
      <div class="card"><h3>${rv.minha ? '⭐ Sua avaliação' : '⭐ Avaliar o site'}</h3>${rvFormHtml()}</div>
      ${state.user ? `<div class="card"><h3>💬 Escrever um comentário</h3>${rvComentarioFormHtml()}</div>` : ''}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">Avaliações e comentários</h3>
        <div><label class="small muted" for="rvordem">Ordenar: </label>
          <select id="rvordem" style="width:auto;min-width:170px;display:inline-block"><option value="recentes">Mais recentes</option><option value="melhores">Melhor avaliação</option></select></div>
      </div>
      <div id="rvlista"><p class="center"><span class="spin"></span></p></div>
      <p id="rvmais" class="center"></p>
    </div>`;
  $('#rvordem').value = rv.ordem;
  $('#rvordem').onchange = async (ev) => { rv.ordem = ev.target.value; await rvCarregar(true); };
  await rvCarregar(true);

  const pick = $('#rvpick');
  if (pick) pick.onclick = (ev) => {
    const b = ev.target.closest('[data-nota]');
    if (!b) return;
    rv.nota = +b.dataset.nota;
    [...pick.children].forEach((x) => x.classList.toggle('on', +x.dataset.nota <= rv.nota));
  };
  const salvar = $('#rvsave');
  if (salvar) salvar.onclick = async () => {
    if (!rv.nota) { $('#rvmsg').innerHTML = alertBox('warn', 'Clique numa estrela para dar a nota. Se não quiser dar nota, use "Escrever um comentário" ao lado.'); return; }
    salvar.disabled = true;
    try {
      const r = await api('/reviews', { method: 'POST', body: { estrelas: rv.nota, comentario: $('#rvtxt').value } });
      rv.minha = r.avaliacao;
      $('#rvmsg').innerHTML = alertBox('ok', `Avaliação salva: <b>${estrelasTxt(r.avaliacao.estrelas)}</b>${r.avaliacao.comentario ? ' — ' + esc(r.avaliacao.comentario) : ''}`);
      await rvCarregar(true);
    } catch (e) { showErr($('#rvmsg'), e); }
    salvar.disabled = false;
  };
  const comentar = $('#rvcsave');
  if (comentar) comentar.onclick = async () => {
    const texto = $('#rvctxt').value.trim();
    if (!texto) { $('#rvcmsg').innerHTML = alertBox('warn', 'Escreva alguma coisa antes de enviar.'); return; }
    comentar.disabled = true;
    try {
      const salvo = await api('/comments', { method: 'POST', body: { texto } });
      rv.ordem = 'recentes';
      $('#rvordem').value = 'recentes';
      await rvCarregar(true);
      // Confere no servidor que o comentário está mesmo na lista. Se não estiver,
      // diz isso e devolve o texto, em vez de dizer "publicado" e o texto sumir.
      const achou = rv.itens.some((x) => x.id === salvo.comentario?.id);
      if (achou) {
        $('#rvctxt').value = '';
        $('#rvcmsg').innerHTML = alertBox('ok', 'Comentário publicado e confirmado no servidor.');
      } else {
        $('#rvcmsg').innerHTML = alertBox('err', 'O servidor aceitou, mas o comentário não voltou na lista. Não apaguei o seu texto: copie antes de tentar de novo e me avise, porque isso é um problema de verdade.');
      }
    } catch (e) { showErr($('#rvcmsg'), e); }
    comentar.disabled = false;
  };
  const apagar = $('#rvdel');
  if (apagar) apagar.onclick = async () => {
    apagar.disabled = true;
    try { await api('/reviews/mine', { method: 'DELETE' }); rv.minha = null; rv.nota = 0; await views.avaliacoes(); }
    catch (e) { showErr($('#rvmsg'), e); apagar.disabled = false; }
  };

  $('#rvlista').onclick = async (ev) => {
    const alvo = ev.target.closest('button');
    if (!alvo) return;
    if (!state.user) { alert('Entre com o Google para participar.'); return; }
    try {
      if (alvo.dataset.voto) {
        const valor = alvo.classList.contains('on') ? 0 : +alvo.dataset.valor;
        await api('/votes', { method: 'POST', body: { alvo_tipo: alvo.dataset.voto, alvo_id: alvo.dataset.id, valor } });
        await rvCarregar(true);
      } else if (alvo.dataset.responder) {
        const caixa = $(`[data-caixa="${alvo.dataset.responder}"]`);
        caixa.hidden = !caixa.hidden;
        if (!caixa.hidden) caixa.querySelector('textarea').focus();
      } else if (alvo.dataset.enviarResp) {
        const caixa = $(`[data-caixa="${alvo.dataset.enviarResp}"]`);
        const texto = caixa.querySelector('textarea').value.trim();
        if (!texto) return;
        await api('/replies', { method: 'POST', body: { alvo_tipo: alvo.dataset.tipo, alvo_id: alvo.dataset.enviarResp, texto } });
        await rvCarregar(true);
      } else if (alvo.dataset.apagarResp) {
        await api(`/replies/${alvo.dataset.apagarResp}`, { method: 'DELETE' });
        await rvCarregar(true);
      } else if (alvo.dataset.apagarComent) {
        await api(`/comments/${alvo.dataset.apagarComent}`, { method: 'DELETE' });
        await rvCarregar(true);
      } else if (alvo.dataset.denuncia) {
        const motivo = prompt('O que há de errado neste conteúdo? (opcional)') ?? null;
        if (motivo === null) return;
        const r = await api('/reports', { method: 'POST', body: { alvo_tipo: alvo.dataset.denuncia, alvo_id: alvo.dataset.id, motivo } });
        alert(r.repetida ? 'Você já tinha denunciado este conteúdo.' : 'Denúncia enviada para os administradores. Obrigado.');
      }
    } catch (e) { alert(e.message); }
  };
  $('#rvmais').onclick = async (ev) => {
    if (!ev.target.closest('#rvmaisbtn')) return;
    rv.pagina += 1;
    await rvCarregar(false);
  };
};

/* ---------------- Avisos e cards criados pelo administrador ---------------- */
const blocos = { pagina: null, itens: [] };
const linkSeguro = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

function blocoHtml(b) {
  const emoji = b.emoji ? `<span class="bl-emoji">${esc(b.emoji)}</span>` : '';
  const href = linkSeguro(b.link_url);
  if (b.tipo === 'card') {
    const img = b.imagem_url ? `<img src="${esc(linkSeguro(b.imagem_url))}" alt="" loading="lazy">` : emoji;
    const cta = href ? `<span class="bl-cta">${esc(b.link_texto || 'Acessar')} →</span>` : '';
    const sub = b.texto ? `<small>${esc(b.texto)}</small>` : '';
    const endereco = b.mostrar_url && href ? `<small class="muted">${esc(href)}</small>` : '';
    const miolo = `${img}<div><b>${esc(b.titulo)}</b>${sub}${endereco}</div>${cta}`;
    return href
      ? `<a class="bl-card" href="${esc(href)}" target="_blank" rel="noopener nofollow">${miolo}</a>`
      : `<div class="bl-card">${miolo}</div>`;
  }
  const botao = href ? `<p><a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener nofollow">${esc(b.link_texto || 'Saiba mais')}</a></p>` : '';
  const img = b.imagem_url ? `<img src="${esc(linkSeguro(b.imagem_url))}" alt="" loading="lazy">` : '';
  return `<div class="bl-aviso e-${esc(b.estilo)}">
      ${b.titulo ? `<h4>${b.emoji ? esc(b.emoji) + ' ' : ''}${esc(b.titulo)}</h4>` : ''}
      ${b.texto ? `<p>${esc(b.texto)}</p>` : ''}${img}${botao}
    </div>`;
}

async function carregarBlocos(pagina) {
  if (blocos.pagina === pagina && blocos.itens.length !== undefined && blocos.carregado === pagina) return;
  try { blocos.itens = (await api('/blocks?pagina=' + encodeURIComponent(pagina))).itens; }
  catch { blocos.itens = []; }
  blocos.pagina = pagina; blocos.carregado = pagina;
}

/** Preenche todo elemento com data-slot que exista na tela agora.
 *  "Começo" e "fim" do conteúdo valem para qualquer página, então são criados aqui. */
function aplicarBlocos() {
  const app = appEl();
  if (app) {
    for (const [slot, onde] of [['pagina-topo', 'prepend'], ['pagina-fim', 'append']]) {
      if (!blocos.itens.some((b) => b.slot === slot)) continue;
      if (app.querySelector(`[data-slot="${slot}"]`)) continue;
      const d = document.createElement('div');
      d.dataset.slot = slot;
      app[onde](d);
    }
  }
  for (const el of document.querySelectorAll('[data-slot]')) {
    const itens = blocos.itens.filter((b) => b.slot === el.dataset.slot);
    el.innerHTML = itens.map(blocoHtml).join('');
    el.hidden = itens.length === 0;
  }
}

/* ------------------------------ Router ------------------------------ */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || '';
  const [pathPart, queryPart] = hash.split('?');
  const params = new URLSearchParams(queryPart || '');
  const segs = pathPart.split('/').filter(Boolean);
  renderNav();
  appEl().innerHTML = '<p class="center"><span class="spin"></span></p>';
  const paginaBloco = { extensao: 'ajuda', checkout: 'planos', historico: 'dashboard', conta: 'dashboard' }[segs[0]] || segs[0] || 'home';
  await carregarBlocos(paginaBloco);
  try {
    if (!segs.length) { await views.home(params); return aplicarBlocos(); }
    if (segs[0] === 'admin') { await views.admin(params, segs[1]); return aplicarBlocos(); }
    if (segs[0] === 'canal') { await views.canal(params, segs[1]); return aplicarBlocos(); }
    if (segs[0] === 'ferramentas' && views['ferramentas/' + segs[1]]) { await views['ferramentas/' + segs[1]](params); return aplicarBlocos(); }
    if (views[segs[0]]) { await views[segs[0]](params); return aplicarBlocos(); }
    appEl().innerHTML = alertBox('err', 'Página não encontrada.') + '<p><a class="btn" href="#/">Voltar ao início</a></p>';
    aplicarBlocos();
  } catch (e) {
    appEl().innerHTML = alertBox('err', esc(e.message || 'Erro inesperado.'));
    aplicarBlocos();
  }
}

window.addEventListener('hashchange', route);

(async function boot() {
  try { state.pub = await api('/settings/public'); } catch {}
  try { state.costs = (await api('/tools/costs')).costs; } catch {}
  await refreshMe();
  route();
})();
