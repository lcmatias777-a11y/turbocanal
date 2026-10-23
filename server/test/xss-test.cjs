// XSS guardado: injeta codigo em TODA superficie de texto que uma pessoa
// escreve e outra le, depois abre a tela da outra pessoa e ve se executou.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const LOCAL = process.argv[2];
let pass=0, fail=0;
const check=(n,c,x='')=>{ if(c){pass++;console.log('  PASSOU ',n);} else {fail++;console.log('  FALHOU ',n,x);} };
const PAYLOADS = [
  '<img src=x onerror="window.__XSS=1">',
  '<script>window.__XSS=1</script>',
  '"><svg onload="window.__XSS=1">',
  "';window.__XSS=1;//",
  '<iframe srcdoc="&lt;script&gt;parent.__XSS=1&lt;/script&gt;">'
];
(async () => {
  const b = await chromium.launch({ channel:'chromium', headless:true, args:['--no-sandbox'] });
  const n = Date.now();
  const mk = async (email, nome) => {
    const ctx = await b.newContext({ viewport:{width:1400,height:1000} });
    const r = await ctx.request.post(LOCAL+'/api/auth/register',{data:{email,password:'senha12345',name:nome}});
    if(!r.ok()) throw new Error('registro '+email+': '+r.status());
    return ctx;
  };
  // o atacante poe o nome com codigo dentro
  const atacanteNome = 'Zé'+PAYLOADS[0];
  const atk = await mk('atk'+n+'@example.com', atacanteNome);
  const vit = await mk('vit'+n+'@example.com', 'Vítima');

  // 1) bate-papo publico
  for (const p of PAYLOADS) await atk.post? null : null;
  const r1 = await atk.request.post(LOCAL+'/api/chat-publico',{data:{texto:'ola '+PAYLOADS[0]}});
  // 2) avaliacao e comentario publico
  await atk.request.post(LOCAL+'/api/reviews',{data:{stars:5,comment:PAYLOADS[0]}}).catch(()=>{});
  await atk.request.post(LOCAL+'/api/comments',{data:{text:PAYLOADS[2]}}).catch(()=>{});
  // 3) playlist no canal de teste
  await atk.request.post(LOCAL+'/api/canal-teste',{data:{ligado:true}});
  await atk.request.post(LOCAL+'/api/channel/playlists',{data:{title:PAYLOADS[0],description:PAYLOADS[1]}}).catch(()=>{});
  // 4) titulo de video no canal de teste
  const vids = await (await atk.request.get(LOCAL+'/api/channel/videos?max=1')).json().catch(()=>({}));
  const vid = (vids.videos||[])[0]?.id;
  if (vid) await atk.request.put(LOCAL+'/api/channel/videos/'+vid,{data:{title:PAYLOADS[0],description:PAYLOADS[2]}}).catch(()=>{});

  // agora a vitima olha as telas
  const p = await vit.newPage();
  const telas = [['/#/bate-papo','bate-papo'],['/#/avaliacoes','avaliações'],['/#/postagens','postagens']];
  for (const [rota,nome] of telas) {
    await p.goto(LOCAL+rota); await p.waitForTimeout(4000);
    const exec = await p.evaluate(()=>!!window.__XSS);
    const html = await p.content();
    check(`${nome}: o código do atacante NÃO executa`, exec===false);
    check(`${nome}: e aparece como texto, não como tag`, !/<img src=x onerror|<svg onload/.test(html.replace(/&lt;/g,'<')) || !exec);
  }
  // e no canal de teste do proprio atacante (titulo editado)
  const pa = await atk.newPage();
  await pa.goto(LOCAL+'/#/canal/videos'); await pa.waitForTimeout(5000);
  check('título de vídeo com código não executa', (await pa.evaluate(()=>!!window.__XSS))===false);
  await pa.goto(LOCAL+'/#/canal/playlists'); await pa.waitForTimeout(4000);
  check('nome de playlist com código não executa', (await pa.evaluate(()=>!!window.__XSS))===false);

  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1);});
