// Notificações, pedidos e chat no navegador de verdade.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const erros = [];
  const conta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, baseURL: LOCAL });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error(`login ${email}: ${r.status()} ${(await r.text()).slice(0, 120)}`);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(`${email}: ${e}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(`${email}: ${m.text()}`); });
    return { ctx, p, req: ctx.request };
  };

  const dono = await conta('admin@example.com', 'Dono');
  const ana = await conta('nt.ana@example.com', 'Ana Paula');

  // --- sino com a notificação de boas-vindas ---
  await ana.p.goto(LOCAL + '/#/dashboard');
  await ana.p.waitForSelector('#sino', { timeout: 20000 });
  await ana.p.waitForSelector('#sinoN:not([hidden])', { timeout: 20000 });
  check('o sino aparece com contador de não lidas', (await ana.p.textContent('#sinoN')).trim().length > 0, await ana.p.textContent('#sinoN'));
  await ana.p.click('#sino');
  await ana.p.waitForSelector('#ntcaixa .nt-item', { timeout: 20000 });
  const cx = await ana.p.textContent('#ntcaixa');
  check('a caixa abre com a notificação de boas-vindas', /Boas-vindas/.test(cx), cx.slice(0, 120));
  check('a notificação nova aparece destacada', (await ana.p.$$('#ntcaixa .nt-item.nova')).length >= 1);
  await ana.p.screenshot({ path: SHOTS + '/sino.png' });

  // --- dono promove Ana a admin: ela recebe a notificação ---
  const anaId = (await (await dono.req.get(LOCAL + '/api/admin/users?q=nt.ana')).json()).items[0].id;
  await dono.req.post(LOCAL + '/api/admin/admins', { data: { email: 'nt.ana@example.com' } });
  await ana.p.reload();
  await ana.p.waitForSelector('#sino', { timeout: 20000 });
  await ana.p.click('#sino');
  await ana.p.waitForSelector('#ntcaixa .nt-item', { timeout: 20000 });
  check('quem vira administrador é avisado pelo sino', /administrador do TurboCanal/.test(await ana.p.textContent('#ntcaixa')));

  // --- Ana (admin comum) tenta dar créditos: vira pedido ---
  await ana.p.goto(LOCAL + '/#/admin/usuarios');
  await ana.p.waitForSelector('#ulist table', { timeout: 20000 });
  const r1 = await ana.req.post(LOCAL + '/api/admin/users/' + anaId + '/credits', { data: { delta: 1000, note: 'teste de interface' } });
  check('a interface do admin comum recebe 202 (virou pedido)', r1.status() === 202, String(r1.status()));

  // --- o contador na aba avisa antes de abrir ---
  await dono.p.goto(LOCAL + '/#/admin/geral');
  await dono.p.waitForSelector('[data-contador="pedidos"]:not([hidden])', { timeout: 20000 });
  check('a aba Pedidos mostra contador de pedidos esperando resposta',
    (await dono.p.textContent('[data-contador="pedidos"]')).trim() === '1', await dono.p.textContent('[data-contador="pedidos"]'));

  // --- dono vê o pedido na aba Pedidos ---
  await dono.p.goto(LOCAL + '/#/admin/pedidos');
  await dono.p.waitForSelector('[data-ped]', { timeout: 20000 });
  const tp = await dono.p.textContent('#atab');
  check('o pedido aparece para o administrador principal, com quem pediu e o quê',
    /nt\.ana@example\.com/.test(tp) && /aumentar/.test(tp) && /esperando você/.test(tp), tp.slice(0, 200));
  check('o motivo escrito pelo admin aparece', /teste de interface/.test(tp));
  check('os três botões estão lá: Sim, Não e Conversar',
    (await dono.p.$$('[data-sim]')).length >= 1 && (await dono.p.$$('[data-nao]')).length >= 1 && (await dono.p.$$('[data-papo]')).length >= 1);
  await dono.p.screenshot({ path: SHOTS + '/pedidos.png', fullPage: true });

  dono.p.once('dialog', (d) => d.accept('pode sim'));
  await dono.p.click('[data-sim]');
  await dono.p.waitForSelector('.pill.ok', { timeout: 20000 });
  check('depois do Sim o pedido fica como aprovado e nenhum fica pendente',
    (await dono.p.$$('.pill.ok')).length >= 1 && (await dono.p.$$('.pill.warn')).length === 0,
    `ok=${(await dono.p.$$('.pill.ok')).length} pendentes=${(await dono.p.$$('.pill.warn')).length}`);
  const saldo = (await (await ana.req.get(LOCAL + '/api/me')).json()).user.credits;
  check('e os créditos entraram de verdade', saldo >= 1000, String(saldo));

  // --- aba de chats ---
  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector('.ch-conv', { timeout: 20000 });
  const lado = await dono.p.textContent('.ch-lado');
  check('a lateral tem a seção Principais e a seção Todas', /Principais/.test(lado) && /Todas/.test(lado));
  check('a conversa geral com todos os administradores está lá', /Todos os administradores/.test(lado), lado.slice(0, 160));
  check('a lista de quem dá para chamar mostra os outros admins', /nt\.ana@example\.com/.test(lado));

  await dono.p.click('.ch-conv');
  await dono.p.waitForSelector('#chForm', { timeout: 20000 });
  await dono.p.fill('#chTxt', 'Bom dia, equipe. Testando o chat.');
  await dono.p.click('#chForm button[type="submit"]');
  await dono.p.waitForSelector('.ch-bolha', { timeout: 20000 });
  check('a mensagem aparece na conversa', /Testando o chat/.test(await dono.p.textContent('#chMsgs')));
  await dono.p.screenshot({ path: SHOTS + '/chats.png', fullPage: true });

  // Ana vê a mensagem e é notificada
  await ana.p.goto(LOCAL + '/#/admin/chats');
  await ana.p.waitForSelector('.ch-conv', { timeout: 20000 });
  check('a conversa aparece para a outra administradora com contador de não lidas',
    (await ana.p.$$('.ch-n')).length >= 1, await ana.p.textContent('.ch-lado'));
  await ana.p.click('.ch-conv');
  await ana.p.waitForSelector('.ch-bolha', { timeout: 20000 });
  check('ela lê a mensagem do dono', /Testando o chat/.test(await ana.p.textContent('#chMsgs')));

  // fixar nos principais: usa a conversa de um a um (a geral já nasce fixada de propósito)
  const dmR = await dono.req.post(LOCAL + '/api/admin/chats/dm', { data: { com: anaId } });
  const dmId = (await dmR.json()).conversa;
  await dono.p.reload();
  await dono.p.waitForSelector(`[data-conv="${dmId}"]`, { timeout: 20000 });
  const fixAntes = (await dono.p.$$('#chFix .ch-conv')).length;
  check('a conversa nova começa fora dos Principais', await dono.p.$(`#chTodos [data-conv="${dmId}"]`) !== null);
  await dono.p.click(`[data-pin][data-pin="${dmId}"]`);
  await dono.p.waitForTimeout(1300);
  check('fixar move essa conversa para Principais',
    (await dono.p.$$('#chFix .ch-conv')).length === fixAntes + 1 && await dono.p.$(`#chFix [data-conv="${dmId}"]`) !== null,
    `antes ${fixAntes}, depois ${(await dono.p.$$('#chFix .ch-conv')).length}`);
  const vistaAna = (await (await ana.req.get(LOCAL + '/api/admin/chats')).json()).itens.find((c) => c.id === dmId);
  check('e isso é só meu: a mesma conversa NÃO fica fixada para a outra pessoa', vistaAna && vistaAna.fixado === false, JSON.stringify(vistaAna?.fixado));

  // o botão de ligação diz a verdade em vez de fingir
  await dono.p.click('.ch-conv');
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  let textoDialogo = '';
  dono.p.once('dialog', (d) => { textoDialogo = d.message(); d.accept(); });
  await dono.p.click('#chLigar');
  await dono.p.waitForTimeout(600);
  check('o botão de ligar avisa honestamente que ainda não está pronto, e por quê',
    /ainda não está pronta/.test(textoDialogo) && /TURN/.test(textoDialogo), textoDialogo.slice(0, 120));

  // página de notificações
  await ana.p.goto(LOCAL + '/#/notificacoes');
  await ana.p.waitForSelector('#ntpag', { timeout: 20000 });
  check('a página de notificações lista tudo', (await ana.p.$$('#ntpag .nt-item')).length >= 2);
  await ana.p.click('#ntTodasPag');
  await ana.p.waitForTimeout(900);
  check('marcar todas como lidas some com o contador do sino', await ana.p.$eval('#sinoN', (e) => e.hidden) === true);

  // o contador de chat tambem aparece para quem tem mensagem nao lida
  // (Ana ja leu as anteriores, entao o dono manda uma nova agora)
  const convGeral = (await (await dono.req.get(LOCAL + '/api/admin/chats')).json()).itens.find((c) => c.tipo === 'geral');
  await dono.req.post(LOCAL + `/api/admin/chats/${convGeral.id}/mensagens`, { data: { texto: 'Mensagem nova, ainda nao lida pela Ana.' } });
  await ana.p.goto(LOCAL + '/#/admin/usuarios');
  await ana.p.waitForSelector('[data-contador="chats"]', { timeout: 20000 });
  await ana.p.waitForTimeout(1500);
  const nChats = await ana.p.$eval('[data-contador="chats"]', (e) => ({ txt: e.textContent, escondido: e.hidden }));
  check('a aba Chats mostra contador de mensagem nao lida', nChats.escondido === false && Number(nChats.txt) >= 1, JSON.stringify(nChats));

  check('nenhum erro de JavaScript em nenhuma das telas', erros.length === 0, erros.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
