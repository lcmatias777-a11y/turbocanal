const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
const ACAO = { acao: { chave: 'continuacao_c0', tipo: 'oportunidade', titulo: 'Faça uma continuação de “Como vencer no bedwars”',
  porque: 'Esse vídeo converte espectador em inscrito muito acima do resto do canal. Assunto que faz isso costuma repetir.',
  dado: '20 inscritos por mil views, contra 2 na mediana dos seus 9 vídeos comparados.',
  botao: { texto: 'Ver o raio-X dos meus vídeos', href: '#/ferramentas/raiox' } }, total: 3, dispensadas: 0, canalLigado: true };
(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1340, height: 900 }, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email: 'pa@example.com', password: 'senha12345', name: 'PA' } });
  if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'pa@example.com', password: 'senha12345' } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/api/proxima-acao', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ACAO) }));
  await p.goto(LOCAL + '/#/dashboard');
  await p.waitForSelector('.prox-dado', { timeout: 20000 });
  const t = await p.textContent('#proxAcao');
  console.log('TEM TITULO:', /continuação/.test(t), '| TEM DADO:', /20 inscritos por mil/.test(t), '| TEM FILA:', /3 sugestões/.test(t), '| TEM DISPENSAR:', (await p.$('#proxDisp')) !== null);
  console.log('ERROS JS:', erros.length ? erros.join(' | ') : 'nenhum');
  await p.screenshot({ path: SHOTS + '/proxima-acao.png' });
  await b.close();
})();
