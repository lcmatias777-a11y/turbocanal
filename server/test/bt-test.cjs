// "Melhor horário para publicar" no navegador de verdade: a página desenha as barras,
// mostra a recomendação com a base, e quando não há amostra NÃO inventa horário.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const FAIXAS = ['00h–03h', '03h–06h', '06h–09h', '09h–12h', '12h–15h', '15h–18h', '18h–21h', '21h–00h'];
const grupo = (id, nome, videos, med) => ({ id, nome, videos, mediana: med, suficiente: videos >= 3, diferenca: 0 });

const CHEIO = {
  fuso: 'America/Sao_Paulo',
  base: { considerados: 11, ignoradosNovos: 1, ignoradosSemData: 0, diasMaturacao: 21, medianaGeral: 1005, minAmostra: 3, primeiro: '2026-01-03T22:00:00.000Z', ultimo: '2026-02-10T10:00:00.000Z' },
  dias: DIAS.map((n, i) => grupo(i, n, i === 6 ? 5 : i === 2 ? 6 : 0, i === 6 ? 10002 : i === 2 ? 1002 : 0)),
  faixas: FAIXAS.map((n, i) => grupo(i, n, i === 6 ? 5 : i === 2 ? 6 : 0, i === 6 ? 10002 : i === 2 ? 1002 : 0)),
  melhorDia: grupo(6, 'sábado', 5, 10002),
  melhorFaixa: grupo(6, '18h–21h', 5, 10002),
  piorDia: grupo(2, 'terça-feira', 6, 1002),
  piorFaixa: grupo(2, '06h–09h', 6, 1002),
  combinacao: { dia: 6, faixa: 6, nome: 'sábado, 18h–21h', videos: 5, mediana: 10002, diferenca: 896 },
  recomendacao: 'No seu canal, os vídeos publicados sábado, 18h–21h têm mediana de 10.002 views (+896% em relação à mediana geral), com base em 5 vídeo(s).',
  avisos: ['A API do YouTube informa a hora em que o vídeo foi publicado, não a hora em que as pessoas assistiram.', '1 vídeo(s) publicado(s) nos últimos 21 dias ficaram de fora.']
};
const VAZIO = {
  fuso: 'America/Sao_Paulo',
  base: { considerados: 0, ignoradosNovos: 1, ignoradosSemData: 0, diasMaturacao: 21, medianaGeral: 0, minAmostra: 3, primeiro: null, ultimo: null },
  dias: DIAS.map((n, i) => grupo(i, n, 0, 0)),
  faixas: FAIXAS.map((n, i) => grupo(i, n, 0, 0)),
  melhorDia: null, melhorFaixa: null, piorDia: null, piorFaixa: null, combinacao: null, recomendacao: null,
  avisos: ['Com 0 vídeo(s) maduro(s) isto ainda é fraco. O número começa a ficar confiável com uns 20.']
};

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email: 'bt.joao@example.com', password: 'senha12345', name: 'João' } });
  if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'bt.joao@example.com', password: 'senha12345' } });
  if (!r.ok()) throw new Error('login falhou: ' + r.status());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });

  let payload = CHEIO;
  await p.route('**/api/tools/best_time', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, tool: 'best_time', result: payload, credits: { cost: 10, charged: 10, balance: 4990 } })
  }));

  await p.goto(LOCAL + '/#/ferramentas/horarios');
  await p.waitForSelector('#btFuso', { timeout: 20000 });
  const linkMenu = await p.textContent('body');
  check('a ferramenta aparece no menu do painel', /Melhor horário para publicar/.test(linkMenu));
  check('o seletor de fuso vem preenchido e com o fuso do navegador marcado',
    (await p.$$eval('#btFuso option', (os) => os.length)) >= 3 && /o seu/.test(await p.textContent('#btFuso')), await p.textContent('#btFuso'));
  check('a descrição diz que é conta sobre dado real, não IA', /sem adivinhação|Sem IA/.test(linkMenu));

  await p.click('form button[type="submit"], form button:not([type])');
  await p.waitForSelector('.bt-linha', { timeout: 20000 });
  const txt = await p.textContent('body');
  check('mostra a recomendação com mediana, diferença e quantos vídeos', /sábado, 18h–21h/.test(txt) && /10\.002 views/.test(txt) && /5 vídeo/.test(txt));
  check('mostra a base: quantos vídeos, de quando a quando e a mediana geral',
    /11 vídeos públicos com mais de 21 dias/.test(txt) && /03\/01\/2026/.test(txt) && /1\.005 views/.test(txt), txt.slice(txt.indexOf('Base:'), txt.indexOf('Base:') + 180));
  check('desenha 7 barras de dia + 8 de faixa', (await p.$$('.bt-linha')).length === 15, String((await p.$$('.bt-linha')).length));
  const cores = await p.$$eval('.bt-barra', (bs) => bs.map((b) => b.style.background));
  check('o melhor grupo sai em verde e os sem amostra em cinza',
    cores.filter((c) => /--ok/.test(c)).length === 2 && cores.filter((c) => /--line/.test(c)).length === 11, JSON.stringify(cores.slice(0, 8)));
  check('a barra do melhor dia vai até 100%', (await p.$$eval('.bt-barra', (bs) => bs.map((b) => b.style.width))).includes('100%'));
  check('mostra também o dia e a faixa mais fracos', /terça-feira/.test(txt) && /06h–09h/.test(txt) && /mais fraco/.test(txt));
  check('mostra os avisos sobre o que o número não prova', /não a hora em que as pessoas assistiram/.test(txt) && /no mínimo 3 vídeos/.test(txt));
  await p.screenshot({ path: process.argv[3] + '/horarios-cheio.png', fullPage: true });

  // Canal sem amostra: tem de admitir, não chutar
  payload = VAZIO;
  await p.reload();
  await p.waitForSelector('#btFuso', { timeout: 20000 });
  await p.click('form button[type="submit"], form button:not([type])');
  await p.waitForSelector('.bt-linha', { timeout: 20000 });
  const txt2 = await p.textContent('body');
  check('sem amostra: diz que não dá para dizer e não chuta horário',
    /Ainda não dá para dizer/.test(txt2) && /não vou chutar/.test(txt2) && !/sábado, 18h/.test(txt2), txt2.slice(0, 0) || '');
  check('sem amostra: nenhuma barra fica colorida', (await p.$$eval('.bt-barra', (bs) => bs.every((b) => /--line/.test(b.style.background)))) === true);
  check('sem amostra: não mostra o bloco "o outro lado"', !/mais fraco/.test(txt2));
  await p.screenshot({ path: process.argv[3] + '/horarios-vazio.png', fullPage: true });

  check('nenhum erro de JavaScript na página', erros.length === 0, erros.join(' | '));
  await browser.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
