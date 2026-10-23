// Ataques do GPT contra a guarda de escrita (guarda.js).
// Cada bloco e um ataque concreto: monta a situacao, roda a escrita e exige
// que ela NAO aconteca. Nasceram de uma revisao externa do codigo, que achou
// buracos que os meus proprios testes nao achavam.
process.env.OWNER_EMAIL = 'dono@example.com';
const S = '/home/claude/turbocanal/server';
const g = await import(S + '/src/guarda.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
const bloqueia = (sql, ctx = { rotaAdmin: true }) => {
  try { g.contexto.run({ rota: 'POST /api/admin/teste', autorizado: null, ...ctx }, () => g.conferir(sql)); return false; }
  catch (e) { return e.name === 'EscritaBloqueada'; }
};

/* ---- 1) o que a expressao regular nao enxergava ---- */
console.log('\n1) SQL que o Postgres aceita e a guarda precisa enxergar');
check('UPDATE simples numa tabela do site', bloqueia('UPDATE plans SET price_cents = 0 WHERE id=?'));
check('comentario de bloco antes da escrita', bloqueia('/* parece inocente */ UPDATE plans SET price_cents = 0'));
check('comentario de linha antes da escrita', bloqueia('-- nada para ver aqui\nUPDATE plans SET price_cents = 0'));
check('WITH ... UPDATE', bloqueia('WITH alvo AS (SELECT id FROM plans WHERE id=1) UPDATE plans SET price_cents=0 WHERE id IN (SELECT id FROM alvo)'));
check('WITH ... DELETE', bloqueia('WITH alvo AS (SELECT id FROM blocos) DELETE FROM blocos WHERE id IN (SELECT id FROM alvo)'));
check('nome da tabela entre aspas', bloqueia('UPDATE "plans" SET price_cents = 0 WHERE id=?'));
check('espaco e quebra de linha antes', bloqueia('\n\n   UPDATE\n  plans\n  SET price_cents = 0'));
check('MAIUSCULAS e minusculas misturadas', bloqueia('UpDaTe PlAnS sEt price_cents = 0'));
check('duas instrucoes numa chamada so', bloqueia("UPDATE audit SET detail='x'; UPDATE plans SET price_cents=0"));
check('schema na frente da tabela', bloqueia('UPDATE public.plans SET price_cents = 0'));
check('INSERT ... ON CONFLICT DO UPDATE numa tabela do site', bloqueia('INSERT INTO tool_costs(tool,cost) VALUES(?,?) ON CONFLICT(tool) DO UPDATE SET cost=EXCLUDED.cost'));

/* ---- 2) coluna de conta: nem falso positivo, nem falso negativo ---- */
console.log('\n2) alteracao de coluna de conta');
check('credits = credits + 1 e alteracao de creditos', bloqueia('UPDATE users SET credits = credits + 1 WHERE id=?'));
check('"credits" entre aspas tambem e', bloqueia('UPDATE users SET "credits" = 0 WHERE id=?'));
check('u.credits qualificado tambem e', bloqueia('UPDATE users SET u.credits = 0 WHERE id=?'));
check('role = admin e alteracao de papel', bloqueia("UPDATE users SET role='admin' WHERE id=?"));
check('texto que CONTEM "credits =" nao e alteracao de creditos',
  !bloqueia("UPDATE users SET name = 'credits = 999' WHERE id=?"));
check('valor por parametro nao vira alteracao de creditos',
  !bloqueia('UPDATE users SET name = ? WHERE id=?'));
check('credits so no WHERE nao e alteracao', !bloqueia('UPDATE users SET name=? WHERE credits = 0'));
check('credits E role na mesma instrucao sao os dois reconhecidos',
  bloqueia("UPDATE users SET credits = 1, role = 'owner' WHERE id=?"));
check('apagar conta numa rota administrativa e reconhecido', bloqueia('DELETE FROM users WHERE id=?'));

/* ---- 3) a autorizacao nao pode sobreviver ao seu proposito ---- */
console.log('\n3) autorizacao presa a operacao, nao a requisicao inteira');
let dentro = null, depois = null;
g.contexto.run({ rota: 'POST /api/admin/pedidos/x/decidir', rotaAdmin: true, autorizado: null }, () => {
  g.comAutorizacao('fila: teste', () => { try { g.conferir('UPDATE plans SET price_cents=0'); dentro = 'passou'; } catch { dentro = 'bloqueou'; } });
  try { g.conferir('UPDATE users SET credits = 999 WHERE id=?'); depois = 'passou'; } catch { depois = 'bloqueou'; }
});
check('a escrita autorizada acontece dentro do escopo', dentro === 'passou', String(dentro));
check('uma segunda escrita protegida, fora do escopo, e bloqueada', depois === 'bloqueou', String(depois));

/* ---- 4) o escape semGuarda nao pode ser um cheque em branco ---- */
// A lista de propriedades abaixo e a checklist que o GPT exigiu antes de
// considerar o escape resolvido. Cada linha e uma delas.
console.log('\n4) semGuarda so escreve no que declarou');
const prova = (fn) => { try { fn(); return 'passou'; } catch (e) { return e.name === 'EscritaBloqueada' ? 'bloqueou' : 'erro:' + e.message; } };

let auto = null, vizinha = null, auxiliar = null, depoisDele = null, papel = null, banir = null, juntos = null, apagar = null, tabelaDeFora = null, tabelaDeclarada = null;
g.contexto.run({ rota: 'GET /api/me', rotaAdmin: false, autorizado: null }, () => {
  g.semGuarda('recarga mensal do plano Free', ['users:credits', 'transactions'], () => {
    auto = prova(() => g.conferir('UPDATE users SET credits = credits + 100 WHERE id=?'));
    papel = prova(() => g.conferir("UPDATE users SET role = 'owner' WHERE id=?"));
    banir = prova(() => g.conferir('UPDATE users SET banido = 1 WHERE id=?'));
    juntos = prova(() => g.conferir("UPDATE users SET credits = 1, role = 'owner' WHERE id=?"));
    apagar = prova(() => g.conferir('DELETE FROM users WHERE id=?'));
    tabelaDeFora = prova(() => g.conferir('INSERT INTO audit(id) VALUES(?)'));
    tabelaDeclarada = prova(() => g.conferir('INSERT INTO transactions(id) VALUES(?)'));
    vizinha = prova(() => g.conferir('UPDATE plans SET price_cents = 0'));
    const auxiliarQueNinguemOlhou = () => g.conferir('UPDATE tool_costs SET cost = 0');
    auxiliar = prova(auxiliarQueNinguemOlhou);
  });
  depoisDele = prova(() => g.conferir('UPDATE plans SET price_cents=0'));
});
check('a escrita automatica legitima funciona', auto === 'passou', String(auto));
check('escape aberto para credito NAO consegue mexer no papel da conta', papel === 'bloqueou', String(papel));
check('escape aberto para credito NAO consegue banir ninguem', banir === 'bloqueou', String(banir));
check('credito E papel na MESMA instrucao: o papel nao passa de carona', juntos === 'bloqueou', String(juntos));
check('escape aberto para credito NAO consegue apagar conta', apagar === 'bloqueou', String(apagar));
check('escape so escreve nas tabelas que declarou, protegidas ou nao', tabelaDeFora === 'bloqueou', String(tabelaDeFora));
check('e escreve normalmente na tabela comum que declarou', tabelaDeclarada === 'passou', String(tabelaDeclarada));
check('escrita protegida NAO declarada e bloqueada dentro do escape', vizinha === 'bloqueou', String(vizinha));
check('funcao auxiliar chamada de dentro nao amplia o escopo', auxiliar === 'bloqueou', String(auxiliar));
check('o escape nao vaza para o resto da requisicao', depoisDele === 'bloqueou', String(depoisDele));

// Excecao e Promise rejeitada nao podem deixar a guarda desligada
let depoisDeErro = null;
g.contexto.run({ rota: 'GET /api/me', rotaAdmin: false, autorizado: null }, () => {
  try { g.semGuarda('teste', ['users'], () => { throw new Error('falha simulada'); }); } catch {}
  depoisDeErro = prova(() => g.conferir('UPDATE plans SET price_cents=0'));
});
check('excecao dentro do escape nao deixa a guarda desligada', depoisDeErro === 'bloqueou', String(depoisDeErro));

const depoisDeRejeitar = await new Promise((ok) => {
  g.contexto.run({ rota: 'GET /api/me', rotaAdmin: false, autorizado: null }, async () => {
    await g.semGuarda('teste', ['users'], async () => { throw new Error('rejeitou'); }).catch(() => {});
    ok(prova(() => g.conferir('UPDATE plans SET price_cents=0')));
  });
});
check('Promise rejeitada no escape nao deixa a guarda desligada', depoisDeRejeitar === 'bloqueou', String(depoisDeRejeitar));

// Rota administrativa nao ganha acesso irrestrito por usar o escape
let porRotaAdmin = null;
g.contexto.run({ rota: 'POST /api/admin/qualquer', rotaAdmin: true, autorizado: null }, () => {
  g.semGuarda('recarga mensal do plano Free', ['users:credits', 'transactions'], () => {
    porRotaAdmin = prova(() => g.conferir("UPDATE settings SET value='0' WHERE key='payments_enabled'"));
  });
});
check('rota administrativa nao ganha acesso irrestrito pelo escape', porRotaAdmin === 'bloqueou', String(porRotaAdmin));

// Tarefa agendada DENTRO do escape herda o contexto; ela nao pode herdar mais
// do que foi declarado.
const tarefaDepois = await new Promise((ok) => {
  g.contexto.run({ rota: 'GET /api/me', rotaAdmin: false, autorizado: null }, () => {
    g.semGuarda('recarga mensal do plano Free', ['users', 'transactions'], () => {
      setTimeout(() => ok(prova(() => g.conferir('UPDATE plans SET price_cents=0'))), 10);
    });
  });
});
check('tarefa assincrona iniciada dentro do escape nao herda privilegio indevido', tarefaDepois === 'bloqueou', String(tarefaDepois));

// tarefaDoSite com lista vazia nao pode escrever em tabela protegida nenhuma
let tarefaVazia = null, tarefaCerta = null;
g.tarefaDoSite('agendador sem escrita de site', [], () => { tarefaVazia = prova(() => g.conferir('UPDATE plans SET price_cents=0')); });
g.tarefaDoSite('carga inicial', ['plans'], () => { tarefaCerta = prova(() => g.conferir('UPDATE plans SET price_cents=0')); });
check('tarefa do site sem tabelas declaradas nao escreve em tabela protegida', tarefaVazia === 'bloqueou', String(tarefaVazia));
check('tarefa do site escreve no que declarou', tarefaCerta === 'passou', String(tarefaCerta));

/* ---- 5) escrita fora de requisicao ---- */
console.log('\n5) escrita sem contexto nenhum');
let fora = null;
try { g.conferir('UPDATE plans SET price_cents = 0'); fora = 'passou'; } catch { fora = 'bloqueou'; }
check('escrita protegida fora de requisicao e bloqueada', fora === 'bloqueou', String(fora));

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
process.exit(fail ? 1 : 0);
