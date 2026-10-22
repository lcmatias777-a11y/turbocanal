const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
(async () => {
  const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 }, baseURL: LOCAL });
  let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email: 'exp@example.com', password: 'senha12345', name: 'Exp' } });
  if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email: 'exp@example.com', password: 'senha12345' } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });

  await p.goto(LOCAL + '/#/ferramentas/experimentos');
  await p.waitForSelector('#expForm', { timeout: 20000 });
  check('a pagina diz que antes e depois nao e prova', /não é prova/.test(await p.textContent('body')));
  check('comeca sem experimento nenhum', /Nenhum experimento ainda/.test(await p.textContent('body')));

  await p.fill('[name="hipotese"]', 'Shorts de bedwars trazem mais inscrito');
  await p.fill('[name="mudanca"]', 'postar 3 shorts de bedwars por semana');
  await p.selectOption('[name="metrica"]', 'inscritos');
  await p.click('#expForm button[type="submit"]');
  await p.waitForSelector('#expMsg .alert.ok', { timeout: 20000 });
  check('salva e diz quando vai avisar', /em 21 dias/.test(await p.textContent('#expMsg')), await p.textContent('#expMsg'));
  await p.waitForSelector('[data-exp]', { timeout: 20000 });
  const t = await p.textContent('body');
  check('o experimento aparece na lista com hipotese, mudanca e metrica',
    /Shorts de bedwars trazem mais inscrito/.test(t) && /3 shorts de bedwars/.test(t) && /Inscritos por mil views/.test(t));
  check('mostra que esta rodando e a data de revisao', /rodando/.test(t) && /revisar em/.test(t));
  await p.screenshot({ path: SHOTS + '/experimentos.png', fullPage: true });

  // medir com dados simulados
  await p.route('**/api/experimentos/*/medir', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ leitura: 'Inscritos por mil views: 2 antes contra 7 depois (+250%), em 5 e 4 vídeos. A diferença continua no mesmo sentido mesmo tirando o vídeo mais extremo.',
      aviso: 'Isto é antes e depois, não é prova. 4 vídeo(s) não provam que a sua mudança causou a diferença.' }) }));
  await p.click('[data-medir]');
  await p.waitForSelector('.prox-dado', { timeout: 20000 });
  check('ao medir, mostra o antes e depois com os numeros', /2 antes contra 7 depois/.test(await p.textContent('body')));
  check('e repete o aviso de que nao prova causa', /não provam que a sua mudança causou/.test(await p.textContent('body')));

  p.once('dialog', (d) => d.accept('funcionou, vou manter'));
  await p.click('[data-concluir]');
  await p.waitForSelector('.pill.ok', { timeout: 20000 });
  check('concluir guarda a conclusao escrita', /funcionou, vou manter/.test(await p.textContent('body')));
  check('nenhum erro de JavaScript', erros.length === 0, erros.join(' | '));
  await b.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });
