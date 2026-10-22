// Varre TODAS as páginas do site, como visitante e como dono, e reprova
// qualquer erro de JavaScript, página em branco ou "Página não encontrada".
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

const PUBLICAS = ['/', '/#/planos', '/#/ajuda', '/#/extensao', '/#/avaliacoes', '/#/privacidade', '/#/termos', '/#/login'];
const PRIVADAS = [
  '/#/dashboard', '/#/historico', '/#/conta', '/#/notificacoes', '/#/canal',
  '/#/ferramentas/palavras', '/#/ferramentas/busca', '/#/ferramentas/video', '/#/ferramentas/canal',
  '/#/ferramentas/tendencias', '/#/ferramentas/ideias', '/#/ferramentas/preparar', '/#/ferramentas/titulo',
  '/#/ferramentas/auditoria', '/#/ferramentas/horarios', '/#/ferramentas/raiox', '/#/ferramentas/experimentos',
  '/#/ferramentas/concorrentes', '/#/ferramentas/criar-capa', '/#/ferramentas/editor', '/#/ferramentas/insights'
];
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

  // endereços inventados devem dar a página de "não encontrada", não tela branca
  const r404 = await visitar(p, '/#/nao-existe-isso');
  check('endereço inventado mostra "Página não encontrada" em vez de tela branca',
    /Página não encontrada/.test(r404.texto) && r404.erros.length === 0, r404.texto.slice(0, 80));

  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
