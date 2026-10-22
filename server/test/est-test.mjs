// Testes dos "Resultados dos criadores".
// Parte 1: funções puras (sem banco, sem rede).
// Parte 2: integração num servidor real com banco limpo, medições e usos
// inseridos à mão para poder controlar datas e números.
//
// Por que inserir medição direto na tabela: o coletor é testado à parte (uma
// leitura de canal cria a linha). Aqui o que precisa ser provado é a
// classificação, e para isso as datas têm que ser escolhidas.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';

const { startFakeYouTube } = await import('./fake-youtube.js');
const fake = await startFakeYouTube();
process.env.YT_API_BASE = fake.base + '/youtube/v3/';
process.env.YT_UPLOAD_BASE = fake.base + '/upload/youtube/v3/';
process.env.YT_ANALYTICS_BASE = fake.base + '/youtubeanalytics/v2/';
process.env.YT_IMG_BASE = fake.base + '/vi/';

const E = await import('../src/estatisticas.js');
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

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
const dias = (n) => new Date(Date.now() - n * 86400e3).toISOString();

/* ===================== PARTE 1: funções puras ===================== */
console.log('\n== Identificação automática da meta (ninguém pergunta ao usuário) ==');
check('400 inscritos -> meta 1.000', E.metaAplicavel(400) === 1000, `(${E.metaAplicavel(400)})`);
check('999 inscritos -> meta 1.000', E.metaAplicavel(999) === 1000);
check('1.000 inscritos -> próxima meta é 10.000', E.metaAplicavel(1000) === 10000);
check('acima da maior meta -> null, não inventa meta', E.metaAplicavel(10000000) === null);
check('sem número de inscritos -> null', E.metaAplicavel(null) === null && E.metaAplicavel(undefined) === null);
check('limiar de 1.000 é 500', E.limiarDe(1000) === 500);

console.log('\n== Separação Registro 1 x Registro 3 ==');
check('400 (abaixo de 50%) -> Registro 1', E.grupoDe(400, 1000) === 1);
check('800 (acima de 50%) -> Registro 3', E.grupoDe(800, 1000) === 3);
check('exatamente 500 (50%) -> Registro 3, porque 50% não é "abaixo de 50%"', E.grupoDe(500, 1000) === 3);
check('499 -> Registro 1', E.grupoDe(499, 1000) === 1);

console.log('\n== Uso real: o que conta e o que não conta ==');
const tx = (tool, iso, delta = -8) => ({ tool, delta, created_at: iso });
check('cobrança estornada não conta como uso',
  E.usosValidos([tx('channel_analysis', '2026-01-01T10:00:00Z'), { tool: 'channel_analysis', delta: 8, created_at: '2026-01-01T10:00:30Z' }]).length === 0);
check('ferramenta fora da lista (responder comentário) não conta',
  E.usosValidos([tx('comment_reply', '2026-01-01T10:00:00Z')]).length === 0);
check('cobrança normal conta', E.usosValidos([tx('audit_ai', '2026-01-01T10:00:00Z')]).length === 1);
const tresEmDoisDias = [tx('channel_analysis', '2026-01-01T10:00:00Z'), tx('best_time', '2026-01-02T10:00:00Z'), tx('title_lab', '2026-01-02T12:00:00Z')];
const u1 = E.avaliarUso(E.usosValidos(tresEmDoisDias));
check('3 usos em 2 dias, com ferramenta de canal -> elegível', u1.elegivel === true);
check('a data de elegibilidade é a do 3º uso', u1.em === '2026-01-02T12:00:00Z', `(${u1.em})`);
check('a prova dos eventos é guardada', Array.isArray(u1.prova) && u1.prova.length === 3);
const u2 = E.avaliarUso(E.usosValidos([tx('channel_analysis', '2026-01-01T10:00:00Z'), tx('best_time', '2026-01-01T11:00:00Z'), tx('title_lab', '2026-01-01T12:00:00Z')]));
check('3 usos no MESMO dia -> não elegível', u2.elegivel === false && u2.falta.dias === 1);
const u3 = E.avaliarUso(E.usosValidos([tx('channel_analysis', '2026-01-01T10:00:00Z'), tx('best_time', '2026-01-02T10:00:00Z')]));
check('só 2 usos -> não elegível', u3.elegivel === false && u3.falta.usos === 1);
check('abrir conta e não usar nada -> não elegível', E.avaliarUso([]).elegivel === false);

console.log('\n== Percurso das metas ==');
const med = (ins, iso, precisao = 'exata') => ({ inscritos: ins, medido_em: iso, precisao });
const p1 = E.percorrerMetas({ medicoes: [med(400, '2026-01-01T00:00:00Z'), med(1050, '2026-03-01T00:00:00Z')], inscritosInicio: 400 });
check('400 -> 1.050 gera UMA conquista', p1.length === 1, `(${p1.length})`);
check('e ela é do Registro 1', p1[0]?.registro === 1);
check('guarda o número real da conquista (1.050, não 1.000)', p1[0]?.inscritosConquista === 1050);
const p3 = E.percorrerMetas({ medicoes: [med(800, '2026-01-01T00:00:00Z'), med(1000, '2026-03-01T00:00:00Z')], inscritosInicio: 800 });
check('800 -> 1.000 é Registro 3, não Registro 1', p3[0]?.registro === 3);
const pJa = E.percorrerMetas({ medicoes: [med(1050, '2026-03-01T00:00:00Z')], inscritosInicio: 400, jaConquistadas: [1000] });
check('meta já conquistada antes não é registrada de novo', pJa.length === 0);
const pNada = E.percorrerMetas({ medicoes: [med(300, '2026-01-01T00:00:00Z'), med(700, '2026-03-01T00:00:00Z')], inscritosInicio: 300 });
check('crescer sem chegar na meta não gera conquista', pNada.length === 0);

console.log('\n== Registro 2: crescimento, independente de meta ==');
const c1 = E.crescimentoNaJanela([med(400, '2026-01-01T00:00:00Z'), med(1400, '2026-04-01T00:00:00Z')]);
check('crescimento de 400 para 1.400 = +1.000', c1.diferenca === 1000);
check('variação percentual = +250%', c1.percentual === 250, `(${c1.percentual})`);
check('guarda as duas datas e o período', c1.de && c1.ate && c1.dias === 90, `(dias=${c1.dias})`);
const c0 = E.crescimentoNaJanela([med(0, '2026-01-01T00:00:00Z'), med(50, '2026-02-01T00:00:00Z')]);
check('base zero -> percentual null (não divide por zero)', c0.diferenca === 50 && c0.percentual === null);
check('uma medição só -> insuficiente, não vira crescimento zero', E.crescimentoNaJanela([med(400, '2026-01-01T00:00:00Z')]).suficiente === false);
const cNull = E.crescimentoNaJanela([med(null, '2026-01-01T00:00:00Z'), med(400, '2026-02-01T00:00:00Z'), med(900, '2026-03-01T00:00:00Z')]);
check('contagem indisponível é descartada, não vira zero', cNull.inicial === 400 && cNull.diferenca === 500);
const cQueda = E.crescimentoNaJanela([med(900, '2026-01-01T00:00:00Z'), med(1100, '2026-02-01T00:00:00Z'), med(950, '2026-03-01T00:00:00Z')]);
check('canal que perdeu inscritos mostra o saldo real (+50), não o pico', cQueda.diferenca === 50);
const cEst = E.crescimentoNaJanela([med(1200, '2026-01-01T00:00:00Z', 'arredondada'), med(1500, '2026-02-01T00:00:00Z', 'arredondada')]);
check('crescimento com contagem arredondada vem marcado como estimado', cEst.estimado === true);

console.log('\n== Distribuições ==');
const cats = [{ id: 'a', rotulo: 'A' }, { id: 'b', rotulo: 'B' }, { id: 'c', rotulo: 'C' }];
const itens = [...'aaaabbbcc'].map((x) => ({ k: x }));
const d1 = E.distribuir(itens, cats, (i) => i.k, { minimo: 5 });
check('denominador é só desta distribuição (n=9)', d1.n === 9, `(${d1.n})`);
check('as porcentagens somam exatamente 100', d1.categorias.reduce((s, c) => s + c.percentual, 0) === 100,
  `(${d1.categorias?.map((c) => c.percentual).join('+')})`);
check('cada item cai em uma categoria só', d1.categorias.reduce((s, c) => s + c.quantidade, 0) === 9);
const d2 = E.distribuir(itens.slice(0, 3), cats, (i) => i.k, { minimo: 5 });
check('abaixo do mínimo não publica porcentagem', d2.suficiente === false && /insuficientes/i.test(d2.mensagem));
check('e informa quantos são, sem esconder', d2.n === 3 && d2.minimo === 5);
const d3 = E.distribuir([...itens, { k: 'z' }], cats, (i) => i.k, { minimo: 5 });
check('item fora das categorias não entra no denominador', d3.n === 9 && d3.fora === 1);

console.log('\n== Faixas de inscritos ==');
check('999 cai em "menos de 1.000"', E.faixaDe(999) === 'f0');
check('1.000 cai na faixa de 1.000', E.faixaDe(1000) === 'f1');
check('9.999 ainda está na faixa de 1.000', E.faixaDe(9999) === 'f1');
check('50 milhões caem na última faixa', E.faixaDe(50000000) === 'f5');
check('as faixas não têm buraco nem sobreposição',
  E.faixas().every((f, i, a) => i === 0 || f.de === a[i - 1].ate + 1));

/* ===================== PARTE 2: integração ===================== */
console.log('\n== Montando os canais de teste no banco ==');
// Usuários são criados direto no banco: o cadastro por HTTP tem limite de
// tentativas (10 por 10 min) e este teste precisa de mais de uma dúzia de canais.
const { signToken } = await import('../src/auth.js');
async function criarUsuario(email, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [id, email, null, email.split('@')[0], role, 'free', 5000, new Date().toISOString()]);
  return { id, token: await signToken(db, id), email };
}
async function ligarCanal(u, canalId) {
  await db.run('INSERT INTO yt_tokens(user_id,access_token,refresh_token,expires_at,channel_id,channel_title,scopes,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    [u.id, 'x', 'y', Date.now() + 36e5, canalId, 'Canal ' + canalId, '', new Date().toISOString()]);
}
async function medir(u, canalId, inscritos, iso, precisao = 'exata') {
  await db.run(`INSERT INTO medicoes_canal(id,user_id,canal_id,inscritos,oculto,precisao,origem,dia,medido_em)
                VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(canal_id,dia) DO NOTHING`,
    [randomUUID(), u.id, canalId, inscritos, inscritos === null ? 1 : 0, precisao, 'canal', iso.slice(0, 10), iso]);
}
async function usar(u, tool, iso, delta = -8) {
  await db.run('INSERT INTO transactions(id,user_id,delta,balance_after,tool,note,idem_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [randomUUID(), u.id, delta, 100, tool, 'teste', null, iso]);
}
// 3 usos em 2 dias, incluindo ferramenta de canal
async function usoMinimo(u, d) {
  await usar(u, 'channel_analysis', dias(d));
  await usar(u, 'best_time', dias(d - 1));
  await usar(u, 'title_lab', dias(d - 1));
  return dias(d - 1);
}

const A = await criarUsuario('a@example.com'); await ligarCanal(A, 'canalA');
await usoMinimo(A, 45); await medir(A, 'canalA', 400, dias(40)); await medir(A, 'canalA', 1050, dias(10));

const B = await criarUsuario('b@example.com'); await ligarCanal(B, 'canalB');
await usoMinimo(B, 45); await medir(B, 'canalB', 800, dias(40)); await medir(B, 'canalB', 1000, dias(10));

const C = await criarUsuario('c@example.com'); await ligarCanal(C, 'canalC');
await usoMinimo(C, 45); await medir(C, 'canalC', 300, dias(40)); await medir(C, 'canalC', 700, dias(10));

const D = await criarUsuario('d@example.com'); await ligarCanal(D, 'canalD');
await medir(D, 'canalD', 900, dias(60)); await medir(D, 'canalD', 1200, dias(50));
await usoMinimo(D, 20); await medir(D, 'canalD', 1300, dias(10)); await medir(D, 'canalD', 1350, dias(5));

const Ev = await criarUsuario('e@example.com'); await ligarCanal(Ev, 'canalE');
await usar(Ev, 'channel_analysis', dias(30));
await medir(Ev, 'canalE', 500, dias(40)); await medir(Ev, 'canalE', 900, dias(10));

const F = await criarUsuario('f@example.com'); await ligarCanal(F, 'canalF');
await usoMinimo(F, 45);

const G = await criarUsuario('g@example.com'); await ligarCanal(G, 'canalG');
await usoMinimo(G, 200); await medir(G, 'canalG', 300, dias(198)); await medir(G, 'canalG', 500, dias(150));

const H = await criarUsuario('h@example.com'); await ligarCanal(H, 'canalH');
await usoMinimo(H, 45); await medir(H, 'canalH', 450, dias(40)); await medir(H, 'canalH', 1100, dias(20)); await medir(H, 'canalH', 950, dias(5));

const K = await criarUsuario('k@example.com'); await ligarCanal(K, 'canalK');
await usoMinimo(K, 45); await medir(K, 'canalK', 600, dias(40)); await medir(K, 'canalK', 1200, dias(10));

const L = await criarUsuario('l@example.com'); await ligarCanal(L, 'canalL');
await usoMinimo(L, 45); await medir(L, 'canalL', 200, dias(40)); await medir(L, 'canalL', 1100, dias(10));

const M = await criarUsuario('m@example.com'); await ligarCanal(M, 'canalM');
await usoMinimo(M, 45);
await medir(M, 'canalM', null, dias(40), 'indisponivel');
await medir(M, 'canalM', 1200, dias(30), 'arredondada');
await medir(M, 'canalM', 1500, dias(10), 'arredondada');

for (const u of [A, B, C, D, Ev, F, G, H, K, L, M]) await E.recalcular(db, u.id);

const acomp = async (u) => db.get('SELECT * FROM acompanhamentos WHERE user_id=?', [u.id]);
const conq = async (canal) => db.all('SELECT * FROM conquistas WHERE canal_id=? ORDER BY meta', [canal]);

console.log('\n== Registro 1: quem começou abaixo da metade da meta ==');
const cA = await conq('canalA');
check('A (400 -> 1.050) registrou conquista', cA.length === 1, `(${cA.length})`);
check('classificada como Registro 1', Number(cA[0]?.registro) === 1, `(registro=${cA[0]?.registro})`);
check('guardou os inscritos do início (400) e da conquista (1.050)',
  Number(cA[0]?.inscritos_inicio) === 400 && Number(cA[0]?.inscritos_conquista) === 1050);
check('guardou a versão da regra aplicada', Number(cA[0]?.regras_versao) === 1);
const aA = await acomp(A);
check('o acompanhamento ficou como "alcançou uma meta"', aA.estado === 'concluiu_meta', `(${aA.estado})`);
check('e gravou o limiar de 500', Number(aA.limiar) === 500, `(${aA.limiar})`);

console.log('\n== Registro 3: quem já começou acima da metade ==');
const cB = await conq('canalB');
check('B (800 -> 1.000) registrou conquista', cB.length === 1);
check('classificada como Registro 3, NÃO como Registro 1', Number(cB[0]?.registro) === 3, `(registro=${cB[0]?.registro})`);

console.log('\n== Registro 2: crescimento é independente da meta ==');
const mC = await db.all('SELECT inscritos, precisao, medido_em FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em', ['canalC']);
const aC = await acomp(C);
const crC = E.crescimentoNaJanela(mC, aC.elegivel_em, aC.fim);
check('C cresceu 400 inscritos sem alcançar meta nenhuma', crC.diferenca === 400, `(${crC.diferenca})`);
check('e não gerou conquista', (await conq('canalC')).length === 0);
check('C continua em acompanhamento', aC.estado === 'em_acompanhamento', `(${aC.estado})`);
const mB = await db.all('SELECT inscritos, precisao, medido_em FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em', ['canalB']);
const aB = await acomp(B);
check('B alcançou a meta de 1.000 mas ganhou só 200 inscritos (meta != crescimento)',
  E.crescimentoNaJanela(mB, aB.elegivel_em, aB.fim).diferenca === 200);

console.log('\n== Meta alcançada ANTES de cumprir o uso mínimo ==');
const cD = await conq('canalD');
check('D passou de 1.000 antes de usar o site: não vira conquista', cD.length === 0, `(${cD.length})`);
const aD = await acomp(D);
check('D entra no acompanhamento mirando a meta seguinte (10.000)', Number(aD.meta_alvo) === 10000, `(${aD.meta_alvo})`);
check('e o ponto de partida dele é o da elegibilidade (1.300), não os 900 do começo',
  Number(aD.inscritos_inicial) === 900 && Number(aD.limiar) === 5000, `(inicial=${aD.inscritos_inicial}, limiar=${aD.limiar})`);

console.log('\n== Quem nunca cumpre o uso mínimo ==');
const aE = await acomp(Ev);
check('E fica como "aguardando uso", não como elegível', aE.estado === 'aguardando_uso', `(${aE.estado})`);
check('E não gera conquista mesmo tendo crescido', (await conq('canalE')).length === 0);

console.log('\n== Canal sem histórico suficiente ==');
const aF = await acomp(F);
check('F (canal ligado, nenhuma medição) fica como "sem dados"', aF.estado === 'sem_dados', `(${aF.estado})`);
check('e não inventa número de inscritos inicial', aF.inscritos_inicial === null || aF.inscritos_inicial === undefined);

console.log('\n== Período encerrado sem a meta ==');
const aG = await acomp(G);
check('G terminou o período sem meta', aG.estado === 'encerrado_sem_meta', `(${aG.estado})`);
check('G continua contado, não foi excluído para melhorar o resultado', !!aG.fim && new Date(aG.fim) < new Date());

console.log('\n== Conquista seguida de queda de inscritos ==');
const cH = await conq('canalH');
const aH = await acomp(H);
const atualH = await db.get('SELECT inscritos FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em DESC LIMIT 1', ['canalH']);
check('H conquistou 1.000 e a conquista foi preservada', cH.length === 1 && Number(cH[0].meta) === 1000);
check('a conquista guarda o número do dia (1.100)', Number(cH[0].inscritos_conquista) === 1100);
check('a contagem atual mostra a queda (950), separada da conquista', Number(atualH.inscritos) === 950);
check('o estado continua "alcançou uma meta"', aH.estado === 'concluiu_meta');

console.log('\n== Contagem arredondada e indisponível ==');
const aM = await acomp(M);
check('M ignorou a medição indisponível e partiu de 1.200', Number(aM.inscritos_inicial) === 1200, `(${aM.inscritos_inicial})`);
const mM = await db.all('SELECT precisao FROM medicoes_canal WHERE canal_id=?', ['canalM']);
check('a medição sem número ficou marcada como indisponível', mM.some((x) => x.precisao === 'indisponivel'));
check('acima de 1.000 a contagem é marcada como arredondada', mM.filter((x) => x.precisao === 'arredondada').length === 2);

console.log('\n== Medições e conquistas duplicadas ==');
await medir(A, 'canalA', 9999, dias(10)); // mesmo dia de uma medição que já existe
const nA = await db.get('SELECT COUNT(*) AS n FROM medicoes_canal WHERE canal_id=? AND dia=?', ['canalA', dias(10).slice(0, 10)]);
check('duas medições no mesmo dia -> só uma fica', Number(nA.n) === 1, `(${nA.n})`);
await E.recalcular(db, A.id); await E.recalcular(db, A.id); await E.recalcular(db, A.id);
check('recalcular três vezes não duplica a conquista', (await conq('canalA')).length === 1);

console.log('\n== Resultados agregados ==');
const res = await E.resultados(db);
check('os três registros existem e são separados',
  !!res.registro1 && !!res.registro2 && !!res.registro3);
check('Registro 1 tem A, H e L', res.registro1.total === 3, `(${res.registro1.total})`);
check('Registro 3 tem B e K', res.registro3.total === 2, `(${res.registro3.total})`);
check('nenhuma conquista aparece nos dois registros ao mesmo tempo',
  res.registro1.total + res.registro3.total === (await db.get('SELECT COUNT(*) AS n FROM conquistas')).n * 1);
check('Registro 2 conta canais, não conquistas', res.registro2.canais >= 8, `(${res.registro2.canais})`);
check('Registro 2 soma os inscritos ganhos', res.registro2.inscritosGanhos > 0);
check('canais ainda em acompanhamento aparecem separados', res.base.emAcompanhamento >= 2, `(${res.base.emAcompanhamento})`);
check('quem não cumpriu o uso mínimo aparece separado', res.base.aguardandoUso === 1, `(${res.base.aguardandoUso})`);
check('quem não tem dados aparece separado', res.base.semDados === 1, `(${res.base.semDados})`);
check('o aviso de que crescimento não prova causa está no retorno', /não comprova/i.test(res.aviso));
check('o período analisado é informado', !!res.base.periodoDe);

console.log('\n== Distribuições: denominador próprio e soma 100% ==');
const dFaixa = res.distribuicoes.find((d) => /faixa de inscritos de hoje/.test(d.populacao || ''));
check('a distribuição por faixa foi publicada', dFaixa?.suficiente === true, JSON.stringify(dFaixa?.mensagem || ''));
check('e soma exatamente 100%', dFaixa.categorias.reduce((s, c) => s + c.percentual, 0) === 100,
  `(${dFaixa?.categorias?.map((c) => c.percentual).join('+')})`);
check('o denominador é o número de canais elegíveis com medição', dFaixa.n === res.base.canaisElegiveis, `(n=${dFaixa.n}, elegíveis=${res.base.canaisElegiveis})`);
const dDesfecho = res.distribuicoes.find((d) => /encerrados/.test(d.populacao || ''));
check('a distribuição de desfecho tem denominador próprio, diferente do outro',
  dDesfecho.suficiente === true && dDesfecho.n !== dFaixa.n, `(desfecho=${dDesfecho?.n}, faixa=${dFaixa?.n})`);
check('e também soma 100%', dDesfecho.categorias.reduce((s, c) => s + c.percentual, 0) === 100);

console.log('\n== Sem gente suficiente, não inventa porcentagem ==');
const vazio = await buildVazio();
async function buildVazio() {
  const { buildApp: b2 } = await import('../src/app.js');
  const { db: db2 } = await b2({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
  return E.resultados(db2);
}
check('site novo mostra "dados insuficientes" em vez de gráfico fictício',
  vazio.distribuicoes.every((d) => d.suficiente === false));
check('e deixa claro que não há canal elegível', vazio.base.canaisElegiveis === 0 && vazio.base.suficienteParaPublicar === false);
check('os três registros vêm zerados, não com número inventado',
  vazio.registro1.total === 0 && vazio.registro2.canais === 0 && vazio.registro3.total === 0);

console.log('\n== Mudança de regra preserva o histórico ==');
const dono = await criarUsuario('dono@example.com', 'owner');
const donoOk = (await req('/api/me', { token: dono.token })).data.user?.role === 'owner';
check('conta do dono responde como owner', donoOk);
const regAntes = await req('/api/admin/estatisticas/regras', { token: dono.token });
check('o dono lê as regras atuais', regAntes.status === 200 && regAntes.data.versao === 1);
const mud = await req('/api/admin/estatisticas/regras', { method: 'POST', token: dono.token, body: { usosMinimos: 5, diasAcompanhamento: 120 } });
check('o dono muda a regra e sobe a versão para 2', mud.status === 200 && mud.data.versao === 2, `(status=${mud.status}, v=${mud.data.versao})`);
check('a resposta avisa que o histórico não é reclassificado', /versão de regra anterior/i.test(mud.data.aviso || ''));
const cA2 = await conq('canalA');
check('a conquista antiga continua na versão 1 da regra', Number(cA2[0].regras_versao) === 1);
await E.recalcular(db, A.id);
const aA2 = await acomp(A);
check('o acompanhamento antigo continua rodando pela versão 1', Number(aA2.regras_versao) === 1, `(v=${aA2.regras_versao})`);
check('e não foi reclassificado em silêncio', (await conq('canalA')).length === 1 && Number((await conq('canalA'))[0].registro) === 1);
const hist = await req('/api/admin/estatisticas/regras', { token: dono.token });
check('o histórico de regras guarda as duas versões', hist.data.historico.length === 2);
check('o histórico diz quem mudou', hist.data.historico[0].autor_email === 'dono@example.com');
const aud = await db.get("SELECT * FROM audit WHERE action='estatisticas.regras' ORDER BY created_at DESC LIMIT 1");
check('a mudança foi para a auditoria com regra anterior e nova', !!aud && /usosMinimos/.test(aud.detail || ''));

console.log('\n== Permissões e privacidade ==');
const pub = await req('/api/estatisticas/resultados');
check('os resultados agregados são públicos', pub.status === 200);
const textoPub = JSON.stringify(pub.data);
check('não vaza e-mail de ninguém', !/@example\.com/.test(textoPub));
check('não vaza id de canal', !/canal[A-M]\b/.test(textoPub));
check('não vaza id de usuário', !textoPub.includes(A.id));
const semLogin = await req('/api/estatisticas/meu');
check('o acompanhamento pessoal exige login', semLogin.status === 401, `(${semLogin.status})`);
const meuA = await req('/api/estatisticas/meu', { token: A.token });
check('o usuário vê o próprio acompanhamento', meuA.status === 200 && meuA.data.canalLigado === true);
check('e vê a prova do uso que o tornou elegível', meuA.data.uso?.elegivel === true && meuA.data.uso.usosValidos >= 3);
const admComum = await req('/api/admin/estatisticas/regras', { token: A.token });
check('usuário comum não lê as regras administrativas', admComum.status === 403, `(${admComum.status})`);
const mudComum = await req('/api/admin/estatisticas/regras', { method: 'POST', token: A.token, body: { usosMinimos: 1 } });
check('usuário comum não muda regra', mudComum.status === 403);
const adminSimples = await criarUsuario('adm@example.com', 'admin');
const leAdm = await req('/api/admin/estatisticas/regras', { token: adminSimples.token });
check('admin não principal LÊ as regras', leAdm.status === 200, `(${leAdm.status})`);
const mudAdm = await req('/api/admin/estatisticas/regras', { method: 'POST', token: adminSimples.token, body: { usosMinimos: 1 } });
check('admin não principal NÃO muda as regras (só o dono)', mudAdm.status === 403, `(${mudAdm.status})`);
const forja = await req('/api/estatisticas/meu', { method: 'POST', token: A.token, body: { inscritos: 999999 } });
check('não existe rota para o usuário digitar os próprios inscritos', forja.status === 404, `(${forja.status})`);
const antesForja = (await db.get('SELECT inscritos FROM medicoes_canal WHERE canal_id=? ORDER BY medido_em DESC LIMIT 1', ['canalA'])).inscritos;
check('os inscritos continuam vindo da medição, não do navegador', Number(antesForja) === 1050, `(${antesForja})`);

console.log('\n== Conta administrativa não polui a estatística ==');
await ligarCanal(dono, 'canalDono');
await usoMinimo(dono, 45);
await medir(dono, 'canalDono', 400, dias(40)); await medir(dono, 'canalDono', 5000, dias(10));
await E.recalcular(db, dono.id);
check('canal do dono não cria acompanhamento', !(await acomp(dono)));
const res2 = await E.resultados(db);
check('e não muda o Registro 1', res2.registro1.total === 3, `(${res2.registro1.total})`);

console.log('\n== Coletor: leitura de canal grava medição ==');
const N = await criarUsuario('n@example.com');
const { registrarMedicao } = E;
await registrarMedicao(db, { id: N.id }, { id: 'canalN', statistics: { subscriberCount: '1234', hiddenSubscriberCount: false } }, 'canal');
const mN = await db.get('SELECT * FROM medicoes_canal WHERE canal_id=?', ['canalN']);
check('uma leitura de canal cria a medição', !!mN && Number(mN.inscritos) === 1234);
check('em ambiente simulado a origem fica marcada como mock', mN.origem === 'mock', `(${mN.origem})`);
check('1.234 inscritos é marcado como arredondado (o YouTube arredonda acima de mil)', mN.precisao === 'arredondada');
await registrarMedicao(db, { id: N.id }, { id: 'canalN', statistics: { subscriberCount: '1300', hiddenSubscriberCount: false } }, 'canal');
const nN = await db.get('SELECT COUNT(*) AS n FROM medicoes_canal WHERE canal_id=?', ['canalN']);
check('duas leituras seguidas não geram duas medições', Number(nN.n) === 1, `(${nN.n})`);
await registrarMedicao(db, { id: N.id }, { id: 'canalO', statistics: { hiddenSubscriberCount: true } }, 'canal');
const mO = await db.get('SELECT * FROM medicoes_canal WHERE canal_id=?', ['canalO']);
check('canal que esconde a contagem grava indisponível, não zero', mO.inscritos === null && mO.precisao === 'indisponivel');
const res3 = await E.resultados(db);
check('medição de ambiente simulado não entra nos resultados', res3.base.canaisElegiveis === res2.base.canaisElegiveis);

console.log('\n== Estorno e regra nova valendo para quem entra depois ==');
// P nasce DEPOIS da mudança de regra acima, então vale a versão 2 (5 usos).
const P = await criarUsuario('p@example.com'); await ligarCanal(P, 'canalP');
await usar(P, 'channel_analysis', dias(40));
await usar(P, 'audit_ai', dias(39), -200);
await usar(P, 'audit_ai', dias(39), 200); // estorno da cobrança acima
await usar(P, 'best_time', dias(39));
await usar(P, 'ideas_ai', dias(38));
await usar(P, 'prep_ai', dias(37));
await medir(P, 'canalP', 300, dias(35));
await E.recalcular(db, P.id);
const aP = await acomp(P);
check('o acompanhamento novo nasce na versão 2 da regra', Number(aP.regras_versao) === 2, `(v=${aP.regras_versao})`);
check('5 cobranças com uma estornada: 4 usos válidos não bastam na regra nova', aP.estado === 'aguardando_uso', `(${aP.estado})`);
const provaP = JSON.parse(aP.elegivel_prova || '[]');
check('o estorno não aparece como uso válido na prova', !provaP.some((x) => x.tool === 'audit_ai'), JSON.stringify(provaP.map((x) => x.tool)));
await usar(P, 'transform_ai', dias(34));
await medir(P, 'canalP', 320, dias(33));
await E.recalcular(db, P.id);
const aP2 = await acomp(P);
check('com o quinto uso válido, fica elegível', aP2.estado === 'em_acompanhamento', `(${aP2.estado})`);
check('e o período dele é de 120 dias, como manda a regra nova',
  Math.round((Date.parse(aP2.fim) - Date.parse(aP2.elegivel_em)) / 86400e3) === 120,
  `(${Math.round((Date.parse(aP2.fim) - Date.parse(aP2.elegivel_em)) / 86400e3)} dias)`);

console.log('\n== Compatibilidade com o que já existia ==');
const saude = await req('/api/health');
check('/api/health continua respondendo', saude.status === 200 && saude.data.ok === true);
const ferr = await req('/api/tools/trends', { method: 'POST', token: A.token, body: {} });
check('as ferramentas continuam funcionando e cobrando', ferr.status === 200 && ferr.data.credits?.charged === 3, `(status=${ferr.status})`);
const planos = await req('/api/plans');
check('a lista de planos continua de pé', planos.status === 200 && planos.data.items?.length === 6);
const notif = await req('/api/notifications', { token: A.token });
check('as notificações continuam de pé', notif.status === 200);
const prox = await req('/api/proxima-acao', { token: C.token });
check('a próxima ação continua de pé', prox.status === 200);
const sit = await req('/api/admin/estatisticas/situacao', { token: dono.token });
check('o painel lê a situação dos acompanhamentos', sit.status === 200 && !!sit.data.estados);
const recalc = await req('/api/admin/estatisticas/recalcular', { method: 'POST', token: dono.token });
check('o painel recalcula sob demanda', recalc.status === 200 && recalc.data.usuarios > 0, `(${JSON.stringify(recalc.data)})`);

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
await fake.close?.();
process.exit(fail ? 1 : 0);
