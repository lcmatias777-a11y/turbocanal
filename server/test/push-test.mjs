// Aviso de chamada com o site fechado (Web Push).
//
// O que DÁ para testar aqui: chaves geradas e guardadas, inscrição aceita e
// validada, inscrição trocada em vez de duplicada, só o dono da inscrição
// mexe nela, a chave privada nunca sai no painel, e a chamada dispara o envio.
// O que NÃO dá: a entrega de verdade, que depende do serviço do navegador
// (Google/Mozilla) e de rede externa. Essa só se confirma no site publicado.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { signToken } = await import('../src/auth.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };
async function req(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function criar(email, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [id, email, null, email.split('@')[0], role, 'free', 5000, new Date().toISOString()]);
  return { id, email, token: await signToken(db, id) };
}
const inscricao = (n) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/exemplo-${n}`,
  keys: { p256dh: 'BG' + 'x'.repeat(85), auth: 'y'.repeat(22) }
});

const dono = await criar('dono@example.com', 'owner');
const adm = await criar('adm@example.com', 'admin');

console.log('\n== Chaves VAPID ==');
const k1 = await req('/api/push/chave', { token: adm.token });
check('o servidor entrega a chave pública', k1.status === 200 && typeof k1.data.chave === 'string' && k1.data.chave.length > 40, JSON.stringify(k1.data).slice(0, 80));
const k2 = await req('/api/push/chave', { token: dono.token });
check('a chave é a mesma em toda chamada (não regenera e invalida inscrição)', k1.data.chave === k2.data.chave);
check('a chave privada foi guardada no banco', !!(await db.get("SELECT value FROM settings WHERE key='vapid_private'"))?.value);
const semLogin = await req('/api/push/chave');
check('sem login não entrega a chave', semLogin.status === 401, String(semLogin.status));

console.log('\n== A chave privada nunca aparece no painel ==');
const cfg = await req('/api/admin/settings', { token: dono.token });
const txt = JSON.stringify(cfg.data);
const priv = (await db.get("SELECT value FROM settings WHERE key='vapid_private'")).value;
check('o painel não devolve o valor da chave privada', !txt.includes(priv), 'VAZOU A CHAVE PRIVADA');
check('a chave nem aparece na lista de configurações editáveis', cfg.data.settings?.vapid_private === undefined, JSON.stringify(cfg.data.settings?.vapid_private));
// Trocar a chave VAPID invalida TODA inscrição existente em silêncio: ninguém
// mais recebe chamada e nada no site denuncia isso. Por isso ela não é editável.
const tentaTrocar = await req('/api/admin/settings', { method: 'PUT', token: dono.token, body: { updates: { vapid_private: 'chave-falsa' } } });
check('nem o dono consegue trocar a chave pelo painel (quebraria todas as inscrições)', tentaTrocar.status === 400, String(tentaTrocar.status));
check('e a chave continua a mesma depois da tentativa', (await db.get("SELECT value FROM settings WHERE key='vapid_private'")).value === priv);

console.log('\n== Inscrição do aparelho ==');
const ass = await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: inscricao(1) } });
check('o aparelho se inscreve', ass.status === 200 && ass.data.ok === true, JSON.stringify(ass.data));
check('e fica um registro no banco', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 1);
await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: inscricao(1) } });
check('inscrever o MESMO aparelho de novo atualiza, não duplica', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 1);
await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: inscricao(2) } });
check('um segundo aparelho da mesma pessoa entra separado', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 2);

const ruim = await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: { endpoint: 'javascript:alert(1)', keys: { p256dh: 'a', auth: 'b' } } } });
check('endereço que não é https é recusado', ruim.status === 400, String(ruim.status));
const vazio = await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: { endpoint: 'https://fcm.googleapis.com/x' } } });
check('inscrição sem as chaves do navegador é recusada', vazio.status === 400, String(vazio.status));

console.log('\n== Cada um mexe só nos próprios aparelhos ==');
const meusAdm = await req('/api/push/meus', { token: adm.token });
const meusDono = await req('/api/push/meus', { token: dono.token });
check('o admin vê os dois aparelhos dele', meusAdm.data.itens?.length === 2, JSON.stringify(meusAdm.data).slice(0, 80));
check('o dono não vê aparelho de outra pessoa', meusDono.data.itens?.length === 0);
await req('/api/push/assinar', { method: 'DELETE', token: dono.token, body: { endpoint: inscricao(1).endpoint } });
check('apagar com a conta errada não tira a inscrição alheia', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 2);
await req('/api/push/assinar', { method: 'DELETE', token: adm.token, body: { endpoint: inscricao(1).endpoint } });
check('o próprio dono da inscrição consegue apagar', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 1);
check('os dados guardados não têm nada além do necessário',
  Object.keys(await db.get('SELECT * FROM push_subs LIMIT 1')).every((c) => ['id', 'user_id', 'endpoint', 'p256dh', 'auth', 'agente', 'criado_em', 'atualizado_em'].includes(c)));

console.log('\n== A chamada dispara o envio ==');
// Sem rede externa o envio falha; o que se prova aqui é que ele É TENTADO para
// a pessoa certa, e que falhar não derruba a ligação.
const { avisarChamada } = await import('../src/push.js');
let tentou = 0;
const webpush = (await import('web-push')).default;
const original = webpush.sendNotification;
webpush.sendNotification = async (sub) => { tentou++; if (!/fcm\.googleapis/.test(sub.endpoint)) throw new Error('endpoint errado'); return { statusCode: 201 }; };
const enviados = await avisarChamada(db, adm.id, 'Dona do Canal', 'conv-x');
check('a chamada vira aviso para o aparelho de quem recebe', tentou === 1 && enviados === 1, `tentou=${tentou} enviados=${enviados}`);
const nenhum = await avisarChamada(db, dono.id, 'Alguém', 'conv-x');
check('quem não inscreveu aparelho nenhum simplesmente não recebe', nenhum === 0);

webpush.sendNotification = async () => { const e = new Error('expirou'); e.statusCode = 410; throw e; };
await avisarChamada(db, adm.id, 'Dona do Canal', 'conv-x');
check('inscrição que o navegador descartou (410) é apagada sozinha', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 0);

await req('/api/push/assinar', { method: 'POST', token: adm.token, body: { inscricao: inscricao(3) } });
webpush.sendNotification = async () => { const e = new Error('fora do ar'); e.statusCode = 500; throw e; };
await avisarChamada(db, adm.id, 'Dona do Canal', 'conv-x');
check('erro temporário (500) NÃO apaga a inscrição', Number((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', [adm.id])).n) === 1);
webpush.sendNotification = original;

console.log('\n== O Service Worker é servido pelo site ==');
const sw = await fetch(base + '/sw.js');
const corpo = await sw.text();
check('/sw.js existe', sw.status === 200, String(sw.status));
check('e trata o aviso de chamada com Atender e Recusar', /addEventListener\('push'/.test(corpo) && /atender/.test(corpo) && /recusar/.test(corpo));
check('e não guarda página em cache (não entrega versão velha após deploy)', !/caches\.open|cache\.addAll/.test(corpo));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
