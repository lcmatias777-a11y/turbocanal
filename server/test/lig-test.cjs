// Ligação de voz entre dois administradores, em dois navegadores de verdade.
// Usa microfone falso do Chromium, então a conexão WebRTC acontece pra valer.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3];
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };

(async () => {
  const browser = await chromium.launch({
    channel: 'chromium', headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-file-access-from-files']
  });
  const erros = [];
  const conta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1340, height: 900 }, baseURL: LOCAL, permissions: ['microphone'] });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(`${email}: ${e}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(`${email}: ${m.text()}`); });
    return { ctx, p, req: ctx.request };
  };

  const dono = await conta('admin@example.com', 'Dono');
  const bia = await conta('lig.bia@example.com', 'Bia Lima');
  const biaId = (await (await dono.req.get(LOCAL + '/api/admin/users?q=lig.bia')).json()).items[0].id;
  await dono.req.post(LOCAL + '/api/admin/admins', { data: { email: 'lig.bia@example.com' } });

  const dm = await (await dono.req.post(LOCAL + '/api/admin/chats/dm', { data: { com: biaId } })).json();

  // as duas abrem a aba de chats
  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector(`[data-conv="${dm.conversa}"]`, { timeout: 20000 });
  await bia.p.goto(LOCAL + '/#/admin/chats');
  await bia.p.waitForSelector('.ch-conv', { timeout: 20000 });

  // o dono abre a conversa e liga
  await dono.p.click(`[data-conv="${dm.conversa}"]`);
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  await dono.p.click('#chLigar');
  await dono.p.waitForSelector('#ligCaixa', { timeout: 20000 });
  check('quem liga vê o painel de chamada', /Chamando/.test(await dono.p.textContent('#ligCaixa')), await dono.p.textContent('#ligCaixa'));

  // a outra pessoa recebe a chamada mesmo sem estar na conversa
  await bia.p.waitForSelector('#ligCaixa', { timeout: 30000 });
  const toca = await bia.p.textContent('#ligCaixa');
  const nomeDono = (await (await dono.req.get(LOCAL + '/api/me')).json()).user.name;
  check('quem recebe vê quem está ligando, com Atender e Recusar',
    /está te ligando/.test(toca) && toca.includes(nomeDono) && (await bia.p.$('#ligAceita')) !== null && (await bia.p.$('#ligRecusa')) !== null, `${toca} | esperava ${nomeDono}`);
  await bia.p.screenshot({ path: SHOTS + '/ligacao-tocando.png' });

  // atende e espera conectar de verdade
  await bia.p.click('#ligAceita');
  const conectou = async (pg) => {
    for (let i = 0; i < 40; i++) {
      const st = await pg.evaluate(() => (window.lig?.pc ? window.lig.pc.connectionState : 'sem-pc')).catch(() => 'erro');
      if (st === 'connected') return true;
      if (st === 'failed') return false;
      await pg.waitForTimeout(500);
    }
    return false;
  };
  const okDono = await conectou(dono.p);
  const okBia = await conectou(bia.p);
  check('a conexão de áudio é estabelecida de verdade entre os dois navegadores', okDono && okBia, `dono=${okDono} bia=${okBia}`);
  if (okDono) {
    check('a tela do chamador diz que conectou', /Conectado/.test(await dono.p.textContent('#ligCaixa')), await dono.p.textContent('#ligCaixa'));
    const temAudio = await dono.p.evaluate(() => {
      const a = document.getElementById('ligAudio');
      return !!(a && a.srcObject && a.srcObject.getAudioTracks().length);
    });
    check('o áudio da outra pessoa chega de verdade (faixa de áudio recebida)', temAudio);
    await dono.p.screenshot({ path: SHOTS + '/ligacao-conectada.png' });
  }

  // desligar avisa o outro lado
  await dono.p.click('#ligFim, #ligCancel').catch(() => {});
  if (!(await dono.p.$('#ligFim')) && !(await dono.p.$('#ligCancel'))) {
    await dono.p.evaluate(() => { ligSinal(lig.conversa, lig.com, 'desligou', {}); ligFechar(); });
  }
  await bia.p.waitForFunction(() => /encerrada|desligou/i.test(document.getElementById('ligCaixa')?.textContent || ''), { timeout: 20000 }).catch(() => {});
  check('quando um desliga, o outro é avisado', /desligou|encerrada/i.test(await bia.p.textContent('#ligCaixa').catch(() => '')), await bia.p.textContent('#ligCaixa').catch(() => 'sem painel'));

  // DUAS ABAS abertas da mesma pessoa: a ligação tem de funcionar mesmo assim
  const bia2 = await bia.ctx.newPage();
  bia2.on('pageerror', (e) => erros.push(`bia2: ${e}`));
  await bia2.goto(LOCAL + '/#/dashboard');
  await bia2.waitForSelector('#sino', { timeout: 20000 });
  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector(`[data-conv="${dm.conversa}"]`, { timeout: 20000 });
  await dono.p.click(`[data-conv="${dm.conversa}"]`);
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  await dono.p.click('#chLigar');
  // uma das duas abas toca; atende naquela
  const tocou = await Promise.race([
    bia.p.waitForSelector('#ligAceita', { timeout: 30000 }).then(() => bia.p).catch(() => null),
    bia2.waitForSelector('#ligAceita', { timeout: 30000 }).then(() => bia2).catch(() => null)
  ]);
  check('com duas abas abertas, a chamada toca em uma delas', tocou !== null);
  if (tocou) {
    await tocou.click('#ligAceita');
    const ok2 = await conectou(dono.p);
    check('e a ligação conecta mesmo com a outra aba aberta consumindo recados', ok2, String(ok2));
    await dono.p.evaluate(() => { ligSinal(lig.conversa, lig.com, 'desligou', {}); ligFechar(); }).catch(() => {});
    await tocou.evaluate(() => { try { ligFechar(); } catch {} }).catch(() => {});
    await dono.p.waitForTimeout(1200);
  }
  await bia2.close();

  // recusar
  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector(`[data-conv="${dm.conversa}"]`, { timeout: 20000 });
  await dono.p.click(`[data-conv="${dm.conversa}"]`);
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  await dono.p.click('#chLigar');
  await bia.p.waitForSelector('#ligRecusa', { timeout: 30000 });
  await bia.p.click('#ligRecusa');
  await dono.p.waitForFunction(() => /recusou/i.test(document.getElementById('ligCaixa')?.textContent || ''), { timeout: 20000 }).catch(() => {});
  check('recusar avisa quem ligou', /recusou/i.test(await dono.p.textContent('#ligCaixa').catch(() => '')), await dono.p.textContent('#ligCaixa').catch(() => 'sem painel'));

  check('nenhum erro de JavaScript', erros.length === 0, erros.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
