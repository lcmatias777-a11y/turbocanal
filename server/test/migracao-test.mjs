// O site sobe num banco que JA EXISTE, criado por uma versao anterior?
//
// Este arquivo existe por causa de uma falha real em producao. A carga inicial
// passou a inserir em `plans` usando a coluna nova price_year_cents, e o ALTER
// que cria essa coluna estava trinta linhas ABAIXO, na mesma funcao. Em banco
// NOVO isso nunca aparece, porque o CREATE TABLE ja nasce com a coluna: os 37
// arquivos de teste passaram, e o deploy morreu com
//   column "price_year_cents" of relation "plans" does not exist
// porque o banco de producao foi criado antes da coluna existir.
//
// Todo teste daqui comeca de um banco limpo, e e justamente por isso que
// nenhum deles pegava essa classe de erro. O jeito de pegar e este: abrir o
// banco, DESFAZER as colunas novas (virando o esquema antigo), e abrir de novo.
// Se a migracao estiver fora de ordem, o segundo openDb quebra igual quebrou
// em producao.
delete process.env.DATABASE_URL;
process.env.OWNER_EMAIL = 'dono@example.com';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = '/home/claude/turbocanal/server';
const { openDb } = await import(S + '/src/db.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } };

const dir = mkdtempSync(join(tmpdir(), 'tc-migra-'));

/* As colunas acrescentadas por ALTER depois que o site ja estava no ar. Cada
 * uma dessas existe em producao SO porque a migracao rodou; um banco criado
 * antes dela nao a tem. Tirar a coluna e voltar no tempo. */
const COLUNAS_NOVAS = [
  ['plans', 'price_year_cents'],
  ['users', 'plano_ate'],
  ['users', 'banido'],
  ['users', 'banido_motivo'],
  ['users', 'sessao_v'],
  ['users', 'foto_url'],
  ['payments', 'periodo'],
  ['demo_edicoes', 'capa'],
  ['chat_bloqueios', 'onde']
];

console.log('\n== Primeiro: um banco novo abre normalmente ==');
let db = await openDb({ dataDir: dir });
const planos = await db.all('SELECT id, price_cents, price_year_cents FROM plans ORDER BY sort');
check('o banco novo abriu e semeou os planos', planos.length >= 6, String(planos.length));
check('o Starter nasce com R$ 9,99 no mes e R$ 99,00 no ano',
  planos.some((p) => p.id === 'p10' && Number(p.price_cents) === 999 && Number(p.price_year_cents) === 9900),
  JSON.stringify(planos.find((p) => p.id === 'p10')));

console.log('\n== Agora o banco ANTIGO: sem nenhuma das colunas que vieram depois ==');
const tiradas = [];
for (const [tabela, coluna] of COLUNAS_NOVAS) {
  try {
    await db.run(`ALTER TABLE ${tabela} DROP COLUMN ${coluna}`);
    tiradas.push(`${tabela}.${coluna}`);
  } catch (e) {
    console.log(`  (nao deu para tirar ${tabela}.${coluna}: ${e.message})`);
  }
}
check('deu para simular o esquema antigo tirando as colunas', tiradas.length === COLUNAS_NOVAS.length,
  `tirou ${tiradas.length} de ${COLUNAS_NOVAS.length}: ${tiradas.join(', ')}`);
// Tira tambem as tabelas que nasceram depois, pelo mesmo motivo.
for (const t of ['hotmart_eventos', 'hotmart_pendentes']) {
  try { await db.run(`DROP TABLE ${t}`); } catch {}
}
if (db.close) await db.close();

console.log('\n== O site tem de subir nesse banco, sem erro ==');
let erro = null, db2 = null;
try {
  db2 = await openDb({ dataDir: dir });
} catch (e) {
  erro = e;
}
check('abrir o banco antigo NAO quebra', !erro, erro ? `${erro.message}` : '');

if (db2) {
  console.log('\n== E as colunas voltaram, com os dados de antes intactos ==');
  for (const [tabela, coluna] of COLUNAS_NOVAS) {
    let ok = false;
    try { await db2.get(`SELECT ${coluna} FROM ${tabela} LIMIT 1`); ok = true; } catch {}
    check(`${tabela}.${coluna} existe de novo`, ok);
  }
  for (const t of ['hotmart_eventos', 'hotmart_pendentes']) {
    let ok = false;
    try { await db2.get(`SELECT 1 AS x FROM ${t} LIMIT 1`); ok = true; } catch {}
    check(`a tabela ${t} foi recriada`, ok);
  }
  const p10 = await db2.get("SELECT price_cents, price_year_cents FROM plans WHERE id='p10'");
  check('o plano continua existindo depois da migracao', !!p10, JSON.stringify(p10));
  check('a coluna recriada recebe o preco do ano, e nao fica em zero',
    Number(p10?.price_year_cents) === 9900, String(p10?.price_year_cents));
  check('o preco do mes nao foi perdido', Number(p10?.price_cents) === 999, String(p10?.price_cents));
  if (db2.close) await db2.close();
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULTADO migracao-test: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
