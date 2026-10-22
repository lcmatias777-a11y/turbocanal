// A guarda de escrita: ela classifica a ESCRITA, não a rota.
//
// O censo de rotas (fila-test.mjs) obriga toda rota administrativa de escrita
// a estar classificada. Ele não pega o erro inverso: eu marcar uma rota como
// inofensiva e mexer em crédito, plano, preço, pagamento ou configuração lá
// dentro. Este arquivo prova que, se isso acontecer, a escrita NÃO acontece.
//
// O teste registra de propósito rotas administrativas mal feitas, que tentam
// escrever direto sem passar pela fila, e exige que todas sejam barradas.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const G = await import('../src/guarda.js');
const { makeAuth, signToken } = await import('../src/auth.js');
const auth = makeAuth(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };

/* ---- escritas administrativas mal feitas, DE PROPÓSITO ---- */
// Em vez de registrar rotas (o app já tem o "404 de API" no fim da pilha),
// o teste simula o contexto de uma requisição administrativa e manda a
// escrita direto no banco: é exatamente o que uma rota mal feita faria.
const BURACOS = {
  credito: (ids) => db.run('UPDATE users SET credits=? WHERE id=?', [999999, ids.vitima]),
  plano_conta: (ids) => db.run("UPDATE users SET plan_id='pro' WHERE id=?", [ids.vitima]),
  cargo: (ids) => db.run("UPDATE users SET role='owner' WHERE id=?", [ids.vitima]),
  banir: (ids) => db.run('UPDATE users SET banido=1 WHERE id=?', [ids.vitima]),
  plano: () => db.run("INSERT INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES('pirata','Pirata',0,99999,9,1,'')"),
  preco: () => db.run("UPDATE tool_costs SET cost=0 WHERE tool='video_search'"),
  config: () => db.run("INSERT INTO settings(key,value) VALUES('mp_access_token','roubado') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"),
  aviso: () => db.run("INSERT INTO blocos(id,tipo,pagina,slot,titulo,texto,emoji,link,link_texto,ordem,publicado,created_at,updated_at) VALUES('x','aviso','home','topo','oi','','','','',0,1,'2026-01-01','2026-01-01')")
};
/** Roda a escrita como se fosse uma rota administrativa que NÃO passou pela
 *  fila. Devolve o erro, se a guarda barrou. */
function comoRotaMalFeita(nome, ids) {
  return G.contexto.run({ rota: `POST /api/admin/buraco-${nome}`, rotaAdmin: true, autorizado: null },
    async () => { try { await BURACOS[nome](ids); return null; } catch (e) { return e; } });
}

const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
async function req(path, { method = 'POST', body, token } = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function criar(email, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, email, null, email.split('@')[0], role, 'free', 5000, '2099-12', new Date().toISOString()]);
  return { id, email, token: await signToken(db, id) };
}

/* ===================== 1) Reconhecer a escrita ===================== */
console.log('\n== A guarda reconhece o que é escrita perigosa ==');
const emAdmin = { rotaAdmin: true }, foraDeAdmin = { rotaAdmin: false };
check('ajuste de créditos numa rota administrativa é perigoso',
  G.classificar('UPDATE users SET credits=? WHERE id=?', emAdmin)?.tabela === 'users');
check('troca de plano de conta também', !!G.classificar("UPDATE users SET plan_id='pro' WHERE id=?", emAdmin));
check('troca de cargo também', !!G.classificar("UPDATE users SET role='admin' WHERE id=?", emAdmin));
check('criar plano é perigoso em QUALQUER rota', !!G.classificar('INSERT INTO plans(id) VALUES(?)', foraDeAdmin));
check('mudar preço de ferramenta é perigoso em qualquer rota', !!G.classificar('UPDATE tool_costs SET cost=? WHERE tool=?', foraDeAdmin));
check('avisos e cards também', !!G.classificar('DELETE FROM blocos WHERE id=?', foraDeAdmin));
check('configuração é vigiada dentro do painel', !!G.classificar('UPDATE settings SET value=? WHERE key=?', emAdmin));
check('e FORA do painel a configuração passa (contador de cota, token de setup)',
  G.classificar('UPDATE settings SET value=? WHERE key=?', foraDeAdmin) === null);
check('gastar crédito numa ferramenta (fora do painel) não é escrita de administrador',
  G.classificar('UPDATE users SET credits=? WHERE id=?', foraDeAdmin) === null);
check('leitura nunca é escrita perigosa', G.classificar('SELECT credits FROM users WHERE id=?', emAdmin) === null);
check('escrever notificação não é perigoso', G.classificar('INSERT INTO notificacoes(id) VALUES(?)', emAdmin) === null);
check('escrever no histórico não é perigoso', G.classificar('INSERT INTO audit(id) VALUES(?)', emAdmin) === null);

/* ===================== 2) Barrar de verdade ===================== */
console.log('\n== Escrita administrativa fora da fila NÃO acontece ==');
const admin = await criar('admin2@example.com', 'admin');
const vitima = await criar('vitima@example.com');
const IDS = { vitima: vitima.id };
const saldo = async () => Number((await db.get('SELECT credits FROM users WHERE id=?', [vitima.id])).credits);
const antes = await saldo();

for (const nome of Object.keys(BURACOS)) {
  const e = await comoRotaMalFeita(nome, IDS);
  check(`"${nome}": a escrita é barrada`, !!e && /bloqueada pela guarda/i.test(String(e.message)), String(e && e.message).slice(0, 100));
}
const erro = await comoRotaMalFeita('credito', IDS);
check('o erro diz a rota, a tabela e o que fazer',
  /buraco-credito/.test(erro.message) && /users/.test(erro.message) && /pedirOuFazer/.test(erro.message));
check('e deixa claro que é erro de programação, não do usuário', /erro de programação/i.test(erro.message));

check('o saldo da vítima não mudou nada', (await saldo()) === antes, `${antes} -> ${await saldo()}`);
check('nenhum plano pirata foi criado', !(await db.get("SELECT 1 AS x FROM plans WHERE id='pirata'")));
check('o preço da ferramenta continua o mesmo',
  Number((await db.get("SELECT cost FROM tool_costs WHERE tool='video_search'")).cost) > 0);
const mp = await db.get("SELECT value FROM settings WHERE key='mp_access_token'");
check('o token do Mercado Pago não foi gravado', !mp || mp.value !== 'roubado', JSON.stringify(mp));
check('nenhum aviso foi criado', !(await db.get("SELECT 1 AS x FROM blocos WHERE id='x'")));

/* ===================== 3) Sem falso positivo ===================== */
console.log('\n== E não barra o que é inofensivo nem o caminho certo ==');
let inofensiva = 'barrou';
await G.contexto.run({ rota: 'POST /api/admin/qualquer', rotaAdmin: true, autorizado: null }, async () => {
  try {
    await db.run('INSERT INTO audit(id,actor_id,actor_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)',
      [randomUUID(), vitima.id, vitima.email, 'teste.inofensivo', '', '', new Date().toISOString()]);
    inofensiva = 'passou';
  } catch {}
});
check('escrita administrativa inofensiva (histórico) continua passando', inofensiva === 'passou');

const dono = await criar('dono@example.com', 'owner');
const certo = await req(`/api/admin/users/${vitima.id}/credits`, { token: dono.token, body: { delta: 50, note: 'teste' } });
check('o caminho CERTO (principal, pela fila) escreve normalmente', certo.status === 200, JSON.stringify(certo.data).slice(0, 110));
check('e os créditos entraram mesmo', (await saldo()) === antes + 50, `${antes} -> ${await saldo()}`);

const pedido = await req(`/api/admin/users/${vitima.id}/credits`, { token: admin.token, body: { delta: 70, note: 'posso?' } });
check('o admin comum continua conseguindo PEDIR', pedido.status === 202, String(pedido.status));
check('e pedir não mexeu no saldo', (await saldo()) === antes + 50);
const pid = pedido.data.pedido;
const sim = await req(`/api/admin/pedidos/${pid}/decidir`, { token: dono.token, body: { decisao: 'sim' } });
check('o Sim do principal executa e a guarda deixa', sim.status === 200, JSON.stringify(sim.data).slice(0, 110));
check('e aí sim o saldo muda', (await saldo()) === antes + 120, String(await saldo()));

/* ===================== 4) semGuarda é estreito ===================== */
console.log('\n== O desligamento explícito vale só para o trecho dele ==');
let dentro = null, depois = null;
await G.contexto.run({ rota: 'TESTE', rotaAdmin: true, autorizado: null }, async () => {
  await G.semGuarda(() => { dentro = G.conferir('UPDATE tool_costs SET cost=0') ?? 'passou'; });
  try { G.conferir('UPDATE tool_costs SET cost=0'); depois = 'passou'; } catch { depois = 'barrou'; }
});
check('dentro de semGuarda a escrita passa', dentro === 'passou', String(dentro));
check('e logo depois dele a guarda volta a barrar', depois === 'barrou', String(depois));

console.log('\n== Fora de requisição (agendador, migração) nada é barrado ==');
let fora = 'barrou';
try { G.conferir('UPDATE tool_costs SET cost=0'); fora = 'passou'; } catch {}
check('migração e agendador escrevem normalmente', fora === 'passou');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
