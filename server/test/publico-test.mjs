// Bate-papo público: um canal só, filtro na porta, e nada do que foi barrado
// guardado em lugar nenhum.

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
const manda = (u, texto) => req('/api/chat-publico', { method: 'POST', token: u.token, body: { texto } });

const dono = await criar('dono@example.com', 'owner');
const adm = await criar('adm@example.com', 'admin');
const ana = await criar('ana@example.com');
const bia = await criar('bia@example.com');
const caio = await criar('caio@example.com');
const dede = await criar('dede@example.com');

console.log('\n== É um canal só, e precisa estar logado ==');
const semLogin = await req('/api/chat-publico');
check('sem login não lê o bate-papo', semLogin.status === 401, String(semLogin.status));
const ok1 = await manda(ana, 'oi gente, alguem grava de terror?');
check('usuário comum escreve', ok1.status === 200 && ok1.data.ok === true, JSON.stringify(ok1.data).slice(0, 120));
const lista = await req('/api/chat-publico', { token: bia.token });
check('todo mundo lê a mesma conversa', lista.data.itens?.some((m) => /terror/.test(m.texto)), JSON.stringify(lista.data.itens || []).slice(0, 120));
check('a mensagem mostra quem escreveu', lista.data.itens.at(-1).autor === 'ana');
check('não existe rota de conversa privada aqui', (await req('/api/chat-publico/dm', { method: 'POST', token: ana.token, body: { com: bia.id } })).status === 404);

console.log('\n== O que não passa ==');
const casos = [
  ['link', 'entra em https://vendeconta.com'],
  ['telefone', 'meu numero 54 98439-8807'],
  ['e-mail', 'manda pra fulano@gmail.com'],
  ['contato por fora', 'me chama no zap'],
  ['link por extenso', 'acessa meucanal ponto com']
];
for (const [nome, texto] of casos) {
  const r = await manda(bia, texto);
  check(`${nome} é barrado na porta`, r.status === 422, `(${r.status}) ${JSON.stringify(r.data).slice(0, 110)}`);
}
const guardadas = await db.all('SELECT texto FROM chat_publico');
check('NADA do que foi barrado foi guardado',
  !guardadas.some((m) => /98439|gmail\.com|vendeconta|meucanal/.test(m.texto)), JSON.stringify(guardadas).slice(0, 160));
check('o site guarda só o MOTIVO do bloqueio', Number((await db.get('SELECT COUNT(*) AS n FROM chat_bloqueios')).n) === casos.length);
const motivos = await db.all('SELECT motivos FROM chat_bloqueios');
check('e o motivo não carrega o texto barrado', !JSON.stringify(motivos).match(/98439|gmail\.com/), JSON.stringify(motivos).slice(0, 120));

console.log('\n== O que é tapado mas passa ==');
const leve = await manda(caio, 'seu idiota kkkk');
check('ofensa leve passa com o pedaço tapado', leve.status === 200 && /#/.test(leve.data.mensagem.texto), JSON.stringify(leve.data).slice(0, 120));
check('e a pessoa é avisada do que sumiu', /escondida/i.test(leve.data.aviso || ''), leve.data.aviso);
check('a mensagem fica marcada como filtrada', leve.data.mensagem.filtrada === true);

console.log('\n== Conta banida não escreve ==');
await db.run('UPDATE users SET banido=1 WHERE id=?', [dede.id]);
const banido = await manda(dede, 'oi');
check('banido recebe recusa', banido.status === 403, `(${banido.status}) ${JSON.stringify(banido.data).slice(0, 90)}`);
await db.run('UPDATE users SET banido=0 WHERE id=?', [dede.id]);

console.log('\n== Limite de ritmo ==');
let barrouNo = 0;
for (let i = 1; i <= 16; i++) {
  const r = await manda(dede, 'mensagem numero ' + i);
  if (r.status === 429) { barrouNo = i; break; }
}
check('spam é barrado antes de encher a tela', barrouNo > 0 && barrouNo <= 14, `barrou na ${barrouNo}`);
const repetidas = await db.all('SELECT id FROM chat_publico WHERE user_id=?', [dede.id]);
check('e as que passaram ficaram abaixo do limite', repetidas.length <= 12, String(repetidas.length));

console.log('\n== Tamanho ==');
const gigante = await manda(ana, 'a'.repeat(500));
check('mensagem longa demais é recusada', gigante.status === 400, String(gigante.status));
const vazia = await manda(ana, '   ');
check('mensagem vazia é recusada', vazia.status === 400, String(vazia.status));

console.log('\n== Apagar ==');
const minha = await manda(ana, 'essa eu mesma apago depois');
const apagoMinha = await req(`/api/chat-publico/${minha.data.mensagem.id}`, { method: 'DELETE', token: ana.token });
check('o autor apaga a própria mensagem na hora', apagoMinha.status === 200 && apagoMinha.data.executado === true);
check('e ela some da lista', !(await req('/api/chat-publico', { token: bia.token })).data.itens.some((m) => m.id === minha.data.mensagem.id));

const dela = await manda(bia, 'mensagem da bia para o teste');
const outroTenta = await req(`/api/chat-publico/${dela.data.mensagem.id}`, { method: 'DELETE', token: caio.token });
check('usuário comum não apaga mensagem alheia', outroTenta.status === 403, String(outroTenta.status));
const admTenta = await req(`/api/chat-publico/${dela.data.mensagem.id}`, { method: 'DELETE', token: adm.token, body: { motivo: 'fora de assunto' } });
check('admin não principal PEDE para apagar, não apaga', admTenta.status === 202 && admTenta.data.executado === false, JSON.stringify(admTenta.data).slice(0, 110));
check('a mensagem continua no ar antes do Sim', (await db.get('SELECT status FROM chat_publico WHERE id=?', [dela.data.mensagem.id])).status === 'ativo');
await req(`/api/admin/pedidos/${admTenta.data.pedido}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'sim' } });
check('depois do Sim ela sai', (await db.get('SELECT status FROM chat_publico WHERE id=?', [dela.data.mensagem.id])).status === 'apagada');
const doDono = await manda(bia, 'outra mensagem da bia');
const donoApaga = await req(`/api/chat-publico/${doDono.data.mensagem.id}`, { method: 'DELETE', token: dono.token, body: { motivo: 'x' } });
check('o administrador principal apaga na hora', donoApaga.status === 200 && donoApaga.data.executado === true, JSON.stringify(donoApaga.data).slice(0, 100));

console.log('\n== Denúncia ==');
const alvo = await manda(caio, 'mensagem que vai ser denunciada');
const d1 = await req(`/api/chat-publico/${alvo.data.mensagem.id}/denunciar`, { method: 'POST', token: ana.token, body: { motivo: 'chato' } });
check('qualquer pessoa denuncia', d1.status === 200 && d1.data.denuncias === 1, JSON.stringify(d1.data));
const d1b = await req(`/api/chat-publico/${alvo.data.mensagem.id}/denunciar`, { method: 'POST', token: ana.token });
check('a mesma pessoa não denuncia duas vezes', d1b.data.repetida === true);
await req(`/api/chat-publico/${alvo.data.mensagem.id}/denunciar`, { method: 'POST', token: bia.token });
const d3 = await req(`/api/chat-publico/${alvo.data.mensagem.id}/denunciar`, { method: 'POST', token: dede.token });
check('com três denúncias a mensagem sai do ar na hora', d3.data.escondida === true, JSON.stringify(d3.data));
check('e some mesmo da lista', !(await req('/api/chat-publico', { token: ana.token })).data.itens.some((m) => m.id === alvo.data.mensagem.id));
const avisos = await db.all("SELECT * FROM notificacoes WHERE tipo='seguranca' ORDER BY created_at DESC LIMIT 1");
check('o dono é avisado', avisos.length === 1 && /escondida/i.test(avisos[0].titulo || ''), JSON.stringify(avisos[0] || {}).slice(0, 110));
const restaura = await req(`/api/admin/chat-publico/${alvo.data.mensagem.id}/restaurar`, { method: 'POST', token: dono.token });
check('o dono consegue devolver a mensagem', restaura.status === 200 && (await db.get('SELECT status FROM chat_publico WHERE id=?', [alvo.data.mensagem.id])).status === 'ativo');
const admRestaura = await req(`/api/admin/chat-publico/${alvo.data.mensagem.id}/restaurar`, { method: 'POST', token: adm.token });
check('admin não principal não restaura sozinho', admRestaura.status === 403, String(admRestaura.status));

console.log('\n== Painel de moderação ==');
const painel = await req('/api/admin/chat-publico', { token: dono.token });
check('o painel lista as mensagens com denúncias e estado', painel.status === 200 && Array.isArray(painel.data.itens));
check('mostra quem mais apanhou do filtro', Array.isArray(painel.data.maisBarrados) && painel.data.maisBarrados.length > 0, JSON.stringify(painel.data.maisBarrados).slice(0, 110));
check('o painel não é aberto a usuário comum', (await req('/api/admin/chat-publico', { token: ana.token })).status === 403);
check('e nem no painel aparece o texto que foi barrado',
  !JSON.stringify(painel.data).match(/98439|fulano@gmail/), 'VAZOU conteúdo barrado no painel');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
