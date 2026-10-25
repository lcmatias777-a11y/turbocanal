// Pagamento por PERÍODO: um pagamento vale 2 meses, o anual vale 12 por 6
// pagamentos com 10% de desconto, e os créditos entram mês a mês.
// Aqui ficam as contas e as bordas de calendário, que são o que erra calado.
process.env.OWNER_EMAIL = 'dono@example.com';
const S = '/home/claude/turbocanal/server';
const { PERIODOS, A_VENDA, lerPeriodo, precoDoPeriodo, somarMeses } = await import(S + '/src/payments.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
const reais = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');

console.log('\n== A tabela de preços, plano por plano ==');
/* Modelo NOVO, pedido pelo dono: 1 mês em vez de 2, e o preço do ANO é um valor
 * PRÓPRIO de cada plano, não uma conta sobre o mensal. 99,00 não é 12 x 9,99
 * com nenhum desconto redondo, e foi justamente por isso que a fórmula antiga
 * (vezes x desconto) saiu do código. Estes são os valores semeados em db.js. */
const PLANOS = [
  ['Starter', 999, 9900], ['Creator', 1999, 19900], ['Pro', 3999, 39900],
  ['Studio', 6999, 69900], ['Max', 9999, 99900]
];
for (const [nome, mes, anoEsperado] of PLANOS) {
  const plan = { price_cents: mes, price_year_cents: anoEsperado };
  check(`${nome}: 1 mês custa o preço do plano (${reais(mes)})`, precoDoPeriodo(plan, '1m') === mes, String(precoDoPeriodo(plan, '1m')));
  check(`${nome}: 1 ano custa ${reais(anoEsperado)}`, precoDoPeriodo(plan, '12m') === anoEsperado, String(precoDoPeriodo(plan, '12m')));
  check(`${nome}: o ano é mais barato que doze pagamentos mensais`, anoEsperado < mes * 12, `${anoEsperado} vs ${mes * 12}`);
}
check('o Starter dá R$ 9,99 no mês e R$ 99,00 no ano',
  precoDoPeriodo({ price_cents: 999, price_year_cents: 9900 }, '1m') === 999
  && precoDoPeriodo({ price_cents: 999, price_year_cents: 9900 }, '12m') === 9900);

console.log('\n== Preço do ano não gravado: cai na conta antiga, nunca em zero ==');
/* Banco de antes da coluna price_year_cents. Cobrar zero por um ano de plano
 * seria o pior jeito de errar: silencioso e de graça. */
for (const [nome, mes] of PLANOS) {
  const antigo = { price_cents: mes, price_year_cents: 0 };
  const esperado = Math.round(mes * 12 * 0.9);
  check(`${nome}: sem preço de ano gravado, cobra ${reais(esperado)} e não zero`,
    precoDoPeriodo(antigo, '12m') === esperado && precoDoPeriodo(antigo, '12m') > 0, String(precoDoPeriodo(antigo, '12m')));
}
check('ano ausente (undefined) também não vira zero', precoDoPeriodo({ price_cents: 999 }, '12m') > 0);
check('ano nulo também não vira zero', precoDoPeriodo({ price_cents: 999, price_year_cents: null }, '12m') > 0);

console.log('\n== Os períodos, e o que pode ser COMPRADO ==');
check('1m vale 1 mês', PERIODOS['1m'].meses === 1);
check('12m vale 12 meses', PERIODOS['12m'].meses === 12);
check('período desconhecido cai no de 1 mês, não quebra',
  lerPeriodo('banana') === '1m' && lerPeriodo(null) === '1m' && lerPeriodo(undefined) === '1m' && lerPeriodo(12) === '1m');
check('2m continua existindo, para o extrato dos pagamentos antigos', PERIODOS['2m'].meses === 2 && lerPeriodo('2m') === '2m');
check('2m NÃO está à venda', PERIODOS['2m'].aVenda === false);
check('o que está à venda é exatamente 1m e 12m', A_VENDA.join(',') === '1m,12m', A_VENDA.join(','));
check('não existe período escondido além destes três', Object.keys(PERIODOS).sort().join(',') === '12m,1m,2m', Object.keys(PERIODOS).sort().join(','));
check('2m cobra um preço de plano, como cobrava no modelo antigo',
  precoDoPeriodo({ price_cents: 999, price_year_cents: 9900 }, '2m') === 999);

console.log('\n== Somar o prazo: paga de novo e o tempo SOMA ==');
const dias = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const agora = new Date('2026-03-10T12:00:00Z');

const primeiro = somarMeses(null, 2, agora);
check('primeira compra conta a partir de hoje', dias(primeiro, agora) > 55 && dias(primeiro, agora) < 65, primeiro);

const faltando = new Date('2026-04-10T12:00:00Z').toISOString(); // ainda faltam 31 dias
const somado = somarMeses(faltando, 2, agora);
check('pagar antes de vencer soma ao que falta, não recomeça do zero',
  dias(somado, agora) > 85 && dias(somado, agora) < 95, `${somado} (${dias(somado, agora)} dias)`);

const vencido = new Date('2026-01-10T12:00:00Z').toISOString(); // venceu faz 2 meses
const depoisDeVencer = somarMeses(vencido, 2, agora);
check('prazo vencido NÃO conta como crédito de tempo: começa de hoje',
  dias(depoisDeVencer, agora) > 55 && dias(depoisDeVencer, agora) < 65, `${depoisDeVencer} (${dias(depoisDeVencer, agora)} dias)`);

const ano = somarMeses(null, 12, agora);
check('o anual vale mesmo 12 meses', dias(ano, agora) > 360 && dias(ano, agora) < 370, `${dias(ano, agora)} dias`);

console.log('\n== Bordas de calendário (onde data costuma errar calada) ==');
const fim31 = somarMeses(null, 2, new Date('2026-12-31T12:00:00Z'));
check('31 de dezembro + 2 meses não vira data inválida', !isNaN(new Date(fim31).getTime()) && new Date(fim31) > new Date('2027-02-01'), fim31);
const bissexto = somarMeses(null, 12, new Date('2028-02-29T12:00:00Z'));
check('29 de fevereiro + 1 ano continua sendo uma data real', !isNaN(new Date(bissexto).getTime()), bissexto);
const viraAno = somarMeses(null, 2, new Date('2026-11-20T12:00:00Z'));
check('novembro + 2 meses cai em janeiro do ano seguinte', new Date(viraAno).getUTCFullYear() === 2027, viraAno);

console.log('\n== O administrador dando plano na mão ==');
// Buraco que apareceu depois: o administrador trocava o plano da conta e o
// prazo ficava vazio. A pessoa via "Starter" na tela e continuava recebendo só
// o piso, porque quem manda nos créditos é o PRAZO, não o nome do plano.
{
  const { randomUUID } = await import('node:crypto');
  const { buildApp } = await import(S + '/src/app.js');
  const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
  const { ACOES } = await import(S + '/src/pedidos.js');
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,last_refill,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, 'alvo@example.com', null, 'Alvo', 'user', 'free', 10, '2020-01', new Date().toISOString()]);
  const dono = { id: 'dono', email: 'dono@example.com', role: 'owner' };

  const def = ACOES.plano_do_usuario;
  const payload = await def.validar(db, { plan_id: 'p10', alvo_user: id });
  await def.executar(db, { payload, alvo_user: id }, dono);
  const comPlano = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  const dias = Math.round((new Date(comPlano.plano_ate) - new Date()) / 86400000);
  check('plano dado pelo administrador vem COM prazo (2 meses por padrão)',
    comPlano.plan_id === 'p10' && dias > 50 && dias < 70, JSON.stringify(comPlano));

  const { ensureRefill } = await import(S + '/src/credits.js');
  await ensureRefill(db, await db.get('SELECT * FROM users WHERE id=?', [id]));
  const saldo = Number((await db.get('SELECT credits FROM users WHERE id=?', [id])).credits);
  check('e aí a pessoa recebe mesmo os créditos do plano, não o piso', saldo === 60000, String(saldo));

  const voltar = await def.validar(db, { plan_id: 'free', alvo_user: id });
  await def.executar(db, { payload: voltar, alvo_user: id }, dono);
  const semPlano = await db.get('SELECT plan_id, plano_ate FROM users WHERE id=?', [id]);
  check('voltar para o Free limpa o prazo, não deixa data órfã',
    semPlano.plan_id === 'free' && !semPlano.plano_ate, JSON.stringify(semPlano));
}

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
process.exit(fail ? 1 : 0);
