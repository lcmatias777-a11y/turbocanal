// IDOR: a pessoa B consegue ler, alterar ou apagar o que e da pessoa A
// sabendo o identificador? O teste de autenticacao nao pega isso, porque as
// duas estao logadas.
delete process.env.DATABASE_URL; process.env.PASSWORD_LOGIN='1'; process.env.YT_MOCK='1';
process.env.OWNER_EMAIL='dono@example.com';
import { randomUUID } from 'node:crypto';
const S='/home/claude/turbocanal/server';
const { buildApp } = await import(S+'/src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir:':memory:', scheduler:false });
const srv = app.listen(0); await new Promise(r=>srv.on('listening',r));
const base=`http://127.0.0.1:${srv.address().port}`;
const { signToken } = await import(S+'/src/auth.js');
let pass=0, fail=0;
const check=(n,c,x='')=>{ if(c){pass++;console.log('  PASSOU  '+n);} else {fail++;console.log('  FALHOU  '+n+' '+x);} };
async function conta(email,role='user'){
  const id=randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id,email,null,email.split('@')[0],role,'free',999999,'2099-12',new Date().toISOString()]);
  return { id, token: await signToken(db,id) };
}
const A=await conta('a@example.com'), B=await conta('b@example.com');
const req=async(p,m='GET',body,tk)=>{const r=await fetch(base+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tk},body:body?JSON.stringify(body):undefined});let d={};try{d=await r.json();}catch{} return {s:r.status,d};};
const negou=(s)=>s===403||s===404||s===401;

await req('/api/canal-teste','POST',{ligado:true},A.token);
await req('/api/canal-teste','POST',{ligado:true},B.token);

// A cria coisas
const pl=await req('/api/channel/playlists','POST',{title:'playlist da A'},A.token);
const plId=pl.d.result?.id||pl.d.id;
const ex=await req('/api/experimentos','POST',{hipotese:'h da A',mudanca:'m',metrica:'views',revisao:'2026-12-01'},A.token);
const exId=ex.d.id;
const ch=await req('/api/chat-publico','POST',{texto:'mensagem da A no bate-papo'},A.token);
const chId=ch.d.id||ch.d.mensagem?.id;
const rv=await req('/api/reviews','POST',{stars:5,comment:'avaliacao da A'},A.token);
const rvId=rv.d.avaliacao?.id;

console.log('\n== B tenta mexer no que e da A ==');
if (plId) {
  check('B nao apaga a playlist da A', negou((await req(`/api/channel/playlists/${plId}/items/qualquer`,'DELETE',null,B.token)).s));
  const vistas=await req('/api/channel/playlists','GET',null,B.token);
  check('B nao ve a playlist da A na lista dele', !JSON.stringify(vistas.d).includes('playlist da A'), JSON.stringify(vistas.d).slice(0,100));
}
if (exId) {
  check('B nao apaga o experimento da A', negou((await req('/api/experimentos/'+exId,'DELETE',null,B.token)).s));
  check('B nao conclui o experimento da A', negou((await req('/api/experimentos/'+exId+'/concluir','POST',{conclusao:'roubei'},B.token)).s));
  const meus=await req('/api/experimentos','GET',null,B.token);
  check('B nao ve o experimento da A', !JSON.stringify(meus.d).includes('h da A'), JSON.stringify(meus.d).slice(0,100));
}
if (chId) check('B nao apaga a mensagem da A no bate-papo', negou((await req('/api/chat-publico/'+chId,'DELETE',{motivo:'x'},B.token)).s));
if (rvId) {
  check('B nao apaga a avaliacao da A', negou((await req('/api/reviews/'+rvId,'DELETE',null,B.token)).s));
  check('B nao edita a avaliacao da A', negou((await req('/api/reviews/'+rvId,'PUT',{stars:1,comment:'sequestrada'},B.token)).s));
}
console.log('\n== B tenta ler a conta da A ==');
check('B nao le o historico da A', negou((await req('/api/history?user='+A.id,'GET',null,B.token)).s) || !JSON.stringify((await req('/api/history?user='+A.id,'GET',null,B.token)).d).includes(A.id));
check('B nao le as notificacoes da A', !JSON.stringify((await req('/api/notifications','GET',null,B.token)).d).includes('da A'));
check('B nao vira admin sozinho', negou((await req('/api/admin/users','GET',null,B.token)).s));
check('B nao ajusta os proprios creditos', negou((await req(`/api/admin/users/${B.id}/credits`,'POST',{delta:1000000},B.token)).s));
check('B nao muda o proprio plano', negou((await req(`/api/admin/users/${B.id}/plan`,'POST',{plan_id:'pro'},B.token)).s));
check('B nao confirma pagamento', negou((await req('/api/admin/payments/qualquer/confirm','POST',{},B.token)).s));

console.log('\n== A integridade dos creditos ==');
const saldo=async(u)=>Number((await db.get('SELECT credits FROM users WHERE id=?',[u.id])).credits);
const antes=await saldo(B);
// mesma chave de idempotencia, duas vezes ao mesmo tempo
const duas=await Promise.all([
  fetch(base+'/api/tools/video_search',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':'mesma-chave-123',Authorization:'Bearer '+B.token},body:JSON.stringify({q:'minecraft'})}),
  fetch(base+'/api/tools/video_search',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':'mesma-chave-123',Authorization:'Bearer '+B.token},body:JSON.stringify({q:'minecraft'})})
]);
const depois=await saldo(B);
check('duas chamadas iguais ao mesmo tempo cobram no maximo uma vez',
  antes-depois <= 4, `${antes} -> ${depois} (diferenca ${antes-depois})`);

// ferramenta que falha tem de estornar
const antes2=await saldo(B);
await req('/api/tools/video_analysis','POST',{video:'id-que-nao-existe-nenhum'},B.token);
const depois2=await saldo(B);
check('ferramenta que falha devolve o credito', antes2===depois2, `${antes2} -> ${depois2}`);

// com o canal de teste DESLIGADO a cobranca tem de voltar a acontecer,
// senao o "nao cobra no teste" teria desligado a cobranca do site inteiro
await req('/api/canal-teste','POST',{ligado:false},B.token);
const antes3=await saldo(B);
await req('/api/tools/video_search','POST',{q:'minecraft'},B.token);
const depois3=await saldo(B);
check('fora do canal de teste a cobranca volta a acontecer', depois3 < antes3, `${antes3} -> ${depois3}`);
// e dentro dele nao cobra
await req('/api/canal-teste','POST',{ligado:true},B.token);
const antes4=await saldo(B);
await req('/api/tools/video_search','POST',{q:'terraria'},B.token);
check('e dentro do canal de teste volta a nao cobrar', (await saldo(B))===antes4, String(await saldo(B)));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
srv.close(); process.exit(fail?1:0);
