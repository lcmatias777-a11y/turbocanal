// Canal de teste: prova que ele é útil, que é compartilhado entre os
// administradores, privado para cada usuário comum, e que NÃO contamina nada
// de verdade (créditos, estatísticas, cota da API e o YouTube).

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
const CT = await import('../src/canalteste.js');

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
  return { id, email, role, token: await signToken(db, id) };
}
const ligar = (u, v = true) => req('/api/canal-teste', { method: 'POST', token: u.token, body: { ligado: v } });
const saldo = async (u) => Number((await db.get('SELECT credits FROM users WHERE id=?', [u.id])).credits);

/* ===================== 1) O canal gerado ===================== */
console.log('\n== O canal de teste é estável e tem sinal de verdade ==');
const vs = CT.videosBase();
check(`são ${CT.TOTAL_VIDEOS} vídeos`, vs.length === CT.TOTAL_VIDEOS, String(vs.length));
check('nenhum id repetido', new Set(vs.map((v) => v.id)).size === vs.length);
check('vêm do mais novo para o mais antigo',
  vs.every((v, i) => i === 0 || vs[i - 1].publicadoEm >= v.publicadoEm));

// determinismo: gerar de novo num módulo limpo dá exatamente o mesmo
const outro = await import('../src/canalteste.js?v=2');
check('gerar de novo devolve exatamente os mesmos vídeos (semente fixa)',
  JSON.stringify(outro.videosBase().slice(0, 50)) === JSON.stringify(vs.slice(0, 50)));

const ordenadas = vs.map((v) => v.views).sort((a, b) => a - b);
const mediana = ordenadas[Math.floor(ordenadas.length / 2)];
check('tem cauda longa: o maior passa de 20x a mediana (dá o que achar para a ferramenta de outlier)',
  ordenadas.at(-1) > mediana * 20, `${ordenadas.at(-1)} x ${mediana}`);
check('tem vídeos curtos e longos', vs.some((v) => v.duracaoSeg < 60) && vs.some((v) => v.duracaoSeg > 900));
check('publicações espalhadas por vários horários', new Set(vs.map((v) => v.publicadoEm.slice(11, 13))).size >= 8);
check('publicações em todos os dias da semana',
  new Set(vs.map((v) => new Date(v.publicadoEm).getUTCDay())).size === 7);
check('retenção sempre entre 0 e 1', vs.every((v) => v.retencao > 0 && v.retencao <= 1));
check('nenhum vídeo com views negativas ou zeradas', vs.every((v) => v.views > 0));

const c = CT.canalBase();
const somaViews = vs.reduce((s, v) => s + v.views, 0);
check('o total de views do canal bate com a soma dos vídeos (nada de número solto)', c.totalViews === somaViews);
check('o total de vídeos bate com a lista', c.totalVideos === vs.length);
// O nome é nome de canal normal de propósito: o aviso de que é simulado fica
// na faixa laranja do topo e na própria página, não no nome, senão o canal de
// teste não serve para ver como as telas ficam de verdade.
check('o canal tem nome de canal normal, não "teste"', !/teste|simulad/i.test(c.titulo), c.titulo);


/* ===================== 2) Ligar e desligar ===================== */
console.log('\n== Ligar, desligar e o aviso de que é inventado ==');
const dono = await criar('dono@example.com', 'owner');
const admin2 = await criar('admin2@example.com', 'admin');
const ana = await criar('ana@example.com');
const bia = await criar('bia@example.com');

const desligado = await req('/api/canal-teste', { token: ana.token });
check('começa desligado', desligado.data.ligado === false);
check('o nome do canal é normal, mas a API avisa que ele não existe no YouTube',
  !/teste|simulad/i.test(desligado.data.canal.titulo) && /não existe no YouTube/i.test(desligado.data.aviso || ''),
  desligado.data.canal.titulo);
check('a resposta avisa, com todas as letras, que o canal não existe',
  /não existe no YouTube/i.test(desligado.data.aviso || ''), desligado.data.aviso);
check('e avisa que NADA cobra crédito e que a IA ali é demonstração',
  /nada cobra/i.test(desligado.data.cobranca || '') && /demonstração/i.test(desligado.data.cobranca || ''),
  desligado.data.cobranca);

const semCanal = await req('/api/channel/videos?max=3', { token: ana.token });
check('sem canal ligado e sem modo teste, a ferramenta recusa (não inventa canal)', semCanal.status === 409, String(semCanal.status));

await ligar(ana);
const meu = await req('/api/channel/videos?max=3', { token: ana.token });
check('com o modo teste ligado, "Meu canal" abre', meu.status === 200, JSON.stringify(meu.data).slice(0, 120));
check('e os vídeos vêm do canal de teste', /tst\d{5}/.test(JSON.stringify(meu.data)), JSON.stringify(meu.data).slice(0, 140));

/* ===================== 3) Compartilhado x privado ===================== */
console.log('\n== Entre administradores é o MESMO canal; para usuário comum é só dele ==');
await ligar(dono); await ligar(admin2); await ligar(bia);

const st = await req('/api/canal-teste', { token: admin2.token });
check('o administrador é avisado de que o canal de teste é compartilhado', st.data.compartilhado === true);
check('e o texto explica o que isso significa', /MESMO/.test(st.data.compartilhadoTexto || ''), st.data.compartilhadoTexto);
const stAna = await req('/api/canal-teste', { token: ana.token });
check('o usuário comum é avisado de que o dele é privado',
  stAna.data.compartilhado === false && /só seu/i.test(stAna.data.compartilhadoTexto || ''));

const alvo = vs[0].id;
const edita = (u, titulo) => req('/api/channel/videos/' + alvo, { method: 'PUT', token: u.token, body: { title: titulo, description: 'editado no teste' } });
const tituloDe = async (u) => {
  const r = await req('/api/channel/videos?max=1', { token: u.token });
  const lista = r.data.videos || r.data.items || [];
  return (lista.find((v) => v.id === alvo) || {}).title;
};

const ed = await edita(admin2, 'TÍTULO TROCADO PELO ADMIN 2');
check('o administrador edita o título no canal de teste', ed.status === 200, JSON.stringify(ed.data).slice(0, 140));
check('o OUTRO administrador vê a troca (canal compartilhado entre eles)',
  (await tituloDe(dono)) === 'TÍTULO TROCADO PELO ADMIN 2', String(await tituloDe(dono)));
check('e o usuário comum NÃO vê a troca dos administradores',
  (await tituloDe(ana)) !== 'TÍTULO TROCADO PELO ADMIN 2', String(await tituloDe(ana)));

await edita(ana, 'TÍTULO DA ANA');
check('a Ana vê a própria edição', (await tituloDe(ana)) === 'TÍTULO DA ANA', String(await tituloDe(ana)));
check('a Bia não vê a edição da Ana (cada usuário tem o seu)',
  (await tituloDe(bia)) !== 'TÍTULO DA ANA', String(await tituloDe(bia)));
check('e os administradores também não veem a edição da Ana',
  (await tituloDe(admin2)) === 'TÍTULO TROCADO PELO ADMIN 2');

/* ===================== 4) Não suja nada de verdade ===================== */
console.log('\n== O canal de teste não contamina o que é real ==');
const med = await db.get('SELECT COUNT(*) AS n FROM medicoes_canal');
check('nenhuma medição de inscritos foi gravada (não vira resultado de criador)', Number(med.n) === 0, String(med.n));
const acomp = await db.get('SELECT COUNT(*) AS n FROM acompanhamentos');
check('nenhum acompanhamento criado', Number(acomp.n) === 0, String(acomp.n));

const antes = await saldo(ana);
await req('/api/channel/videos?max=5', { token: ana.token });
await req('/api/tools/best-time', { method: 'POST', token: ana.token, body: {} });
const depois = await saldo(ana);
check('ferramenta que só faz conta não cobra crédito no canal de teste', depois === antes, `${antes} -> ${depois}`);
const tx = await db.get("SELECT note FROM transactions WHERE user_id=? AND note LIKE '%anal de teste%' ORDER BY created_at DESC LIMIT 1", [ana.id]);
check('mas fica registrado no histórico por que não cobrou', !!tx, JSON.stringify(tx));

const cota = await db.get("SELECT COALESCE(SUM(units),0) AS n FROM yt_quota").catch(() => ({ n: 0 }));
check('não gastou cota da API do YouTube', Number(cota.n || 0) === 0, String(cota.n));

const yt = await db.get('SELECT COUNT(*) AS n FROM yt_tokens');
check('ninguém ficou com canal de verdade vinculado por usar o teste', Number(yt.n) === 0, String(yt.n));

/* ===================== 5) O que não dá para simular, ele diz ===================== */
console.log('\n== O que o canal de teste não faz, ele admite ==');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DAwMDEwMDAwMAAAB4LAwEqRpXcAAAAAElFTkSuQmCC';
const capa = await req('/api/channel/videos/' + alvo + '/thumbnail', { method: 'POST', token: ana.token, body: { image: PNG } });
check('enviar capa FUNCIONA no canal de teste (a capa é guardada e passa a aparecer)',
  capa.status === 200, `${capa.status} ${JSON.stringify(capa.data).slice(0, 110)}`);
const live = await req('/api/channel/live', { method: 'POST', token: ana.token, body: { title: 'live' } });
check('transmissão ao vivo recusa explicando (depende de canal real)',
  live.status === 422 && /canal de teste/i.test(JSON.stringify(live.data)), `${live.status}`);

/* ===================== 6) Reiniciar ===================== */
console.log('\n== Reiniciar o canal de teste ==');
const rAdmin = await req('/api/canal-teste/reiniciar', { method: 'POST', token: admin2.token });
check('admin comum NÃO reinicia o canal compartilhado (apagaria a edição dos outros)', rAdmin.status === 403, String(rAdmin.status));
const rDono = await req('/api/canal-teste/reiniciar', { method: 'POST', token: dono.token });
check('o administrador principal reinicia', rDono.status === 200, String(rDono.status));
check('e o título volta ao original', (await tituloDe(dono)) === vs[0].titulo, String(await tituloDe(dono)));
check('sem mexer no canal de teste da Ana', (await tituloDe(ana)) === 'TÍTULO DA ANA', String(await tituloDe(ana)));

const rAna = await req('/api/canal-teste/reiniciar', { method: 'POST', token: ana.token });
check('o usuário comum reinicia o dele sozinho', rAna.status === 200, String(rAna.status));
check('e o dele também volta ao original', (await tituloDe(ana)) === vs[0].titulo);

/* ===================== 7) Desligar devolve o estado normal ===================== */
console.log('\n== Desligar volta tudo como era ==');
await ligar(ana, false);
const voltou = await req('/api/channel/videos?max=3', { token: ana.token });
check('desligado, volta a pedir canal de verdade', voltou.status === 409, String(voltou.status));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
