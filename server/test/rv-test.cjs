// Avaliações do site, no navegador de verdade: salva, recarrega do banco, calcula a
// média e a distribuição, responde, vota e mostra a resposta do desenvolvedor em destaque.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const novaConta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: LOCAL });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error('não deu para entrar com ' + email + ': ' + r.status());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    return { ctx, p };
  };
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pAnon = await anon.newPage();

  // 1) vazio
  await pAnon.goto(LOCAL + '/#/avaliacoes');
  await pAnon.waitForSelector('#rvresumo .rv-vazio, #rvresumo .rv-topo', { timeout: 20000 });
  check('sem avaliações: mostra o convite em vez de inventar nota',
    /ainda não recebeu avaliações/.test(await pAnon.textContent('#rvresumo')), await pAnon.textContent('#rvresumo'));
  check('quem não entrou vê o convite para entrar, sem formulário de estrelas', (await pAnon.$('#rvpick')) === null && /Entrar com Google/.test(await pAnon.textContent('body')));

  // 2) primeira avaliação
  const a = await novaConta('rv.ana@example.com', 'Ana Souza');
  await a.p.goto(LOCAL + '/#/avaliacoes');
  await a.p.waitForSelector('#rvpick', { timeout: 20000 });
  await a.p.click('#rvpick button[data-nota="4"]');
  await a.p.fill('#rvtxt', 'Economizo horas por semana com o painel.');
  await a.p.click('#rvsave');
  await a.p.waitForSelector('#rvmsg .alert.ok', { timeout: 20000 });
  check('salvou e mostrou a avaliação enviada (estrelas e comentário)',
    /★★★★☆/.test(await a.p.textContent('#rvmsg')) && /Economizo horas/.test(await a.p.textContent('#rvmsg')), await a.p.textContent('#rvmsg'));

  // 3) veio do banco mesmo (recarrega a página inteira)
  await a.p.reload();
  await a.p.waitForSelector('#rvlista .rv-item', { timeout: 20000 });
  check('depois de recarregar a página, a avaliação continua lá (veio do banco)',
    /Economizo horas/.test(await a.p.textContent('#rvlista')) && (await a.p.inputValue('#rvtxt')) === 'Economizo horas por semana com o painel.');
  check('a nota geral mostra 4,0 com uma casa decimal e 1 avaliação',
    (await a.p.textContent('#rvresumo .rv-nota')) === '4,0' && /1 avaliação\b/.test(await a.p.textContent('#rvresumo')), await a.p.textContent('#rvresumo'));
  const barra4 = await a.p.$eval('#rvresumo .rv-linha:nth-child(2) .rv-cheio', (e) => e.style.width);
  check('a barra de 4 estrelas fica cheia (100%) e as outras vazias', barra4 === '100%', barra4);

  // 4) editar não cria outra
  await a.p.click('#rvpick button[data-nota="5"]');
  await a.p.fill('#rvtxt', 'Editado: virou essencial aqui.');
  await a.p.click('#rvsave');
  await a.p.waitForFunction(() => document.querySelector('#rvresumo .rv-nota')?.textContent === '5,0', null, { timeout: 20000 });
  check('editar a própria avaliação não cria uma segunda', (await a.p.$$('#rvlista .rv-item')).length === 1 && /1 avaliação\b/.test(await a.p.textContent('#rvresumo')));

  // 5) segunda conta: média e distribuição reais
  const b = await novaConta('rv.bruno@example.com', 'Bruno Lima');
  await b.p.goto(LOCAL + '/#/avaliacoes');
  await b.p.waitForSelector('#rvpick', { timeout: 20000 });
  await b.p.click('#rvpick button[data-nota="1"]');
  await b.p.fill('#rvtxt', 'Não consegui vincular meu canal.');
  await b.p.click('#rvsave');
  await b.p.waitForFunction(() => document.querySelector('#rvresumo .rv-nota')?.textContent === '3,0', null, { timeout: 20000 });
  check('com 5 e 1 a média vira 3,0 e aparecem 2 avaliações',
    /2 avaliações/.test(await b.p.textContent('#rvresumo')) && (await b.p.$$('#rvlista .rv-item')).length === 2);
  const larguras = await b.p.$$eval('#rvresumo .rv-cheio', (es) => es.map((e) => e.style.width));
  check('a distribuição mostra 50% em 5 estrelas e 50% em 1 estrela', larguras[0] === '50%' && larguras[4] === '50%', JSON.stringify(larguras));

  // 6) gostei na avaliação do outro (a lista se refaz, então buscamos o item pelo id)
  const cxId = await b.p.$eval('#rvlista .rv-item:has-text("Editado: virou essencial")', (e) => e.dataset.item);
  await b.p.click(`[data-item="${cxId}"] button[data-voto="review"][data-valor="1"]`);
  await b.p.waitForFunction(() => /👍 1/.test(document.querySelector('#rvlista')?.textContent || ''), null, { timeout: 15000 });
  check('gostei na avaliação de outra pessoa conta 1', /👍 1/.test(await b.p.textContent('#rvlista')));
  check('o botão de gostei fica marcado para quem votou', await b.p.$eval(`[data-item="${cxId}"] button[data-voto="review"][data-valor="1"]`, (e) => e.classList.contains('on')));

  // 7) responder
  await b.p.click(`[data-item="${cxId}"] button[data-responder]`);
  await b.p.fill(`[data-caixa="${cxId}"] textarea`, 'Também achei o painel muito bom.');
  await b.p.click(`[data-enviar-resp="${cxId}"]`);
  await b.p.waitForFunction(() => /Também achei o painel/.test(document.querySelector('#rvlista')?.textContent || ''), null, { timeout: 15000 });
  check('dá para responder a uma avaliação e a resposta aparece', /Também achei o painel/.test(await b.p.textContent('#rvlista')));

  // 8) resposta do desenvolvedor em destaque e em primeiro lugar
  const dev = await novaConta('admin@example.com', 'Admin do Site');
  await dev.p.goto(LOCAL + '/#/avaliacoes');
  await dev.p.waitForSelector('#rvlista .rv-item', { timeout: 20000 });
  await dev.p.click(`[data-item="${cxId}"] button[data-responder]`);
  await dev.p.fill(`[data-caixa="${cxId}"] textarea`, 'Obrigado! Estamos cuidando disso.');
  await dev.p.click(`[data-enviar-resp="${cxId}"]`);
  await dev.p.waitForFunction(() => document.querySelector('#rvlista .rv-resp.dev') !== null, null, { timeout: 15000 });
  const primeira = await dev.p.textContent(`[data-item="${cxId}"] .rv-respostas .rv-resp:first-child`);
  check('a resposta do desenvolvedor fica em destaque e em primeiro lugar',
    /Resposta do desenvolvedor/.test(primeira) && /Obrigado! Estamos cuidando/.test(primeira), primeira.replace(/\s+/g, ' ').slice(0, 120));

  // 9) ordenação
  await dev.p.selectOption('#rvordem', 'melhores');
  await dev.p.waitForTimeout(1200);
  const primeiroItem = await dev.p.textContent('#rvlista .rv-item:first-child');
  check('ordenar por melhor avaliação põe a de 5 estrelas na frente', /★★★★★/.test(primeiroItem), primeiroItem.replace(/\s+/g, ' ').slice(0, 80));

  // 10) a página inicial mostra o resumo real
  await dev.p.goto(LOCAL + '/#/');
  await dev.p.waitForSelector('#rvhome .rv-topo', { timeout: 20000 });
  check('a página inicial mostra "Esse site é:" com a média real', (await dev.p.textContent('#rvhome .rv-nota')) === '3,0', await dev.p.textContent('#rvhome'));

  // 11) moderação do administrador
  await dev.p.goto(LOCAL + '/#/admin/avaliacoes');
  await dev.p.waitForSelector('#atab .rv-item', { timeout: 20000 });
  check('o painel administrativo lista as avaliações para moderar', (await dev.p.$$('#atab .rv-item')).length >= 2);
  dev.p.once('dialog', (d) => d.accept('teste de moderação'));
  await dev.p.locator('#atab [data-mod]').first().click();
  await dev.p.waitForTimeout(2500);
  const depoisMod = await (await anon.newPage()).goto(LOCAL + '/api/reviews').then((r) => r.json());
  check('remover pela moderação tira da lista pública e recalcula a média', depoisMod.total === 1, JSON.stringify(depoisMod.resumo));

  // 12) celular
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: LOCAL });
  const pCel = await cel.newPage();
  await pCel.goto(LOCAL + '/#/avaliacoes');
  await pCel.waitForSelector('#rvlista', { timeout: 20000 });
  const estouro = await pCel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no celular não sobra barra de rolagem horizontal', estouro <= 1, String(estouro));

  const graves = erros.filter((e) => !/net::|favicon|404/.test(e));
  check('nenhum erro de JavaScript nas páginas', graves.length === 0, graves.slice(0, 2).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
