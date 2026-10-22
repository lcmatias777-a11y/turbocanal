// Canal de teste pela TELA: a faixa de aviso aparece e some na hora certa, as
// ferramentas respondem com os dados simulados, e o que é compartilhado entre
// administradores aparece compartilhado mesmo.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const conta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error('login ' + email + ': ' + r.status());
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.accept());
    p.on('pageerror', (e) => erros.push(email + ': ' + e));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erros.push(email + ': ' + m.text()); });
    return { ctx, p };
  };

  const dono = await conta('admin@example.com', 'Admin do Site');
  const pessoa = await conta('pessoa@example.com', 'Pessoa Comum');

  // 1) desligado: nada de faixa
  await pessoa.p.goto(LOCAL + '/#/canal-teste');
  await pessoa.p.waitForSelector('#ctLigar', { timeout: 20000 });
  check('a página explica que o canal não existe no YouTube',
    /não existe no YouTube/i.test(await pessoa.p.textContent('#app')));
  check('mostra o tamanho do canal de teste', /1\.000 vídeos/.test(await pessoa.p.textContent('#app')));
  check('com o modo desligado não existe faixa de aviso', !(await pessoa.p.$('#faixaTeste')));
  check('e avisa ao usuário comum que o canal de teste é só dele',
    /só seu/i.test(await pessoa.p.textContent('#app')));

  // 2) ligar
  await pessoa.p.click('#ctLigar');
  await pessoa.p.waitForSelector('#faixaTeste', { timeout: 15000 });
  const faixa = await pessoa.p.textContent('#faixaTeste');
  check('ligou e a faixa de aviso aparece no topo', /inventados/i.test(faixa), faixa.replace(/\s+/g, ' ').slice(0, 90));
  check('a faixa tem atalho para desligar', !!(await pessoa.p.$('#faixaTeste a[href="#/canal-teste"]')));

  // 3) as ferramentas respondem com o canal simulado
  await pessoa.p.goto(LOCAL + '/#/canal');
  // Checar só o texto "simulado" não basta: o selo aparece no título mesmo
  // quando a lista de vídeos quebra logo abaixo. Foi assim que um "u is not
  // defined" passou batido por este teste. Agora o teste exige os CARTÕES.
  let abriu = true;
  try {
    await pessoa.p.waitForSelector('.thumbrow img', { timeout: 25000 });
  } catch { abriu = false; }
  check('"Meu canal" abre e LISTA os vídeos do canal de teste', abriu,
    abriu ? '' : (await pessoa.p.textContent('#app')).replace(/\s+/g, ' ').slice(0, 180));
  const cartoes = await pessoa.p.$$eval('.thumbrow img', (ns) => ns.length).catch(() => 0);
  check('vêm vários vídeos, cada um com capa carregada', cartoes >= 3, String(cartoes));
  const capaOk = await pessoa.p.$$eval('.thumbrow img', (ns) => ns.filter((i) => i.naturalWidth > 0).length).catch(() => 0);
  check('as capas carregam de verdade (nada de quadrado quebrado)', capaOk >= 3, String(capaOk));
  check('o nome do canal aparece com o selo de simulado',
    /Pixel Arena/.test(await pessoa.p.textContent('#app')) && /simulado/i.test(await pessoa.p.textContent('#app')));
  const erroNaTela = await pessoa.p.$$eval('.alert.err, .alert-err', (ns) => ns.map((n) => n.textContent.trim())).catch(() => []);
  check('e NENHUMA caixa de erro vermelha na tela', erroNaTela.length === 0, erroNaTela.join(' | ').slice(0, 120));
  check('a faixa continua visível nas outras páginas', !!(await pessoa.p.$('#faixaTeste')));

  await pessoa.p.goto(LOCAL + '/#/dashboard');
  await pessoa.p.waitForTimeout(4000);
  const painel = await pessoa.p.textContent('#app');
  check('o painel para de mandar vincular canal e já dá uma recomendação',
    !/Vincule seu canal do YouTube/i.test(painel), painel.replace(/\s+/g, ' ').slice(0, 140));

  // 4) administrador: o canal de teste é compartilhado
  await dono.p.goto(LOCAL + '/#/canal-teste');
  await dono.p.waitForSelector('#ctLigar', { timeout: 20000 });
  check('ao administrador a tela diz que o canal de teste é compartilhado com os outros admins',
    /MESMO/.test(await dono.p.textContent('#app')));

  // 5) desligar tira a faixa na hora
  await pessoa.p.goto(LOCAL + '/#/canal-teste');
  await pessoa.p.waitForSelector('#ctLigar', { timeout: 20000 });
  await pessoa.p.click('#ctLigar');
  await pessoa.p.waitForFunction(() => !document.querySelector('#faixaTeste'), null, { timeout: 15000 })
    .then(() => check('desligou e a faixa some na hora', true))
    .catch(() => check('desligou e a faixa some na hora', false));

  // 6) celular
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pc = await cel.newPage();
  await pc.goto(LOCAL + '/#/canal-teste');
  await pc.waitForTimeout(3000);
  const estouro = await pc.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no celular a página não sobra rolagem lateral', estouro <= 1, String(estouro));

  const graves = erros.filter((e) => !/net::|favicon|404|409/.test(e));
  check('nenhum erro de JavaScript', graves.length === 0, graves.slice(0, 2).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
