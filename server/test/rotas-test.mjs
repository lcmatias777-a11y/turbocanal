// Censo de autenticacao: bate TODAS as rotas registradas sem login, com
// usuario comum e com administrador, e reprova se alguma responder o que nao
// devia. Rota nova sem protecao aparece aqui pelo nome.
process.env.OWNER_EMAIL='dono@example.com';
import { randomUUID } from 'node:crypto';
const S='/home/claude/turbocanal/server';
const { buildApp } = await import(S+'/src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir:':memory:', scheduler:false });
const srv = app.listen(0); await new Promise(r=>srv.on('listening',r));
const base=`http://127.0.0.1:${srv.address().port}`;
const { signToken } = await import(S+'/src/auth.js');

async function conta(email, role='user'){
  const id=randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id,email,null,email.split('@')[0],role,'free',999999,'2099-12',new Date().toISOString()]);
  return { id, token: await signToken(db,id) };
}
const dono=await conta('dono@example.com','owner');
const adm=await conta('adm@example.com','admin');
const user=await conta('user@example.com');

// enumera as rotas de verdade
const rotas=[];
for (const l of app._router.stack) {
  if (l.route) for (const m of Object.keys(l.route.methods)) rotas.push([m.toUpperCase(), String(l.route.path)]);
}
const url=(p)=>p.replace(/:[a-zA-Z_]+/g,'00000000-0000-4000-8000-000000000000');
async function bate(metodo, caminho, token){
  try{
    const r=await fetch(base+url(caminho),{method:metodo,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      body:['GET','HEAD','DELETE'].includes(metodo)?undefined:'{}'});
    return r.status;
  }catch(e){ return 'erro:'+e.message.slice(0,30); }
}

// Publicas de proposito, conferidas uma a uma. O webhook de pagamento esta
// aqui porque ele NAO confia no corpo da requisicao: ele busca o pagamento
// no Mercado Pago antes de liberar qualquer coisa.
const PUBLICAS=/^(\*|\/privacidade|\/termos|\/api\/(health|settings\/public|tools\/costs|payments\/webhook|auth\/(register|login|google|logout|token)|public|plans|reviews|comments|replies|votes|reports|extension|blocks|estatisticas|canal-teste\/(capa|avatar|banner)))/;
console.log(`rotas registradas: ${rotas.length}\n`);
const suspeitas=[];
for (const [m,p] of rotas.filter(r=>typeof r[1]==='string').sort((a,b)=>a[1]<b[1]?-1:1)) {
  const anon=await bate(m,p,null);
  const comum=await bate(m,p,user.token);
  const admin=await bate(m,p,adm.token);
  const ehPublica=PUBLICAS.test(p);
  const ehAdmin=p.startsWith('/api/admin/');
  const problemas=[];
  if (!ehPublica && anon !== 401 && anon !== 403 && anon !== 404) problemas.push(`SEM LOGIN responde ${anon}`);
  if (ehAdmin && comum !== 403 && comum !== 401) problemas.push(`usuario comum responde ${comum}`);
  if (problemas.length) suspeitas.push(`${m.padEnd(6)} ${p.padEnd(46)} ${problemas.join(' | ')}`);
}
console.log(suspeitas.length? 'SUSPEITAS:\n'+suspeitas.join('\n') : '  PASSOU  nenhuma das '+rotas.length+' rotas responde sem a protecao esperada');
console.log(`\nRESULTADO: ${suspeitas.length?0:1} passaram, ${suspeitas.length} falharam.`);
srv.close(); process.exit(suspeitas.length?1:0);
