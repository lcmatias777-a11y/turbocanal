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

const ESCRITA = /^\s*(insert\s+into|update|delete\s+from)\s+([a-z_]+)/i;

/** O que esta instrução escreve, se for escrita perigosa. */
export function classificar(sql, { rotaAdmin }) {
  const m = ESCRITA.exec(String(sql || ''));
  if (!m) return null;
  const tabela = m[2].toLowerCase();

  if (TABELAS_DO_SITE.includes(tabela)) return { tabela, motivo: 'tabela do site' };

  if (rotaAdmin) {
    if (TABELAS_DO_SITE_EM_ADMIN.includes(tabela)) return { tabela, motivo: 'configuração do site' };
    if (tabela === 'payments' && /\bstatus\b/i.test(sql)) return { tabela, motivo: 'situação de pagamento' };
    if (tabela === 'chat_publico' && /\bstatus\b/i.test(sql)) return { tabela, motivo: 'situação de mensagem' };
    if (tabela === 'users') {
      const col = COLUNAS_DE_CONTA.find((c) => new RegExp(`\\b${c}\\s*=`, 'i').test(sql));
      if (col) return { tabela, motivo: `${col} de uma conta` };
    }
  }
  return null;
}

/** Abre o contexto da requisição. Fora de requisição (agendador, migração do
 *  banco, scripts) não há contexto, e a guarda deixa passar: ali não existe
 *  administrador tentando pular a fila. */
export function middleware(req, res, next) {
  const rotaAdmin = req.path.startsWith('/api/admin/') && req.method !== 'GET';
  contexto.run({ rota: `${req.method} ${req.path}`, rotaAdmin, autorizado: null }, next);
}

/** Chamado quando a decisão consciente acontece. */
export function autorizar(motivo) {
  const c = contexto.getStore();
  if (c) c.autorizado = motivo;
}

/** Escrita do próprio site, não de um administrador: a recarga mensal do
 *  plano Free, o contador de cota da API. Elas acontecem sozinhas, no meio de
 *  qualquer requisição, inclusive numa rota administrativa, e não são decisão
 *  de ninguém. Só isto fica de fora da guarda, e fica de forma explícita:
 *  quem escrever `semGuarda` num lugar novo está dizendo, por escrito, que
 *  aquela escrita não é ação de administrador.
 *  O desligamento vale só para o trecho passado aqui, e não vaza para o
 *  resto da requisição. */
export function semGuarda(fn) {
  const c = contexto.getStore();
  if (!c) return fn();
  return contexto.run({ ...c, interno: true }, fn);
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
  if (!c) return;                       // fora de requisição
  if (c.interno) return;                // escrita do próprio site (semGuarda)
  if (c.autorizado) return;             // passou pela fila ou é rota do dono
  const achado = classificar(sql, c);
  if (!achado) return;
  throw new EscritaBloqueada(
    `Escrita bloqueada pela guarda: ${c.rota} tentou alterar ${achado.motivo} (tabela "${achado.tabela}") ` +
    'sem passar pela fila de aprovação nem ser uma rota exclusiva do administrador principal. ' +
    'Use pedirOuFazer() para a ação entrar na fila, ou marque a rota com auth.owner se ela for só do principal. ' +
    'Isto é erro de programação, não do usuário.'
  );
}
