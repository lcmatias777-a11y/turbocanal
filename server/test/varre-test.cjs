// Varre TODAS as páginas do site, como visitante e como dono, e reprova
// qualquer erro de JavaScript, página em branco ou "Página não encontrada".
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

const PUBLICAS = ['/', '/#/planos', '/#/ajuda', '/#/extensao', '/#/avaliacoes', '/#/privacidade', '/#/termos', '/#/login', '/#/cadastro', '/#/resultados'];
const PRIVADAS = [
  '/#/dashboard', '/#/historico', '/#/conta', '/#/notificacoes', '/#/canal',
  '/#/ferramentas/palavras', '/#/ferramentas/busca', '/#/ferramentas/video', '/#/ferramentas/canal',
  '/#/ferramentas/tendencias', '/#/ferramentas/ideias', '/#/ferramentas/preparar', '/#/ferramentas/titulo',
  '/#/ferramentas/auditoria', '/#/ferramentas/horarios', '/#/ferramentas/raiox', '/#/ferramentas/experimentos',
  '/#/ferramentas/concorrentes', '/#/ferramentas/criar-capa', '/#/ferramentas/editor', '/#/ferramentas/insights',
  // Paginas que a varredura nunca tinha aberto. Cada uma destas era uma tela
  // que podia estar quebrada sem nenhum teste reclamar.
  '/#/bate-papo', '/#/postagens', '/#/canal-teste', '/#/ferramentas/capa',
  '/#/ferramentas/descricao', '/#/ferramentas/titulos', '/#/ferramentas/transformar',
  // Checkout nos dois periodos: e a tela que fala de dinheiro, e cada periodo
  // monta um texto e um valor diferentes.
  '/#/checkout?plan=free', '/#/checkout?plan=p10&periodo=1m', '/#/checkout?plan=p10&periodo=12m'
];

/** Nenhuma pagina do site pode ficar de fora desta varredura. Sem isto, bastava
 *  eu criar uma tela nova e ela nunca era aberta por teste nenhum. */
const VISTAS_SEM_VARREDURA = new Set(['home', 'sair', 'admin']); // / , logout e o redirecionador
const ADMIN = ['geral', 'usuarios', 'planos', 'custos', 'pagamentos', 'pedidos', 'chats', 'avaliacoes', 'blocos', 'config', 'admins', 'auditoria'].map((t) => `/#/admin/${t}`);

(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const visitar = async (p, url) => {
    const erros = [];
    const onErr = (e) => erros.push(String(e).slice(0, 200));
    const onCon = (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erros.push(m.text().slice(0, 200)); };
    p.on('pageerror', onErr); p.on('console', onCon);
    await p.goto(LOCAL + url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1400);
    const texto = (await p.textContent('#app').catch(() => '')) || '';
    const spinPreso = await p.$$eval('#app .spin', (ns) => ns.length).catch(() => 0);
    // Caixa de erro vermelha na tela. Sem isto a varredura dava a página por
    // boa quando ela abria e mostrava só "u is not defined" dentro de um
    // quadro vermelho: tinha texto, não tinha spinner preso, e o erro era
    // capturado pelo código, então nem aparecia no console.
    const caixasDeErro = await p.$$eval('#app .alert.err', (ns) => ns.map((n) => n.textContent.trim().slice(0, 120))).catch(() => []);
    p.off('pageerror', onErr); p.off('console', onCon);
    return { erros, texto: texto.trim(), spinPreso, caixasDeErro };
  };

  // visitante
  const anon = await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: LOCAL });
  const pa = await anon.newPage();
  for (const url of PUBLICAS) {
    const r = await visitar(pa, url);
    check(`visitante em ${url}`, r.erros.length === 0 && r.texto.length > 20 && !/Página não encontrada/.test(r.texto) && r.caixasDeErro.length === 0,
      `${r.erros.join(' | ')}${r.texto.length <= 20 ? ' (tela vazia)' : ''}${/Página não encontrada/.test(r.texto) ? ' (404)' : ''}${r.caixasDeErro.length ? ' ERRO NA TELA: ' + r.caixasDeErro.join(' / ') : ''}`);
  }

  // dono
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: LOCAL });
  const r0 = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'admin@example.com', password: 'senha12345' } });
  if (!r0.ok()) throw new Error('login do dono: ' + r0.status());
  const p = await ctx.newPage();
  for (const url of [...PRIVADAS, ...ADMIN]) {
    const r = await visitar(p, url);
    check(`dono em ${url}`, r.erros.length === 0 && r.texto.length > 20 && !/Página não encontrada/.test(r.texto) && r.caixasDeErro.length === 0,
      `${r.erros.join(' | ')}${r.texto.length <= 20 ? ' (tela vazia)' : ''}${/Página não encontrada/.test(r.texto) ? ' (404)' : ''}${r.caixasDeErro.length ? ' ERRO NA TELA: ' + r.caixasDeErro.join(' / ') : ''}`);
    if (r.spinPreso) check(`dono em ${url}: nada fica rodando para sempre`, false, `${r.spinPreso} carregando preso`);
  }

  // A conta do periodo tem de CHEGAR na tela, nao so nao dar erro: o anual do
  // Starter e 6 x R$ 10 menos 10% = R$ 54,00, e e esse numero que a pessoa ve
  // antes de pagar.
  {
    const mes = await visitar(p, '/#/checkout?plan=p10&periodo=1m');
    check('checkout de 1 mes mostra R$ 9,99 e fala em 1 mes',
      /R\$\s*9,99/.test(mes.texto) && /1 m[eê]s/.test(mes.texto), mes.texto.replace(/\s+/g, ' ').slice(0, 160));
    const ano = await visitar(p, '/#/checkout?plan=p10&periodo=12m');
    check('checkout de 1 ano mostra R$ 99,00',
      /R\$\s*99,00/.test(ano.texto), ano.texto.replace(/\s+/g, ' ').slice(0, 200));
    check('e o checkout diz que os creditos entram mes a mes',
      /por\s*<?b?>?m[eê]s|por m[eê]s/i.test(ano.texto), ano.texto.replace(/\s+/g, ' ').slice(0, 200));
  }

  // Nenhuma pagina pode ficar de fora: compara a lista varrida com as views do app.js
  {
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../../web/assets/app.js', 'utf8');
    const vistas = new Set();
    for (const m of src.matchAll(/views\[['`]([^'`]+)['`]\]\s*=/g)) vistas.add(m[1]);
    for (const m of src.matchAll(/^views\.([a-zA-Z0-9_]+)\s*=/gm)) vistas.add(m[1]);
    const varridas = new Set([...PUBLICAS, ...PRIVADAS, ...ADMIN].map((u) => u.replace(/^\/#\//, '').replace(/^\/$/, 'home').split('?')[0]));
    const esquecidas = [...vistas].filter((v) => !varridas.has(v) && !VISTAS_SEM_VARREDURA.has(v));
    check('toda página do site está nesta varredura', esquecidas.length === 0, 'fora da varredura: ' + esquecidas.join(', '));
  }

  // endereços inventados devem dar a página de "não encontrada", não tela branca
  const r404 = await visitar(p, '/#/nao-existe-isso');
  check('endereço inventado mostra "Página não encontrada" em vez de tela branca',
    /Página não encontrada/.test(r404.texto) && r404.erros.length === 0, r404.texto.slice(0, 80));

  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
