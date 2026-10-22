// A VOZ sai de verdade?
//
// O teste antigo de ligação provava a encanação: conexão estabelecida e faixa
// de áudio recebida. Isso passa mesmo sem sair som nenhum. O dono ligou da
// outra conta dele, viu os botões e NÃO OUVIU NADA.
//
// Aqui eu meço o que importa: se chegam amostras de áudio com energia e se o
// elemento de áudio está realmente tocando (não pausado, não mudo, volume > 0).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2], SHOTS = process.argv[3] || '/tmp';
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };

// Roda no navegador: liga um analisador no que o elemento está tocando e mede
// o pico das amostras durante ~2 segundos.
const MEDIR = async () => {
  const a = document.getElementById('ligAudio');
  const info = {
    existe: !!a,
    temSrc: !!(a && a.srcObject),
    pausado: a ? a.paused : null,
    mudo: a ? a.muted : null,
    volume: a ? a.volume : null,
    prontidao: a ? a.readyState : null,
    tempoTocado: a ? a.currentTime : null
  };
  if (!a || !a.srcObject) return info;
  info.faixas = a.srcObject.getAudioTracks().map((t) => ({ ligada: t.enabled, mudaNaOrigem: t.muted, estado: t.readyState }));
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') { try { await ac.resume(); } catch {} }
  const src = ac.createMediaStreamSource(a.srcObject);
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let pico = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    an.getByteTimeDomainData(buf);
    for (const v of buf) { const d = Math.abs(v - 128); if (d > pico) pico = d; }
  }
  info.energia = pico;          // 0 = silêncio absoluto; o microfone falso do Chromium gera um tom
  info.contexto = ac.state;
  try { ac.close(); } catch {}
  return info;
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chromium', headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
           '--autoplay-policy=no-user-gesture-required',
           '--auto-select-desktop-capture-source=Entire screen', '--auto-accept-this-tab-capture']
  });
  const erros = [];
  const conta = async (email, nome) => {
    const ctx = await browser.newContext({ viewport: { width: 1340, height: 900 }, baseURL: LOCAL, permissions: ['microphone'] });
    let r = await ctx.request.post(LOCAL + '/api/auth/register', { data: { email, password: 'senha12345', name: nome } });
    if (r.status() === 409) r = await ctx.request.post(LOCAL + '/api/auth/login', { data: { email, password: 'senha12345' } });
    if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(`${email}: ${e}`));
    return { ctx, p, req: ctx.request };
  };

  const dono = await conta('admin@example.com', 'Dono');
  const bia = await conta('voz.bia@example.com', 'Bia Voz');
  const biaId = (await (await dono.req.get(LOCAL + '/api/admin/users?q=voz.bia')).json()).items[0].id;
  await dono.req.post(LOCAL + '/api/admin/admins', { data: { email: 'voz.bia@example.com' } });
  const dm = await (await dono.req.post(LOCAL + '/api/admin/chats/dm', { data: { com: biaId } })).json();

  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector(`[data-conv="${dm.conversa}"]`, { timeout: 20000 });
  await bia.p.goto(LOCAL + '/#/admin/chats');
  await bia.p.waitForSelector('.ch-conv', { timeout: 20000 });

  await dono.p.click(`[data-conv="${dm.conversa}"]`);
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  await dono.p.click('#chLigar');
  await bia.p.waitForSelector('#ligAceita', { timeout: 30000 });
  // Enquanto ninguém atendeu, nada está tocando no alto-falante: é a única
  // janela em que dá para medir o microfone sem o cancelamento de eco no meio.
  let picoSozinho = 0;
  for (let i = 0; i < 25; i++) {
    await dono.p.waitForTimeout(120);
    picoSozinho = Math.max(picoSozinho, await dono.p.evaluate(() => parseFloat(document.querySelector('#ligNvEu')?.style.width) || 0));
  }
  check('o medidor do SEU microfone mexe (medido antes de atender, sem eco)', picoSozinho > 4, `pico=${picoSozinho}%`);
  await bia.p.click('#ligAceita');

  const conectou = async (pg) => {
    for (let i = 0; i < 50; i++) {
      const st = await pg.evaluate(() => (window.lig?.pc ? window.lig.pc.connectionState : 'sem-pc')).catch(() => 'erro');
      if (st === 'connected') return true;
      if (st === 'failed') return false;
      await pg.waitForTimeout(400);
    }
    return false;
  };
  const ok = (await conectou(dono.p)) && (await conectou(bia.p));
  check('a conexão entre os dois navegadores é estabelecida', ok);

  await dono.p.waitForTimeout(1500);
  const medDono = await dono.p.evaluate(MEDIR);
  const medBia = await bia.p.evaluate(MEDIR);
  console.log('\n  quem ligou  ->', JSON.stringify(medDono));
  console.log('  quem atendeu ->', JSON.stringify(medBia), '\n');

  for (const [quem, m] of [['quem ligou', medDono], ['quem atendeu', medBia]]) {
    check(`${quem}: o elemento de áudio existe e recebeu a faixa`, m.existe && m.temSrc, JSON.stringify(m));
    check(`${quem}: o áudio está TOCANDO (não pausado)`, m.pausado === false, `pausado=${m.pausado}`);
    check(`${quem}: não está mudo e o volume não é zero`, m.mudo === false && Number(m.volume) > 0, `mudo=${m.mudo} volume=${m.volume}`);
    check(`${quem}: o relógio do áudio andou (chegou som, não só a faixa)`, Number(m.tempoTocado) > 0, `currentTime=${m.tempoTocado}`);
    check(`${quem}: chegam amostras com energia (tem voz, não silêncio)`, Number(m.energia) > 2, `energia=${m.energia}`);
  }

  // ---------- medidor de nível: a barra tem de mexer ----------
  const barra = async (pg, id) => pg.evaluate((sel) => {
    const b = document.querySelector(sel);
    return b ? { largura: parseFloat(b.style.width) || 0, classe: b.className } : null;
  }, id);
  let picoEu = 0, picoOutro = 0;
  for (let i = 0; i < 25; i++) {
    await dono.p.waitForTimeout(120);
    const e = await barra(dono.p, '#ligNvEu'), o = await barra(dono.p, '#ligNvOutro');
    picoEu = Math.max(picoEu, e?.largura || 0);
    picoOutro = Math.max(picoOutro, o?.largura || 0);
  }
  check('o medidor do OUTRO mexe: é a prova visual de que chega som', picoOutro > 4, `pico=${picoOutro}%`);
  // Documentando o comportamento real, para ninguém achar que é defeito depois:
  // com som saindo no alto-falante, o cancelamento de eco derruba a captura.
  if (picoSozinho > picoEu) console.log(`  (nota) com o alto-falante tocando o outro lado, a barra do próprio microfone caiu de ${picoSozinho}% para ${picoEu}%: é o cancelamento de eco, e por isso a tela recomenda fone.`);

  // ---------- mudo ----------
  check('o botão de mudo existe durante a chamada', !!(await dono.p.$('#ligMudo')));
  await dono.p.click('#ligMudo');
  await dono.p.waitForTimeout(400);
  const mudou = await dono.p.evaluate(() => ({
    mudo: window.lig.mudo,
    faixa: window.lig.local.getAudioTracks()[0].enabled,
    rotulo: document.getElementById('ligMudo')?.textContent || ''
  }));
  check('mudo desliga a trilha do microfone de verdade', mudou.mudo === true && mudou.faixa === false, JSON.stringify(mudou));
  check('e o botão diz que está mudo', /Mudo/.test(mudou.rotulo), mudou.rotulo);
  await dono.p.waitForTimeout(500);
  const barraMuda = await barra(dono.p, '#ligNvEu');
  check('com o microfone mudo, a sua barra fica zerada', (barraMuda?.largura || 0) === 0, JSON.stringify(barraMuda));
  await dono.p.click('#ligMudo');
  await dono.p.waitForTimeout(300);
  check('desfazer o mudo religa a trilha', await dono.p.evaluate(() => window.lig.local.getAudioTracks()[0].enabled) === true);

  // ---------- câmera (mesmo caminho da tela) ----------
  check('o botão de câmera existe', !!(await dono.p.$('#ligCam')));
  check('o botão de compartilhar tela existe', !!(await dono.p.$('#ligTela')));
  await dono.p.click('#ligCam');
  const chegouVideo = await bia.p.waitForFunction(() => {
    const v = document.getElementById('ligVidRemoto');
    return !!(v && v.srcObject && v.srcObject.getVideoTracks().length && v.srcObject.getVideoTracks()[0].readyState === 'live');
  }, { timeout: 25000 }).then(() => true).catch(() => false);
  check('a imagem chega no outro lado depois de renegociar', chegouVideo);
  if (chegouVideo) {
    // o primeiro quadro leva um instante para decodificar: espera por ele
    await bia.p.waitForFunction(() => (document.getElementById('ligVidRemoto')?.videoWidth || 0) > 0, { timeout: 15000 }).catch(() => {});
    const vis = await bia.p.evaluate(() => {
      const cx = document.getElementById('ligVideo'), v = document.getElementById('ligVidRemoto');
      return { caixaVisivel: cx ? !cx.hasAttribute('hidden') : null, largura: v?.videoWidth || 0, tocando: v ? !v.paused : null };
    });
    check('o outro lado mostra a imagem na tela', vis.caixaVisivel === true && vis.largura > 0, JSON.stringify(vis));
  }
  const vozAindaOk = await bia.p.evaluate(MEDIR);
  check('a VOZ continua depois de ligar a imagem (a renegociação não derrubou o áudio)', Number(vozAindaOk.energia) > 2, `energia=${vozAindaOk.energia}`);
  await dono.p.click('#ligCam');
  await dono.p.waitForTimeout(1500);
  check('parar a câmera não derruba a ligação', await dono.p.evaluate(() => window.lig?.pc?.connectionState) === 'connected');

  // ---------- aviso de chamada com a aba em segundo plano ----------
  await dono.p.click('#ligFim').catch(() => {});
  await bia.p.waitForTimeout(1200);
  await bia.p.goto(LOCAL + '/#/admin/chats');
  await bia.p.waitForSelector('.ch-perm', { timeout: 20000 });
  const perm = await bia.p.textContent('.ch-perm');
  check('a aba de chats explica o aviso de chamada', /Autoriz|ligados|bloqueou|não tem notificações/i.test(perm), perm.slice(0, 90));
  // com permissão concedida pelo contexto do teste, o botão não deve nem aparecer
  const temBotao = !!(await bia.p.$('#chPerm'));
  check('com a permissão já concedida, o site não fica pedindo de novo', !temBotao || /Autorizar/.test(perm));

  await dono.p.goto(LOCAL + '/#/admin/chats');
  await dono.p.waitForSelector(`[data-conv="${dm.conversa}"]`, { timeout: 20000 });
  await dono.p.click(`[data-conv="${dm.conversa}"]`);
  await dono.p.waitForSelector('#chLigar', { timeout: 20000 });
  // a aba de quem recebe vai para segundo plano, como acontece de verdade
  const outra = await bia.ctx.newPage();
  await outra.goto('about:blank');
  await outra.bringToFront();
  await dono.p.click('#chLigar');
  await bia.p.waitForSelector('#ligAceita', { timeout: 30000 });
  const tocando = await bia.p.evaluate(() => ({
    toqueLigado: !!window.toque?.timer,
    escondida: document.hidden
  })).catch(() => ({}));
  check('a aba em segundo plano toca o alarme de chamada', tocando.toqueLigado === true, JSON.stringify(tocando));
  // o título alterna a cada 900ms: espera a vez do aviso em vez de ler uma vez
  const piscou = await bia.p.waitForFunction(() => /Chamada recebida/.test(document.title), { timeout: 8000 })
    .then(() => true).catch(() => false);
  check('e o título da aba pisca avisando da chamada', piscou, await bia.p.title());
  await bia.p.click('#ligRecusa');
  await bia.p.waitForTimeout(600);
  const parou = await bia.p.evaluate(() => ({ titulo: document.title, toqueLigado: !!window.toque?.timer }));
  check('recusar para o toque e devolve o título', parou.toqueLigado === false && !/Chamada recebida/.test(parou.titulo), JSON.stringify(parou));
  await outra.close();

  check('nenhum erro de JavaScript nas duas pontas', erros.length === 0, erros.slice(0, 3).join(' | '));
  await dono.p.screenshot({ path: SHOTS + '/voz-chamador.png' }).catch(() => {});
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
