// Comentario: o site so diz "publicado" depois de confirmar no servidor.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email: 'cm@example.com', password: 'senha12345', name: 'Comenta' } });
  if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'cm@example.com', password: 'senha12345' } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));

  // 1) caminho normal: confirma mesmo
  await p.goto(LOCAL + '/#/avaliacoes');
  await p.waitForSelector('#rvcsave', { timeout: 20000 });
  await p.fill('#rvctxt', 'Comentario que tem de ficar salvo.');
  await p.click('#rvcsave');
  await p.waitForSelector('#rvcmsg .alert', { timeout: 20000 });
  const ok = await p.textContent('#rvcmsg');
  check('diz publicado E confirmado no servidor', /confirmado no servidor/.test(ok), ok);
  check('o campo e limpo so quando confirmou', (await p.inputValue('#rvctxt')) === '');
  check('o comentario aparece na lista', /tem de ficar salvo/.test(await p.textContent('#rvlista')));

  // 2) servidor aceita mas o comentario some: tem de AVISAR e guardar o texto
  // Simula a perda: o POST responde 200 com um id que nunca vai estar na lista.
  let rotaBateu = false;
  await p.route('**/api/comments', async (route) => {
    rotaBateu = true;
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, comentario: { id: 'id-que-nao-existe', comentario: 'x' } }) });
  });
  await p.fill('#rvctxt', 'Comentario que some depois de salvar.');
  await p.click('#rvcsave');
  await p.waitForSelector('#rvcmsg .alert', { timeout: 20000 });
  const ruim = await p.textContent('#rvcmsg');
  check('a simulacao da perda realmente rodou', rotaBateu);
  check('quando o comentario nao volta na lista, o site AVISA em vez de dizer publicado',
    /não voltou na lista/.test(ruim) && !/confirmado no servidor/.test(ruim), ruim);
  check('e nao apaga o texto que a pessoa escreveu', (await p.inputValue('#rvctxt')).includes('some depois'));
  check('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
