// Raio-X no navegador: a página desenha, e quando não há canal ligado ela diz isso
// em vez de mostrar número inventado.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

const FAKE = {
  canal: 'Canal do Teste', periodo: { de: '2026-07-24', ate: '2026-10-21', dias: 90 },
  base: { analisados: 9, total: 10, medianaInscritosPorMil: 2, retencaoMediana: 35, minGrupo: 3 },
  campeoes: [{ id: 'c0', titulo: 'Curto que converte', views: 1000, inscritosPorMil: 20, percentualMedio: 80 }],
  soView: [{ id: 'viral', titulo: 'Viral fora do nicho', views: 90000, inscritosPorMil: 0, percentualMedio: 10 }],
  prendemMais: [{ id: 'c0', titulo: 'Curto que converte', views: 1000, inscritosPorMil: 20, percentualMedio: 80 }],
  prendemMenos: [{ id: 'viral', titulo: 'Viral fora do nicho', views: 90000, inscritosPorMil: 0, percentualMedio: 10 }],
  faixas: [
    { id: 0, nome: 'até 1 min (Shorts)', videos: 4, retencaoMediana: 80, suficiente: true },
    { id: 1, nome: '1 a 5 min', videos: 0, retencaoMediana: 0, suficiente: false },
    { id: 2, nome: '5 a 10 min', videos: 1, retencaoMediana: 50, suficiente: false },
    { id: 3, nome: '10 a 20 min', videos: 0, retencaoMediana: 0, suficiente: false },
    { id: 4, nome: 'mais de 20 min', videos: 5, retencaoMediana: 20, suficiente: true }
  ],
  melhorFaixa: { id: 0, nome: 'até 1 min (Shorts)', videos: 4, retencaoMediana: 80 },
  piorFaixa: { id: 4, nome: 'mais de 20 min', videos: 5, retencaoMediana: 20 },
  conclusoes: ['“Curto que converte” é o que mais converte: 20 inscritos por mil views, contra 2 na mediana do canal.',
    'Seus vídeos de até 1 min (Shorts) seguram 80% do público, contra 20% nos de mais de 20 min (4 e 5 vídeos).'],
  avisos: ['Tudo aqui vem do YouTube Analytics do seu próprio canal, no período escolhido.',
    'CTR e impressões não aparecem porque a API de Analytics do YouTube não entrega esses dois para canais comuns — só o Studio mostra.']
};

(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1340, height: 1000 }, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email: 'rx@example.com', password: 'senha12345', name: 'RX' } });
  if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'rx@example.com', password: 'senha12345' } });
  if (!r.ok()) throw new Error('login: ' + r.status());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });

  // 1) sem canal ligado: mostra o aviso, sem número nenhum
  await p.goto(LOCAL + '/#/ferramentas/raiox');
  await p.waitForSelector('#rxOut .alert, #rxOut .card', { timeout: 20000 });
  const semCanal = await p.textContent('#rxOut');
  check('sem canal ligado, avisa de verdade e não inventa número', /canal/i.test(semCanal) && !/80%/.test(semCanal), semCanal.slice(0, 140));

  // 2) com dados: desenha tudo
  await p.route('**/api/channel/raiox*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE) }));
  await p.reload();
  await p.waitForSelector('.bt-linha', { timeout: 20000 });
  const t = await p.textContent('#rxOut');
  check('mostra as conclusões com o número que as sustenta', /20 inscritos por mil views/.test(t) && /80% do público/.test(t));
  check('lista os que mais trazem inscrito', /Curto que converte/.test(t));
  check('separa o que traz view e não traz inscrito', /Viral fora do nicho/.test(t) && /Muita view, pouco inscrito/.test(t));
  check('desenha a retenção por tamanho de vídeo', (await p.$$('.bt-linha')).length === 5);
  const cores = await p.$$eval('.bt-barra', (bs) => bs.map((x) => x.style.background));
  check('a melhor faixa sai em verde e as sem amostra em cinza',
    cores.filter((c) => /--ok/.test(c)).length === 1 && cores.filter((c) => /--line/.test(c)).length === 3, JSON.stringify(cores));
  check('diz de onde vem o número e o período', /Canal do Teste/.test(t) && /2026-07-24/.test(t) && /9 de 10 vídeos/.test(t));
  check('avisa que CTR não existe, em vez de mostrar um campo vazio', /CTR e impressões não aparecem/.test(t));
  check('os títulos linkam para o vídeo no YouTube', (await p.$$eval('#rxOut a[href*="youtube.com/watch"]', (as) => as.length)) >= 2);
  await p.screenshot({ path: SHOTS + '/raiox.png', fullPage: true });
  check('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
