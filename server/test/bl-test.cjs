// Avisos e cards: cria pelo PAINEL (não pela API), confere que aparece na posição
// escolhida da página, que o endereço do link não vira texto, que editar/ocultar/mover
// persiste no banco, e que usuário comum não consegue mexer.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
const URL_CANAL = 'https://www.youtube.com/@turbocanal';

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const conta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error('login falhou: ' + r.status());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    return { ctx, p };
  };

  const adm = await conta('admin@example.com', 'Admin do Site');
  await adm.p.goto(LOCAL + '/#/admin/blocos');
  await adm.p.waitForSelector('[data-novo="aviso"]', { timeout: 20000 });
  check('o painel tem a aba "Avisos e cards"', /Nenhum aviso ou card criado ainda/.test(await adm.p.textContent('#atab')));

  // 1) criar um aviso pelo painel
  await adm.p.click('[data-novo="aviso"]');
  await adm.p.waitForSelector('#blform', { timeout: 10000 });
  await adm.p.fill('#b_titulo', 'Plataforma em fase de testes');
  await adm.p.fill('#b_texto', 'Se encontrar algum erro, fale com a gente.');
  await adm.p.fill('#b_emoji', '⚠️');
  await adm.p.selectOption('#b_slot', 'topo');
  await adm.p.selectOption('#b_pagina', 'home');
  check('a prévia mostra o aviso antes de salvar', /Plataforma em fase de testes/.test(await adm.p.textContent('#b_previa')));
  await adm.p.click('#b_salvar');
  await adm.p.waitForSelector('.rv-item', { timeout: 15000 });
  check('o aviso aparece na lista do painel como publicado', /publicado/.test(await adm.p.textContent('#atab')));

  // 2) criar um card com link
  await adm.p.click('[data-novo="card"]');
  await adm.p.waitForSelector('#blform', { timeout: 10000 });
  await adm.p.fill('#b_titulo', 'Canal oficial do TurboCanal');
  await adm.p.fill('#b_texto', 'Dicas toda semana');
  await adm.p.fill('#b_emoji', '🎬');
  await adm.p.fill('#b_link', URL_CANAL);
  await adm.p.fill('#b_linktxt', 'Acessar');
  await adm.p.selectOption('#b_slot', 'lateral-direita');
  await adm.p.click('#b_salvar');
  await adm.p.waitForTimeout(1500);
  check('o card também entra na lista', /Canal oficial do TurboCanal/.test(await adm.p.textContent('#atab')));

  // 3) o visitante vê, nas posições escolhidas
  const anon = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const pv = await anon.newPage();
  await pv.goto(LOCAL + '/#/');
  await pv.waitForSelector('#slot-topo .bl-aviso', { timeout: 20000 });
  check('quem não entrou vê o aviso no topo do site', /Plataforma em fase de testes/.test(await pv.textContent('#slot-topo')));
  await pv.waitForSelector('#slot-lat-dir .bl-card', { timeout: 15000 });
  const textoCard = await pv.textContent('#slot-lat-dir');
  const hrefCard = await pv.getAttribute('#slot-lat-dir .bl-card', 'href');
  check('o card aparece na lateral direita com o nome escolhido', /Canal oficial do TurboCanal/.test(textoCard));
  check('o endereço do link NÃO aparece como texto', !textoCard.includes('youtube.com'), textoCard.replace(/\s+/g, ' ').slice(0, 120));
  check('mas o clique leva para o endereço certo', hrefCard === URL_CANAL, String(hrefCard));
  check('o link abre em outra aba e sem passar força para o site de destino',
    (await pv.getAttribute('#slot-lat-dir .bl-card', 'target')) === '_blank' && /noopener/.test(await pv.getAttribute('#slot-lat-dir .bl-card', 'rel') || ''));

  // 4) editar persiste depois de recarregar (mirando o AVISO, não o card)
  const itemCom = (txt) => adm.p.locator('.rv-item', { hasText: txt });
  await itemCom('Plataforma em fase de testes').locator('[data-editar]').click();
  await adm.p.waitForSelector('#blform', { timeout: 10000 });
  await adm.p.fill('#b_titulo', 'Aviso editado pelo painel');
  await adm.p.click('#b_salvar');
  await adm.p.waitForTimeout(1500);
  await pv.reload();
  await pv.waitForSelector('#slot-topo .bl-aviso', { timeout: 20000 });
  check('editar pelo painel muda a página e continua depois de recarregar', /Aviso editado pelo painel/.test(await pv.textContent('#slot-topo')));

  // 5) ocultar e publicar de novo
  await itemCom('Aviso editado pelo painel').locator('[data-pub]').click();
  await adm.p.waitForTimeout(1500);
  await pv.reload();
  await pv.waitForTimeout(2500);
  check('ocultar tira o aviso da página', !(await pv.$('#slot-topo .bl-aviso')) || (await pv.isHidden('#slot-topo')));
  await itemCom('Aviso editado pelo painel').locator('[data-pub]').click();
  await adm.p.waitForTimeout(1500);
  await pv.reload();
  await pv.waitForSelector('#slot-topo .bl-aviso', { timeout: 20000 });
  check('publicar de novo traz o aviso de volta', /Aviso editado pelo painel/.test(await pv.textContent('#slot-topo')));

  // 6) mudar a posição
  await itemCom('Aviso editado pelo painel').locator('[data-editar]').click();
  await adm.p.waitForSelector('#blform', { timeout: 10000 });
  await adm.p.selectOption('#b_slot', 'home-antes-planos');
  await adm.p.click('#b_salvar');
  await adm.p.waitForTimeout(1500);
  await pv.reload();
  await pv.waitForSelector('[data-slot="home-antes-planos"] .bl-aviso', { timeout: 20000 });
  check('mudar a posição move o aviso para o meio da página, entre as seções',
    /Aviso editado pelo painel/.test(await pv.textContent('[data-slot="home-antes-planos"]')) && (await pv.isHidden('#slot-topo')));

  // 7) aviso em todas as páginas
  await itemCom('Aviso editado pelo painel').locator('[data-editar]').click();
  await adm.p.waitForSelector('#blform', { timeout: 10000 });
  await adm.p.selectOption('#b_pagina', 'todas');
  await adm.p.selectOption('#b_slot', 'rodape');
  await adm.p.click('#b_salvar');
  await adm.p.waitForTimeout(1500);
  await pv.goto(LOCAL + '/#/planos');
  await pv.waitForSelector('#slot-rodape .bl-aviso', { timeout: 20000 });
  check('marcado como "todas as páginas", o aviso aparece também em Planos', /Aviso editado pelo painel/.test(await pv.textContent('#slot-rodape')));

  // 8) usuário comum não gerencia
  const comum = await conta('comum.blocos@example.com', 'Pessoa Comum');
  await comum.p.goto(LOCAL + '/#/admin/blocos');
  await comum.p.waitForTimeout(2500);
  check('usuário comum não entra no painel de avisos', /Acesso restrito/.test(await comum.p.textContent('#app')));
  const tentativa = await comum.ctx.request.post(LOCAL + '/api/admin/blocks', { data: { tipo: 'aviso', pagina: 'home', slot: 'topo', titulo: 'invasao' } });
  check('e o servidor recusa mesmo chamando a API direto', tentativa.status() === 403, String(tentativa.status()));

  // 9) celular
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pc = await cel.newPage();
  await pc.goto(LOCAL + '/#/');
  await pc.waitForSelector('#slot-lat-dir .bl-card', { timeout: 20000 });
  const estouro = await pc.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no celular o card continua aparecendo e não sobra rolagem horizontal',
    estouro <= 1 && /Canal oficial/.test(await pc.textContent('#slot-lat-dir')), String(estouro));

  // 10) nada quebrou no resto do site
  await pv.goto(LOCAL + '/#/avaliacoes');
  await pv.waitForSelector('#rvresumo', { timeout: 20000 });
  check('as outras páginas continuam funcionando (avaliações carregam)', !!(await pv.$('#rvlista')));

  const graves = erros.filter((e) => !/net::|favicon|404/.test(e));
  check('nenhum erro de JavaScript nas páginas', graves.length === 0, graves.slice(0, 2).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
