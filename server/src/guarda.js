// Guarda de escrita: classifica a ESCRITA, não a rota.
//
// Por que existe. O censo de rotas (server/test/fila-test.mjs) obriga toda
// rota administrativa de escrita a estar classificada em FILA, SO_DONO ou
// LIVRE. Isso impede rota nova sem decisão consciente, mas não impede o outro
// erro: eu classificar uma rota como inofensiva e, dentro dela, mexer em
// crédito, plano, preço, pagamento ou configuração. O censo passaria feliz.
//
// Aqui a conta é outra: a escrita perigosa é reconhecida no banco, na hora de
// acontecer, e só passa se a requisição tiver passado por uma decisão
// consciente, que é uma destas duas:
//   - a fila (pedirOuFazer executou, porque é o principal ou porque ele disse
//     Sim a um pedido);
//   - uma rota exclusiva do administrador principal (auth.owner).
// Sem isso a escrita não acontece: estoura erro em desenvolvimento e no teste,
// com o nome da rota e da tabela, em vez de passar em silêncio.
//
// O que NÃO entra aqui: uso normal do site. Um usuário gastando os próprios
// créditos numa ferramenta não passa por rota administrativa e não mexe em
// tabela do site, então a guarda nem olha.

import { AsyncLocalStorage } from 'node:async_hooks';

export const contexto = new AsyncLocalStorage();

/** Tabelas do SITE: ninguém deveria escrever nelas fora de uma decisão
 *  consciente, venha a escrita de onde vier. */
const TABELAS_DO_SITE = ['plans', 'tool_costs', 'blocos'];

/** "settings" guarda configuração E anotação interna do próprio site (contador
 *  de cota da API, token de primeira configuração). Guardar a tabela inteira
 *  barraria o site funcionando normalmente, então aqui ela só é vigiada
 *  quando a escrita vem de uma rota administrativa, que é exatamente onde o
 *  buraco estava. */
const TABELAS_DO_SITE_EM_ADMIN = ['settings'];

/** Colunas de CONTA que só mudam por decisão administrativa. Fora de
 *  /api/admin a guarda não olha: é o usuário mexendo na própria vida. */
const COLUNAS_DE_CONTA = ['credits', 'plan_id', 'role', 'banido'];

/* O QUE ESTA GUARDA NÃO VÊ, escrito aqui para não ser redescoberto do jeito
 * difícil: ela lê a instrução que o site manda para o banco. Se um dia existir
 * um gatilho (TRIGGER) ou uma chave com CASCADE, o efeito dele acontece dentro
 * do banco e a guarda não enxerga. Hoje isso não é problema porque o esquema
 * não tem nenhum dos dois (procurado em db.js: zero CREATE TRIGGER, zero
 * ON DELETE/UPDATE CASCADE). É uma propriedade do esquema de hoje, não uma
 * garantia desta guarda: quem criar o primeiro gatilho precisa rever isto. */

/** Tira da instrução tudo o que pode esconder uma escrita de uma busca por
 *  texto: comentários, literais de texto e aspas de identificador. Os literais
 *  viram '' porque o conteúdo deles NÃO é código: era por isso que um nome de
 *  usuário escrito como "credits = 999" era classificado como alteração de
 *  créditos, e um UPDATE de verdade escondido atrás de /* ... *\/ passava. */
function normalizar(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // comentário de bloco
    .replace(/--[^\n]*/g, ' ')            // comentário de linha
    .replace(/'(?:''|[^'])*'/g, "''")     // literal de texto (o conteúdo não é código)
    .replace(/"([a-zA-Z_][a-zA-Z0-9_$]*)"/g, '$1') // "plans" -> plans
    .replace(/\s+/g, ' ')
    .trim();
}

/** Toda escrita da instrução, não só a primeira palavra. Pega UPDATE/DELETE/
 *  INSERT em qualquer posição, o que cobre WITH ... UPDATE, duas instruções
 *  separadas por ponto e vírgula e o UPDATE de um ON CONFLICT. O preço de pegar
 *  demais é bloquear escrita legítima, e isso aparece na hora, no teste. */
const ESCRITA = /\b(insert\s+into|update|delete\s+from)\s+(?:[a-z_][a-z0-9_$]*\s*\.\s*)?([a-z_][a-z0-9_$]*)/gi;

/** Só o que a instrução ESCREVE: o trecho entre SET e WHERE/RETURNING, mais o
 *  DO UPDATE SET de um ON CONFLICT e a lista de colunas de um INSERT. Olhar o
 *  SQL inteiro dava falso positivo quando a coluna aparecia só no WHERE. */
function trechoEscrito(sql) {
  const partes = [];
  for (const m of sql.matchAll(/\bset\b([\s\S]*?)(?=\bwhere\b|\breturning\b|\bfrom\b|$)/gi)) partes.push(m[1]);
  for (const m of sql.matchAll(/\binsert\s+into\s+(?:[a-z_][a-z0-9_$]*\s*\.\s*)?[a-z_][a-z0-9_$]*\s*\(([^)]*)\)/gi)) partes.push(m[1]);
  return partes.join(' , ');
}

/** Toda tabela que a instrução escreve, protegida ou não. */
export function tabelasEscritas(sql) {
  const limpo = normalizar(sql);
  return [...new Set([...limpo.matchAll(ESCRITA)].map((m) => m[2].toLowerCase()))];
}

/** O que esta instrução escreve, se for escrita perigosa. */
export function classificar(sql, { rotaAdmin }) {
  const limpo = normalizar(sql);
  const escritas = [...limpo.matchAll(ESCRITA)];
  if (!escritas.length) return null;
  const escrito = trechoEscrito(limpo);

  for (const m of escritas) {
    const tabela = m[2].toLowerCase();
    if (TABELAS_DO_SITE.includes(tabela)) return { tabela, motivo: 'tabela do site' };
    if (!rotaAdmin) continue;
    if (TABELAS_DO_SITE_EM_ADMIN.includes(tabela)) return { tabela, motivo: 'configuração do site' };
    if (tabela === 'payments' && /\bstatus\b/i.test(escrito)) return { tabela, motivo: 'situação de pagamento' };
    if (tabela === 'chat_publico' && /\bstatus\b/i.test(escrito)) return { tabela, motivo: 'situação de mensagem' };
    if (tabela === 'users') {
      // TODAS as colunas de conta tocadas, não só a primeira. Com a primeira,
      // "SET credits=1, role='owner'" dentro de um escape aberto para
      // users:credits deixava o role passar de carona.
      const cols = COLUNAS_DE_CONTA.filter((c) => new RegExp(`(^|[^a-z0-9_.])(?:[a-z_][a-z0-9_$]*\\.)?${c}\\s*=`, 'i').test(escrito)
        || new RegExp(`(^|[^a-z0-9_])${c}(?=\\s*[,)])`, 'i').test(escrito));
      if (cols.length) return { tabela, colunas: cols, motivo: `${cols.join(' e ')} de uma conta` };
      // DELETE FROM users não tem coluna nenhuma para conferir, e apagar conta
      // é no mínimo tão sério quanto mudar o papel dela.
      if (/\bdelete\s+from\s+(?:[a-z_][a-z0-9_$]*\s*\.\s*)?users\b/i.test(limpo)) {
        return { tabela, motivo: 'exclusão de conta' };
      }
    }
  }
  return null;
}

/** Abre o contexto da requisição. Fora de requisição (agendador, migração do
 *  banco, scripts) não há contexto, e aí a guarda BARRA: quem precisa escrever
 *  ali usa tarefaDoSite('nome', [tabelas], fn) e diz por escrito o que escreve. */
export function middleware(req, res, next) {
  const rotaAdmin = req.path.startsWith('/api/admin/') && req.method !== 'GET';
  contexto.run({ rota: `${req.method} ${req.path}`, rotaAdmin, autorizado: null }, next);
}

/** Autorização que vale para a REQUISIÇÃO inteira. Só as rotas marcadas com
 *  auth.owner usam isto, e ali faz sentido: a rota inteira é exclusiva do
 *  administrador principal, então tudo o que ela escreve é decisão dele. */
export function autorizarRota(motivo) {
  const c = contexto.getStore();
  if (c) c.autorizado = motivo;
}

/** Autorização presa à OPERAÇÃO: vale só enquanto fn roda, e acaba quando ela
 *  termina. É o que a fila usa.
 *
 *  Antes era `autorizar(motivo)` e o aval ficava ligado até o fim da
 *  requisição: uma ação aprovada na fila liberava, sem querer, qualquer outra
 *  escrita protegida que acontecesse depois dela na mesma requisição. Uma
 *  aprovação vale para o que foi aprovado, e nada mais. */
export function comAutorizacao(motivo, fn) {
  const c = contexto.getStore();
  if (!c) return fn();
  return contexto.run({ ...c, autorizado: motivo }, fn);
}

/** Escrita do próprio site, não de um administrador: a recarga mensal do
 *  plano Free, o contador de cota da API. Elas acontecem sozinhas, no meio de
 *  qualquer requisição, inclusive numa rota administrativa, e não são decisão
 *  de ninguém. Só isto fica de fora da guarda, e fica de forma explícita:
 *  quem escrever `semGuarda` num lugar novo está dizendo, por escrito, que
 *  aquela escrita não é ação de administrador.
 *  O desligamento vale só para o trecho passado aqui, e não vaza para o
 *  resto da requisição. */
export function semGuarda(motivo, tabelas, fn) {
  const c = contexto.getStore();
  const permitido = { motivo, completo: true, tabelas: new Set(tabelas.map((t) => t.toLowerCase())) };
  if (!c) return contexto.run({ rota: 'interno: ' + motivo, rotaAdmin: false, autorizado: null, permitido }, fn);
  return contexto.run({ ...c, permitido }, fn);
}

/** Trabalho do próprio site que roda FORA de uma requisição: a carga inicial
 *  do banco e as tarefas de hora em hora. Antes elas passavam porque a guarda
 *  liberava tudo o que não tinha contexto, e a falta de contexto virava, na
 *  prática, uma permissão. Agora a guarda barra por padrão e quem roda fora de
 *  requisição tem de dizer o nome, por escrito, aqui. */
export function tarefaDoSite(nome, tabelas, fn) {
  return contexto.run(
    // completo: false — uma tarefa de fundo roda o trabalho inteiro do site e
    // escreve em muita tabela comum; aqui a lista vale para as PROTEGIDAS.
    { rota: 'tarefa: ' + nome, rotaAdmin: false, autorizado: null, permitido: { motivo: nome, completo: false, tabelas: new Set(tabelas.map((t) => t.toLowerCase())) } },
    fn
  );
}

export function estaAutorizado() {
  return contexto.getStore()?.autorizado || null;
}

export class EscritaBloqueada extends Error {
  constructor(msg) { super(msg); this.name = 'EscritaBloqueada'; this.status = 500; }
}

/** Verificação, chamada pelo banco a cada escrita. */
export function conferir(sql) {
  const c = contexto.getStore();
  if (c?.autorizado) return;            // passou pela fila ou é rota do dono
  // Sem contexto nenhum: NÃO libera. Antes liberava, e aí bastava mover uma
  // escrita administrativa para dentro de um setTimeout, de uma fila em
  // memória ou de um script para a guarda ficar calada. Quem precisa escrever
  // fora de requisição usa tarefaDoSite('nome', ...), que é uma decisão escrita.
  // Dentro de um escape a conferência é a mais rígida que existe (rotaAdmin),
  // mesmo que a requisição não seja administrativa: quem abriu o escape disse
  // exatamente o que ia escrever, e fora disso não passa nada. Sem isto, um
  // escape aberto numa página comum ainda deixava mexer em papel ou banimento.
  const achado = classificar(sql, { rotaAdmin: !!(c?.permitido || c?.rotaAdmin) });

  // DENTRO de um escape a lista declarada e a lista COMPLETA: qualquer escrita
  // em tabela que nao esteja nela e barrada, protegida ou nao. Antes, escrita
  // em tabela "inofensiva" nem chegava aqui, entao a declaracao valia so para
  // metade do que a funcao fazia. Fechado por padrao: o que nao foi declarado
  // nao passa, inclusive instrucao que a classificacao nao reconheceu.
  if (c?.permitido?.completo) {
    const tabelas = tabelasEscritas(sql);
    const fora = tabelas.filter((t) => !c.permitido.tabelas.has(t)
      && ![...c.permitido.tabelas].some((d) => d.split(':')[0] === t));
    if (fora.length) {
      throw new EscritaBloqueada(
        `Escrita bloqueada pela guarda: "${c.permitido.motivo}" declarou que escreve em ` +
        `[${[...c.permitido.tabelas].join(', ') || 'nada'}], mas tentou escrever em ` +
        `[${fora.join(', ')}]. Isto é erro de programação, não do usuário.`
      );
    }
  }

  if (!achado) return;
  // Escape do próprio site: vale só para as tabelas que quem o abriu declarou.
  // Era um cheque em branco: qualquer escrita protegida passava dentro dele,
  // inclusive de uma função auxiliar chamada lá de dentro sem ninguém notar.
  if (c?.permitido) {
    // A lista aceita a tabela inteira ("transactions") ou so uma coluna dela
    // ("users:credits"). Liberar users inteiro deixava uma funcao com erro
    // mexer em role ou banido dentro de um escape aberto para recarregar credito.
    // Toda coluna tocada precisa estar declarada: basta uma de fora para barrar.
    if (achado.colunas && achado.colunas.every((col) => c.permitido.tabelas.has(`${achado.tabela}:${col}`))) return;
    if (c.permitido.tabelas.has(achado.tabela)) return;
    throw new EscritaBloqueada(
      `Escrita bloqueada pela guarda: "${c.permitido.motivo}" só pode escrever em ` +
      `[${[...c.permitido.tabelas].join(', ') || 'nenhuma tabela protegida'}], mas tentou alterar ` +
      `${achado.motivo} (tabela "${achado.tabela}"). Isto é erro de programação, não do usuário.`
    );
  }
  const onde = c?.rota || 'fora de qualquer requisição';
  throw new EscritaBloqueada(
    `Escrita bloqueada pela guarda: ${onde} tentou alterar ${achado.motivo} (tabela "${achado.tabela}") ` +
    'sem passar pela fila de aprovação nem ser uma rota exclusiva do administrador principal. ' +
    'Use pedirOuFazer() para a ação entrar na fila, marque a rota com auth.owner se ela for só do principal, ' +
    'ou embrulhe em tarefaDoSite() se for trabalho do próprio site fora de requisição. ' +
    'Isto é erro de programação, não do usuário.'
  );
}
