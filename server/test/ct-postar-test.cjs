// Postar vídeo no canal de teste, pela TELA.
//
// O servidor já é coberto por teste de API, mas ali o envio vai com cabeçalho
// de autorização. Pela tela ele vai por cookie, num <input type=file> de
// verdade, e o endereço de envio é o que o próprio site devolveu. É esse
// caminho que a pessoa usa, então é esse que precisa estar provado.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass=0, fail=0;
const check=(n,c,x='')=>{ if(c){pass++;console.log('  PASSOU ',n);} else {fail++;console.log('  FALHOU ',n,x);} };
(async () => {
  const b = await chromium.launch({ channel:'chromium', headless:true, args:['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
  const email = 'post'+Date.now()+'@example.com';
  const r = await ctx.request.post(LOCAL+'/api/auth/register',{data:{email,password:'senha12345',name:'Postador'}});
  if(!r.ok()) throw new Error('registro: '+r.status());
  await ctx.request.post(LOCAL+'/api/canal-teste',{data:{ligado:true}});
  const p = await ctx.newPage();
  const erros=[]; p.on('pageerror',e=>erros.push(String(e).slice(0,120)));
  p.on('dialog', d=>d.accept());

  await p.goto(LOCAL+'/#/canal/postar');
  await p.waitForSelector('#pf', { timeout:20000 });
  check('a tela de postar abre no canal de teste', true);
  check('e avisa que o vídeo NÃO vai para o YouTube', /não vai para o YouTube/i.test(await p.textContent('#app')));
  check('e que ali não cobra crédito', /grátis no teste/i.test(await p.textContent('#app')));

  // arquivo de vídeo de mentira, mas arquivo de verdade
  await p.setInputFiles('#pf input[type=file]', { name:'meu-video.mp4', mimeType:'video/mp4', buffer: Buffer.alloc(64*1024, 7) });
  await p.fill('#pf [name=title]', 'Primeiro vídeo postado no teste');
  await p.fill('#pf [name=description]', 'postado pela tela');
  await p.click('#pf button[type=submit], #pf .btn');
  await p.waitForTimeout(9000);
  const msg = (await p.textContent('#pmsg').catch(()=>''))||'';
  const corpo = await p.textContent('#app');
  check('o envio termina sem erro', !/err|falh|não foi possível/i.test(msg) , msg.replace(/\s+/g,' ').slice(0,140));

  await p.goto(LOCAL+'/#/canal/videos');
  await p.waitForSelector('.thumbrow', { timeout:20000 });
  const lista = await p.textContent('#app');
  check('e o vídeo aparece na lista do canal de teste', /Primeiro vídeo postado no teste/.test(lista),
    lista.replace(/\s+/g,' ').slice(0,160));
  check('entrando com zero view (nada de estreia inventada)',
    /Primeiro vídeo postado no teste[\s\S]{0,120}?👁 0/.test(lista.replace(/\s+/g,' ')) || /👁 0/.test(lista));
  check('nenhum erro de JavaScript', erros.length===0, erros.slice(0,2).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1);});
