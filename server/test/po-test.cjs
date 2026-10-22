// Postagens, enquetes e moderação, pelo NAVEGADOR (não pela API).
//
// O que este teste prova:
//  - o dono publica na aba pública, com imagem, e todo mundo logado vê;
//  - curtir / não curtir conta certo e troca de um para o outro;
//  - o comentário público passa pelo filtro: link e telefone são barrados;
//  - imagem em comentário só existe na área dos administradores;
//  - o segundo administrador NÃO publica nem apaga sozinho: vira pedido;
//  - a área privada é invisível para usuário comum;
//  - enquete: só o dono abre, o outro administrador vota, o placar fica
//    escondido até ele votar, e as porcentagens fecham em 100;
//  - a aba de moderação mostra o motivo do bloqueio e NUNCA o texto barrado.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

// PNG 2x2 de verdade, para o upload não ser um arquivo de mentira
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC',
  'base64'
);

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const conta = async (email, nome, vw = { width: 1500, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport: vw });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error('login falhou para ' + email + ': ' + r.status());
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.accept());
    p.on('pageerror', (e) => erros.push(email + ': ' + e));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erros.push(email + ': ' + m.text()); });
    return { ctx, p, email };
  };

  const dono = await conta('admin@example.com', 'Admin do Site');
  const segundo = await conta('segundo@example.com', 'Segundo Admin');
  const comum = await conta('comum@example.com', 'Pessoa Comum');

  // o dono promove o segundo a administrador (é assim que se faz no site)
  const prom = await dono.ctx.request.post(LOCAL + '/api/admin/admins', { data: { email: 'segundo@example.com' } });
  check('o dono promove o segundo a administrador', prom.ok() || prom.status() === 409, String(prom.status()));

  // ---------- 1) o dono publica na aba pública, com imagem ----------
  await dono.p.goto(LOCAL + '/#/postagens');
  await dono.p.waitForSelector('#poNova', { timeout: 20000 });
  await dono.p.click('#poNova');
  await dono.p.waitForSelector('#poF', { timeout: 10000 });
  await dono.p.fill('[name="titulo"]', 'Novidade: estatísticas de crescimento');
  await dono.p.fill('[name="texto"]', 'Agora o site mostra quantos canais passaram de cada meta.');
  await dono.p.setInputFiles('#poImg', { name: 'arte.png', mimeType: 'image/png', buffer: PNG });
  await dono.p.waitForSelector('#poPrevia img', { timeout: 10000 });
  check('a prévia da imagem aparece antes de publicar', !!(await dono.p.$('#poPrevia img')));
  await dono.p.click('#poF button[type="submit"]');
  await dono.p.waitForSelector('.po-card', { timeout: 15000 });
  const cardTxt = await dono.p.textContent('#poLista');
  check('a postagem aparece na lista', /estatísticas de crescimento/.test(cardTxt));
  check('e sai com o nome e o selo de dono do autor', /Admin do Site/.test(cardTxt) && /dono/.test(cardTxt));
  const srcImg = await dono.p.getAttribute('.po-card .po-img', 'src');
  check('a imagem foi junto e é mesmo uma imagem', /^data:image\/(png|jpeg);base64,/.test(srcImg || ''), String(srcImg).slice(0, 40));
  const postId = await dono.p.getAttribute('.po-card', 'data-post');

  // ---------- 2) usuário comum vê, curte e troca para não-curtir ----------
  await comum.p.goto(LOCAL + '/#/postagens');
  await comum.p.waitForSelector('.po-card', { timeout: 20000 });
  check('quem não é administrador também vê a postagem pública', /estatísticas de crescimento/.test(await comum.p.textContent('#poLista')));
  check('mas não vê o botão de publicar', !(await comum.p.$('#poNova')));
  check('nem os botões de editar e excluir', !(await comum.p.$('[data-editar]')) && !(await comum.p.$('[data-excluir]')));
  await comum.p.click('[data-curtir]');
  await comum.p.waitForFunction(() => /👍 1/.test(document.querySelector('[data-curtir]').textContent), null, { timeout: 10000 });
  check('curtir conta 1', /👍 1/.test(await comum.p.textContent('[data-curtir]')));
  await comum.p.click('[data-descurtir]');
  await comum.p.waitForFunction(() => /👎 1/.test(document.querySelector('[data-descurtir]').textContent), null, { timeout: 10000 });
  check('trocar para não-curtir tira a curtida em vez de somar as duas',
    /👍 0/.test(await comum.p.textContent('[data-curtir]')) && /👎 1/.test(await comum.p.textContent('[data-descurtir]')));
  await comum.p.click('[data-descurtir]');
  await comum.p.waitForFunction(() => /👎 0/.test(document.querySelector('[data-descurtir]').textContent), null, { timeout: 10000 });
  check('clicar de novo desfaz a reação', /👎 0/.test(await comum.p.textContent('[data-descurtir]')));

  // ---------- 3) comentário público e o filtro ----------
  await comum.p.click('[data-coment]');
  await comum.p.waitForSelector('.po-escrever .po-com-txt', { timeout: 10000 });
  check('na área pública o comentário NÃO tem botão de imagem', !(await comum.p.$('.po-com-img-in')));
  await comum.p.fill('.po-com-txt', 'Parabéns, ficou muito bom o site!');
  await comum.p.click('.po-escrever button[type="submit"]');
  await comum.p.waitForFunction(() => /ficou muito bom/.test(document.querySelector('.po-coments').textContent), null, { timeout: 15000 });
  check('o comentário limpo entra', /ficou muito bom o site/.test(await comum.p.textContent('.po-coments')));

  await comum.p.fill('.po-com-txt', 'me chama no zap 54 98439 8807 que eu te explico');
  await comum.p.click('.po-escrever button[type="submit"]');
  await comum.p.waitForSelector('.po-com-msg .alert', { timeout: 15000 });
  const recado = await comum.p.textContent('.po-com-msg');
  check('comentário com telefone é barrado', /mensagem|barrad|não|bloque/i.test(recado), recado.trim().slice(0, 90));
  check('e o texto barrado não fica guardado na tela', !/98439/.test(await comum.p.textContent('.po-coments')));

  await comum.p.fill('.po-com-txt', 'entra em meucanal ponto com que tem promoçao');
  await comum.p.click('.po-escrever button[type="submit"]');
  await comum.p.waitForTimeout(1200);
  check('comentário com endereço de site escrito por extenso também é barrado',
    !/meucanal/.test(await comum.p.textContent('.po-coments')));

  // ---------- 4) a área privada é invisível para usuário comum ----------
  const espiada = await comum.ctx.request.get(LOCAL + '/api/postagens?area=admin');
  check('o servidor recusa a área privada para usuário comum', espiada.status() === 403, String(espiada.status()));
  await comum.p.goto(LOCAL + '/#/admin/postagens');
  await comum.p.waitForTimeout(2500);
  check('e o painel nem abre para ele', /Acesso restrito/.test(await comum.p.textContent('#app')));

  // ---------- 5) área privada: imagem em comentário ----------
  await dono.p.goto(LOCAL + '/#/admin/postagens');
  await dono.p.waitForSelector('#poNova', { timeout: 20000 });
  await dono.p.click('#poNova');
  await dono.p.waitForSelector('#poF', { timeout: 10000 });
  await dono.p.fill('[name="titulo"]', 'Combinado interno da equipe');
  await dono.p.fill('[name="texto"]', 'Confirmação de pagamento manual continua só comigo.');
  await dono.p.click('#poF button[type="submit"]');
  await dono.p.waitForSelector('.po-card', { timeout: 15000 });
  check('a postagem privada entra na área dos administradores', /Combinado interno/.test(await dono.p.textContent('#poLista')));
  await dono.p.click('[data-coment]');
  await dono.p.waitForSelector('.po-escrever .po-com-txt', { timeout: 10000 });
  check('na área privada o comentário TEM botão de imagem', !!(await dono.p.$('.po-com-img-in')));
  await dono.p.fill('.po-com-txt', 'segue o print do painel');
  await dono.p.setInputFiles('.po-com-img-in', { name: 'print.png', mimeType: 'image/png', buffer: PNG });
  await dono.p.click('.po-escrever button[type="submit"]');
  await dono.p.waitForSelector('.po-com-img', { timeout: 15000 });
  check('a imagem do comentário privado aparece', !!(await dono.p.$('.po-com-img')));
  const privId = await dono.p.getAttribute('.po-card', 'data-post');
  const semFiltro = await dono.ctx.request.post(LOCAL + `/api/postagens/${privId}/comentarios`, { data: { texto: 'me liga no 54 98439 8807' } });
  check('na área privada o filtro do bate-papo não atrapalha a equipe', semFiltro.ok(), String(semFiltro.status()));

  // ---------- 6) o segundo administrador não age sozinho ----------
  await segundo.p.goto(LOCAL + '/#/postagens');
  await segundo.p.waitForSelector('#poNova', { timeout: 20000 });
  check('o segundo administrador é avisado de que a postagem dele vai para aprovação',
    /aprovação do administrador principal/i.test(await segundo.p.textContent('#poArea')));
  await segundo.p.click('#poNova');
  await segundo.p.waitForSelector('#poF', { timeout: 10000 });
  await segundo.p.fill('[name="titulo"]', 'Postagem sem permissão');
  await segundo.p.fill('[name="texto"]', 'Era para esperar o Sim do principal.');
  await segundo.p.click('#poF button[type="submit"]');
  await segundo.p.waitForTimeout(2500);
  check('a postagem dele NÃO aparece antes do Sim', !/Postagem sem permissão/.test(await segundo.p.textContent('#poLista')));
  const apagar = await segundo.ctx.request.delete(LOCAL + '/api/postagens/' + postId, { data: { motivo: 'teste' } });
  check('e apagar a postagem do dono também vira pedido, não acontece', apagar.status() === 202, String(apagar.status()));
  const aindaLa = await dono.ctx.request.get(LOCAL + '/api/postagens?area=publica');
  check('a postagem do dono continua no ar', (await aindaLa.json()).itens.some((p) => p.id === postId));

  // o dono aprova a postagem que ficou na fila
  const fila = await (await dono.ctx.request.get(LOCAL + '/api/admin/pedidos')).json();
  const pend = fila.itens.filter((p) => p.status === 'pendente');
  check('os dois pedidos do segundo administrador estão na fila do dono', pend.length >= 2, String(pend.length));
  const pedPost = pend.find((p) => /postagem/i.test(p.acao) && !/excluir|apagar/i.test(p.acao));
  const ap = await dono.ctx.request.post(LOCAL + `/api/admin/pedidos/${pedPost.id}/decidir`, { data: { decisao: 'sim' } });
  check('o dono responde Sim e a postagem é publicada', ap.ok(), String(ap.status()));
  await segundo.p.reload();
  let apareceu = true;
  try {
    await segundo.p.waitForFunction(() => /Postagem sem permissão/.test(document.querySelector('#poLista')?.textContent || ''), null, { timeout: 15000 });
  } catch { apareceu = false; }
  check('depois do Sim, a postagem aparece', apareceu, apareceu ? '' : (await segundo.p.textContent('#poLista')).slice(0, 120));

  // ---------- 7) enquetes ----------
  await segundo.p.goto(LOCAL + '/#/admin/enquetes');
  await segundo.p.waitForSelector('#enqLista', { timeout: 20000 });
  check('o segundo administrador não tem formulário para abrir enquete', !(await segundo.p.$('#enqF')));
  const tentaEnq = await segundo.ctx.request.post(LOCAL + '/api/admin/enquetes', { data: { pergunta: 'posso?', opcoes: ['sim', 'nao'] } });
  check('e o servidor recusa se ele chamar a API direto', tentaEnq.status() === 403, String(tentaEnq.status()));

  await dono.p.goto(LOCAL + '/#/admin/enquetes');
  await dono.p.waitForSelector('#enqF', { timeout: 20000 });
  await dono.p.fill('[name="pergunta"]', 'Mudamos o preço da auditoria?');
  await dono.p.fill('[name="opcoes"]', 'Sim\nNão\nDepois');
  await dono.p.click('#enqF button[type="submit"]');
  await dono.p.waitForSelector('#enqMsg .alert', { timeout: 15000 });
  check('a enquete é aberta e os administradores são avisados', /avisado/i.test(await dono.p.textContent('#enqMsg')));
  await dono.p.waitForSelector('[data-enq]', { timeout: 15000 });
  const enqId = await dono.p.getAttribute('#enqLista [data-enq]', 'data-enq');
  const ENQ = `[data-enq="${enqId}"]`;
  check('o dono lê o placar sem precisar votar (a enquete é a consulta dele)',
    (await dono.p.$$(ENQ + ' .bt-linha')).length === 3 && !/aparece depois que você votar/.test(await dono.p.textContent(ENQ)));

  await segundo.p.reload();
  await segundo.p.waitForSelector(ENQ + ' [data-votar]', { timeout: 20000 });
  check('para quem vai votar, o placar fica escondido antes do voto',
    /aparece depois que você votar/.test(await segundo.p.textContent(ENQ)) && !(await segundo.p.$(ENQ + ' .bt-linha')));
  await segundo.p.click(`${ENQ} [data-votar][data-op="1"]`);
  // esperar pelo TEXTO, não pela barra: a barra da opção com zero voto tem
  // largura 0 e o navegador a considera invisível
  await segundo.p.waitForFunction((sel) => /Você votou/.test(document.querySelector(sel)?.textContent || ''), ENQ, { timeout: 15000 });
  const placar = await segundo.p.textContent(ENQ);
  check('depois de votar ele vê o resultado e o próprio voto', /100%/.test(placar) && /Você votou/.test(placar), placar.replace(/\s+/g, ' ').slice(0, 140));
  const somas = await segundo.p.$$eval(ENQ + ' .bt-val', (ns) => ns.map((n) => parseInt(n.textContent, 10)));
  check('as porcentagens fecham exatamente em 100', somas.reduce((a, b) => a + b, 0) === 100, somas.join('+'));

  await dono.p.reload();
  await dono.p.waitForSelector(ENQ, { timeout: 20000 });
  check('o dono vê quem votou e em quê', /Quem votou:.*Segundo Admin/s.test(await dono.p.textContent(ENQ)));
  await dono.p.click(`${ENQ} [data-fechar]`);
  await dono.p.waitForFunction((sel) => /fechada/.test(document.querySelector(sel + ' .pill')?.textContent || ''), ENQ, { timeout: 15000 });
  check('o dono fecha a enquete', /fechada/.test(await dono.p.textContent(ENQ + ' .pill')));
  const votoTarde = await segundo.ctx.request.post(LOCAL + `/api/admin/enquetes/${enqId}/votar`, { data: { opcao: 0 } });
  check('e ninguém vota em enquete fechada', votoTarde.status() === 409, String(votoTarde.status()));

  // ---------- 8) moderação: motivo sim, texto não ----------
  await dono.p.goto(LOCAL + '/#/admin/batepapo');
  await dono.p.waitForSelector('#atab .card', { timeout: 20000 });
  const mod = await dono.p.textContent('#atab');
  check('a aba de moderação mostra quem apanhou do filtro', /comum@example\.com/.test(mod), mod.replace(/\s+/g, ' ').slice(0, 160));
  check('mostra o motivo do bloqueio', /telefone|site|link/.test(mod), mod.replace(/\s+/g, ' ').slice(0, 200));
  check('e diz que o bloqueio veio de um comentário, não do bate-papo', /coment/i.test(mod));
  check('mas NUNCA o texto barrado', !/98439/.test(mod) && !/meucanal/.test(mod));

  // ---------- 9) celular ----------
  const cel = await conta('comum@example.com', 'Pessoa Comum', { width: 390, height: 844 });
  await cel.p.goto(LOCAL + '/#/postagens');
  await cel.p.waitForSelector('.po-card', { timeout: 20000 });
  const estouro = await cel.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no celular as postagens aparecem sem sobrar rolagem lateral', estouro <= 1 && !!(await cel.p.$('.po-img')), String(estouro));

  // ---------- 10) o resto do site não quebrou ----------
  await comum.p.goto(LOCAL + '/#/bate-papo');
  await comum.p.waitForSelector('#bpLista, #bpMsgs, .bp-msgs', { timeout: 20000 }).catch(() => {});
  check('o bate-papo público continua abrindo', !/Erro|undefined/.test((await comum.p.textContent('#app')).slice(0, 400)));

  const graves = erros.filter((e) => !/net::|favicon|404|422|403/.test(e));
  check('nenhum erro de JavaScript', graves.length === 0, graves.slice(0, 3).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
