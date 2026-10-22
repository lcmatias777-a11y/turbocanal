// As telas novas no tamanho de celular: nada pode sobrar para os lados.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'admin@example.com', password: 'senha12345' } });
  if (!r.ok()) throw new Error('login: ' + r.status());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });

  const sobra = () => p.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    culpados: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2)
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`)
  }));

  const telas = [
    ['painel', '/#/dashboard', '#proxAcao'],
    ['notificações', '/#/notificacoes', '#ntpag'],
    ['raio-X', '/#/ferramentas/raiox', '#rxOut'],
    ['melhor horário', '/#/ferramentas/horarios', '#btFuso'],
    ['painel: pedidos', '/#/admin/pedidos', '#atab .card'],
    ['painel: chats', '/#/admin/chats', '.ch-lado']
  ];
  for (const [nome, url, seletor] of telas) {
    await p.goto(LOCAL + url);
    await p.waitForSelector(seletor, { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(900);
    const s = await sobra();
    check(`${nome}: não sobra barra de rolagem horizontal`, s.doc <= s.win + 2, `doc ${s.doc} > janela ${s.win} · ${s.culpados.join(', ')}`);
  }

  // o sino tem de caber e abrir no celular
  await p.goto(LOCAL + '/#/dashboard');
  await p.waitForSelector('#sino', { timeout: 20000 });
  await p.click('#sino');
  await p.waitForSelector('#ntcaixa', { timeout: 20000 });
  const cx = await p.evaluate(() => {
    const e = document.getElementById('ntcaixa').getBoundingClientRect();
    return { dir: e.right, esq: e.left, janela: window.innerWidth };
  });
  check('a caixa de notificações cabe na tela do celular', cx.dir <= cx.janela + 2 && cx.esq >= -2, JSON.stringify(cx));
  await p.screenshot({ path: SHOTS + '/celular-sino.png' });

  await p.goto(LOCAL + '/#/admin/chats');
  await p.waitForSelector('.ch-conv', { timeout: 25000 });
  await p.click('.ch-conv');
  await p.waitForSelector('#chForm', { timeout: 20000 });
  const s2 = await sobra();
  check('chat aberto no celular também não vaza para os lados', s2.doc <= s2.win + 2, `${s2.doc} > ${s2.win} · ${s2.culpados.join(', ')}`);
  await p.screenshot({ path: SHOTS + '/celular-chat.png', fullPage: true });

  check('nenhum erro de JavaScript no celular', erros.length === 0, erros.slice(0, 3).join(' | '));
  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
