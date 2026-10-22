// Foto de perfil, e a inicial como padrão quando não há foto.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const { corDoId, inicialDe, MAX_BYTES } = await import('../src/perfil.js');
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
async function criar(email, nome, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [id, email, null, nome, role, 'free', 5000, new Date().toISOString()]);
  return { id, email, nome, token: await signToken(db, id) };
}
// PNG 1x1 de verdade
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const grande = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_BYTES + 50 * 1024) * 4 / 3));

const ana = await criar('ana@example.com', 'Ana Souza');
const bia = await criar('bia@example.com', '');

console.log('\n== Inicial e cor, quando não há foto ==');
check('a inicial vem do nome', inicialDe('Ana Souza', 'ana@x.com') === 'A');
check('sem nome, vem do e-mail', inicialDe('', 'bia@x.com') === 'B');
check('sem nada, não quebra', inicialDe('', '') === '?');
check('emoji e pontuação não viram inicial', inicialDe('🎬 Canal', 'x@y.com') === 'C', inicialDe('🎬 Canal', 'x@y.com'));
check('nome com acento funciona', inicialDe('Ágata', 'a@b.com') === 'Á', inicialDe('Ágata', 'a@b.com'));
check('a cor é sempre a mesma para a mesma pessoa', corDoId(ana.id) === corDoId(ana.id));
check('e pessoas diferentes tendem a cores diferentes', new Set([ana.id, bia.id, randomUUID(), randomUUID(), randomUUID()].map(corDoId)).size >= 2);
check('a cor é um hexadecimal válido', /^#[0-9a-f]{6}$/i.test(corDoId(ana.id)), corDoId(ana.id));

console.log('\n== O perfil público não vaza e-mail ==');
const perf = await req('/api/perfil/' + ana.id, { token: bia.token });
check('qualquer pessoa logada vê nome, inicial e cor', perf.status === 200 && perf.data.nome === 'Ana Souza' && perf.data.inicial === 'A');
check('mas o e-mail NÃO vem junto', !JSON.stringify(perf.data).includes('ana@example.com'), JSON.stringify(perf.data));
check('sem login não vê perfil nenhum', (await req('/api/perfil/' + ana.id)).status === 401);
check('perfil que não existe devolve 404', (await req('/api/perfil/naoexiste', { token: bia.token })).status === 404);

console.log('\n== Enviar a foto ==');
const env = await req('/api/me/foto', { method: 'POST', token: ana.token, body: { imagem: PNG } });
check('a foto é aceita', env.status === 200 && env.data.ok === true, JSON.stringify(env.data).slice(0, 110));
check('e fica guardada na conta', (await db.get('SELECT foto_url FROM users WHERE id=?', [ana.id])).foto_url === PNG);
const perf2 = await req('/api/perfil/' + ana.id, { token: bia.token });
check('o perfil passa a devolver a foto', perf2.data.foto === PNG);

console.log('\n== O que não é aceito ==');
for (const [nome, img, esperado] of [
  ['texto que não é imagem', 'só um texto', 400],
  ['link em vez de imagem', 'https://site.com/foto.png', 400],
  ['script disfarçado', 'data:text/html;base64,PHNjcmlwdD4=', 400],
  ['SVG (pode carregar script)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 400],
  ['imagem vazia', 'data:image/png;base64,AA==', 400],
  ['imagem grande demais', grande, 413]
]) {
  const r = await req('/api/me/foto', { method: 'POST', token: ana.token, body: { imagem: img } });
  check(`recusa ${nome}`, r.status === esperado, `(${r.status}) ${JSON.stringify(r.data).slice(0, 80)}`);
}
check('e a foto boa continua lá depois das tentativas', (await db.get('SELECT foto_url FROM users WHERE id=?', [ana.id])).foto_url === PNG);

console.log('\n== Tirar a foto ==');
const tira = await req('/api/me/foto', { method: 'DELETE', token: ana.token });
check('dá para tirar a foto', tira.status === 200);
check('e a conta volta a não ter foto', !(await db.get('SELECT foto_url FROM users WHERE id=?', [ana.id])).foto_url);
const perf3 = await req('/api/perfil/' + ana.id, { token: bia.token });
check('o perfil volta a entregar inicial e cor', perf3.data.foto === null && perf3.data.inicial === 'A' && /^#/.test(perf3.data.cor));

console.log('\n== Cada um mexe só na própria foto ==');
check('não existe rota para trocar a foto de outra pessoa',
  (await req('/api/perfil/' + bia.id, { method: 'POST', token: ana.token, body: { imagem: PNG } })).status === 404);
check('e sem login nem a própria', (await req('/api/me/foto', { method: 'POST', body: { imagem: PNG } })).status === 401);

console.log('\n== A foto aparece no bate-papo ==');
await req('/api/me/foto', { method: 'POST', token: ana.token, body: { imagem: PNG } });
await req('/api/chat-publico', { method: 'POST', token: ana.token, body: { texto: 'oi pessoal, tudo bem?' } });
await req('/api/chat-publico', { method: 'POST', token: bia.token, body: { texto: 'tudo certo por aqui' } });
const chat = await req('/api/chat-publico', { token: bia.token });
const mAna = chat.data.itens.find((m) => m.autor_id === ana.id);
const mBia = chat.data.itens.find((m) => m.autor_id === bia.id);
check('quem tem foto aparece com ela', mAna?.foto === PNG);
check('quem não tem aparece com a inicial e a cor', !mBia?.foto && mBia?.inicial === 'B' && /^#/.test(mBia?.cor || ''), JSON.stringify(mBia));
check('o bate-papo não devolve e-mail de ninguém', !JSON.stringify(chat.data).includes('@example.com'), 'VAZOU e-mail no bate-papo');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
