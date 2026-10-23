// Lixo em toda rota de escrita.
//
// 400/403/404/409/422 e recusa correta. 500 e o servidor quebrando, e isso
// e bug: entrada ruim de usuario nunca deveria derrubar uma rota.
process.env.OWNER_EMAIL='dono@example.com';
import { randomUUID } from 'node:crypto';
const S='/home/claude/turbocanal/server';
const { buildApp } = await import(S+'/src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir:':memory:', scheduler:false });
const srv = app.listen(0); await new Promise(r=>srv.on('listening',r));
const base=`http://127.0.0.1:${srv.address().port}`;
const { signToken } = await import(S+'/src/auth.js');
const id=randomUUID();
await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  [id,'dono@example.com',null,'Dono','owner','free',999999,'2099-12',new Date().toISOString()]);
const token=await signToken(db,id);

const GRANDE='A'.repeat(200000);
const CARGAS=[
  ['vazio', {}],
  ['nulos', {titulo:null,texto:null,nome:null,email:null,video:null,id:null,delta:null,valor:null}],
  ['numero onde espera texto', {titulo:123,texto:456,nome:789,email:1,video:2,q:3,topic:4,comment:5,title:6}],
  ['array onde espera objeto', {titulo:[1,2],texto:['a'],tags:'nao e array',opcoes:{},video:[],image:[]}],
  ['texto gigante', {titulo:GRANDE,texto:GRANDE,q:GRANDE,topic:GRANDE,comment:GRANDE,nome:GRANDE,title:GRANDE,description:GRANDE}],
  ['negativos e infinito', {delta:-99999999999,valor:-1,dias:-5,hours:-1,max:1e308,limite:Number.MAX_SAFE_INTEGER,opcao:-1}],
  ['string onde espera numero', {delta:'abc',dias:'xx',hours:'yy',opcao:'zz',cost:'ww',amount:'qq'}],
  ['objeto aninhado fundo', {titulo:{a:{b:{c:{d:{e:{f:{g:1}}}}}}}}],
];
const rotas=[];
for (const l of app._router.stack) if (l.route) {
  const p=String(l.route.path);
  for (const m of Object.keys(l.route.methods)) {
    const M=m.toUpperCase();
    if (['POST','PUT','PATCH','DELETE'].includes(M) && p.startsWith('/api/')) rotas.push([M,p]);
  }
}
const url=(p)=>p.replace(/:[a-zA-Z_]+/g,'00000000-0000-4000-8000-000000000000');
console.log(`rotas de escrita: ${rotas.length}, cargas: ${CARGAS.length}\n`);
const quebras=[];
for (const [m,p] of rotas) {
  for (const [nome,carga] of CARGAS) {
    let st, txt='';
    try{
      const r=await fetch(base+url(p),{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(carga)});
      st=r.status; txt=(await r.text()).slice(0,110);
    }catch(e){ st='conexao caiu'; txt=e.message.slice(0,60); }
    if (st===500 || st==='conexao caiu') quebras.push(`${m} ${p}  [${nome}]  -> ${st}  ${txt.replace(/\s+/g,' ')}`);
  }
}
console.log(quebras.length? 'QUEBROU EM:\n'+quebras.join('\n') : '  PASSOU  nenhuma das '+rotas.length+' rotas de escrita devolveu 500 com entrada ruim');
console.log(`\nRESULTADO: ${quebras.length?0:1} passaram, ${quebras.length} falharam.`);
srv.close(); process.exit(quebras.length?1:0);
