// Camada de banco: Postgres em produção (DATABASE_URL) e PGlite (Postgres embutido)
// para desenvolvimento local e testes. Mesma API nos dois casos:
//   db.get(sql, params) -> linha | undefined
//   db.all(sql, params) -> linhas
//   db.run(sql, params) -> { changes }
//   db.tx(async (q) => {...})  -> transação (q tem get/all/run)
// Placeholders: use "?" (convertidos para $1, $2, ... automaticamente).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { conferir } from './guarda.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  plan_id TEXT NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 0,
  last_refill TEXT,
  google_sub TEXT,
  banido INTEGER NOT NULL DEFAULT 0,
  banido_motivo TEXT NOT NULL DEFAULT '',
  sessao_v INTEGER NOT NULL DEFAULT 0,
  foto_url TEXT,
  -- Até quando o plano pago vale. Cada pagamento compra um período; enquanto
  -- esta data estiver no futuro, a recarga mensal entrega os créditos do plano
  -- em vez do piso gratuito. Vazio = conta sem plano pago valendo.
  plano_ate TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  -- Preco do ANO, em centavos. E um valor proprio, nao uma conta sobre o mensal:
  -- 99,00 nao e 12 x 9,99 com nenhum desconto redondo. Zero significa "nao
  -- gravado", e ai o codigo cai na conta antiga (12x menos 10%) para nunca
  -- cobrar zero por um ano de plano.
  price_year_cents INTEGER NOT NULL DEFAULT 0,
  monthly_credits INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT
);
CREATE TABLE IF NOT EXISTS tool_costs (
  tool TEXT PRIMARY KEY,
  cost INTEGER NOT NULL,
  label TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER,
  tool TEXT,
  note TEXT,
  idem_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_idem ON transactions(user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  provider TEXT,
  provider_id TEXT,
  status TEXT NOT NULL,
  -- Quantos meses este pagamento compra: '1m' (um mês) ou '12m' (o ano).
  -- Pagamentos antigos guardam '2m', do modelo que vendia dois meses de uma vez.
  periodo TEXT NOT NULL DEFAULT '1m',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_provider ON payments(provider_id);
-- Toda chamada do webhook da Hotmart fica gravada aqui, com o corpo inteiro.
-- E o que permite conferir o formato real do aviso, entender por que um acesso
-- nao saiu, e liberar na mao quando preciso.
CREATE TABLE IF NOT EXISTS hotmart_eventos (
  id TEXT PRIMARY KEY,
  evento TEXT NOT NULL,
  transacao TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  produto TEXT NOT NULL DEFAULT '',
  oferta TEXT NOT NULL DEFAULT '',
  resultado TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '',
  corpo TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hm_transacao ON hotmart_eventos(transacao, evento);
CREATE INDEX IF NOT EXISTS idx_hm_data ON hotmart_eventos(created_at);
-- Compra que chegou antes da conta existir: quem compra na Hotmart ainda nao
-- tem conta no site. Fica guardada aqui e entra no primeiro acesso de quem usar
-- esse mesmo e-mail.
CREATE TABLE IF NOT EXISTS hotmart_pendentes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  periodo TEXT NOT NULL DEFAULT '1m',
  oferta TEXT NOT NULL DEFAULT '',
  transacao TEXT NOT NULL DEFAULT '',
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  aplicado_em TEXT,
  cancelado_em TEXT,
  user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_hmp_email ON hotmart_pendentes(email, aplicado_em);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(created_at);
-- Conexão YouTube (OAuth) por usuário
CREATE TABLE IF NOT EXISTS yt_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expires_at BIGINT,
  channel_id TEXT,
  channel_title TEXT,
  scopes TEXT,
  updated_at TEXT
);
-- Testes A/B de capa (alternância agendada)
CREATE TABLE IF NOT EXISTS ab_tests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  thumb_a TEXT NOT NULL,
  thumb_b TEXT NOT NULL,
  hours INTEGER NOT NULL DEFAULT 24,
  current TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'running',
  last_switch TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ab_user ON ab_tests(user_id, created_at);
-- Concorrentes acompanhados por usuário
CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  title TEXT,
  thumb TEXT,
  subs BIGINT,
  last_data TEXT,
  last_checked TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_user_ch ON competitors(user_id, channel_id);
-- Avaliações do site (uma ativa por conta), com respostas, votos e denúncias
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  moderated_by TEXT,
  moderated_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_review_status ON reviews(status, created_at);
-- Comentários soltos sobre o site (sem nota, e quantos a pessoa quiser)
CREATE TABLE IF NOT EXISTS site_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  moderated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coment_status ON site_comments(status, created_at);
-- Respostas: servem para avaliação E para comentário. 'papel' guarda quem respondeu
-- na hora (owner = desenvolvedor, admin = equipe), para destacar na tela.
CREATE TABLE IF NOT EXISTS respostas (
  id TEXT PRIMARY KEY,
  alvo_tipo TEXT NOT NULL,
  alvo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  moderated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resp_alvo ON respostas(alvo_tipo, alvo_id, created_at);
CREATE TABLE IF NOT EXISTS review_votes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_unico ON review_votes(target_type, target_id, user_id);
CREATE TABLE IF NOT EXISTS review_reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_unico ON review_reports(target_type, target_id, user_id);
-- Avisos e cards que o administrador cria pelo painel (posição e ordem escolhidas por ele)
CREATE TABLE IF NOT EXISTS blocos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  pagina TEXT NOT NULL DEFAULT 'home',
  slot TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  titulo TEXT NOT NULL DEFAULT '',
  texto TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '',
  imagem_url TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  link_texto TEXT NOT NULL DEFAULT '',
  mostrar_url INTEGER NOT NULL DEFAULT 0,
  estilo TEXT NOT NULL DEFAULT 'info',
  publicado INTEGER NOT NULL DEFAULT 1,
  criado_por TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocos_pos ON blocos(pagina, slot, ordem);

CREATE TABLE IF NOT EXISTS notificacoes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  corpo TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  dados TEXT NOT NULL DEFAULT '{}',
  lida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notificacoes(user_id, lida, created_at);

CREATE TABLE IF NOT EXISTS pedidos_admin (
  id TEXT PRIMARY KEY,
  acao TEXT NOT NULL,
  pedido_por TEXT NOT NULL,
  alvo_user TEXT,
  alvo_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  motivo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente',
  decidido_por TEXT,
  resposta TEXT NOT NULL DEFAULT '',
  erro TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos_admin(status, created_at);

CREATE TABLE IF NOT EXISTS conversas (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '',
  criado_por TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversa_membros (
  conversa_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  fixado INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  lido_em TEXT NOT NULL DEFAULT '',
  entrou_em TEXT NOT NULL,
  PRIMARY KEY (conversa_id, user_id)
);

CREATE TABLE IF NOT EXISTS mensagens (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  sistema INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON mensagens(conversa_id, created_at);

CREATE TABLE IF NOT EXISTS acoes_dispensadas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chave TEXT NOT NULL,
  ate TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disp_user ON acoes_dispensadas(user_id, ate);

CREATE TABLE IF NOT EXISTS sinais (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL,
  de_user TEXT NOT NULL,
  para_user TEXT NOT NULL,
  tipo TEXT NOT NULL,
  dados TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sinais ON sinais(para_user, created_at);

CREATE TABLE IF NOT EXISTS experimentos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  hipotese TEXT NOT NULL,
  mudanca TEXT NOT NULL,
  metrica TEXT NOT NULL DEFAULT 'views',
  status TEXT NOT NULL DEFAULT 'rodando',
  revisar_em TEXT NOT NULL,
  resultado TEXT NOT NULL DEFAULT '',
  conclusao TEXT NOT NULL DEFAULT '',
  avisado INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_user ON experimentos(user_id, status, revisar_em);

-- Postagens: area publica (todo mundo) e area de administradores.
CREATE TABLE IF NOT EXISTS postagens (
  id TEXT PRIMARY KEY,
  autor_id TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'publica',
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  imagem TEXT,
  status TEXT NOT NULL DEFAULT 'ativa',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_area ON postagens(area, status, created_at);

CREATE TABLE IF NOT EXISTS post_reacoes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  valor INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comentarios (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  imagem TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_post ON post_comentarios(post_id, status, created_at);

-- Enquetes entre administradores. Podem nascer a partir de um pedido da fila.
CREATE TABLE IF NOT EXISTS enquetes (
  id TEXT PRIMARY KEY,
  criada_por TEXT NOT NULL,
  pergunta TEXT NOT NULL,
  opcoes TEXT NOT NULL,
  pedido_id TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  fecha_em TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enquete_votos (
  enquete_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opcao INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (enquete_id, user_id)
);

-- Bate-papo publico: UM canal so, para todo mundo que entrou no site.
CREATE TABLE IF NOT EXISTS chat_publico (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  filtrada INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cp_tempo ON chat_publico(created_at);
CREATE INDEX IF NOT EXISTS idx_cp_user ON chat_publico(user_id, created_at);

-- O que foi BARRADO nao e guardado: so o motivo, para dar para ver padrao de
-- abuso sem criar um deposito do que eu nao quero que exista.
-- Canal de teste (simulado). Os 1000 vídeos NÃO ficam aqui: são gerados por
-- conta, sempre iguais. O banco guarda só quem está no modo teste e o que as
-- pessoas editaram.
CREATE TABLE IF NOT EXISTS demo_estado (
  user_id TEXT PRIMARY KEY,
  ligado INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_edicoes (
  escopo TEXT NOT NULL,
  video_id TEXT NOT NULL,
  titulo TEXT,
  descricao TEXT,
  tags TEXT,
  privacidade TEXT,
  capa TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (escopo, video_id)
);

CREATE TABLE IF NOT EXISTS demo_playlists (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_playlist_itens (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_respostas (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL,
  comentario_id TEXT NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_videos_novos (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  privacidade TEXT NOT NULL DEFAULT 'private',
  categoria TEXT NOT NULL DEFAULT '20',
  publica_em TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  enviado INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_novos ON demo_videos_novos(escopo, created_at);

CREATE INDEX IF NOT EXISTS idx_demo_ed ON demo_edicoes(escopo);
CREATE INDEX IF NOT EXISTS idx_demo_pl ON demo_playlist_itens(escopo, playlist_id);

CREATE TABLE IF NOT EXISTS chat_bloqueios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  motivos TEXT NOT NULL DEFAULT '',
  onde TEXT NOT NULL DEFAULT 'bate-papo',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_user ON chat_bloqueios(user_id, created_at);

CREATE TABLE IF NOT EXISTS chat_denuncias (
  id TEXT PRIMARY KEY,
  mensagem_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cd_unica ON chat_denuncias(mensagem_id, user_id);

-- Inscricoes de aviso com o site fechado (Web Push). Uma por aparelho.
CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  agente TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subs(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);

CREATE TABLE IF NOT EXISTS cache_resposta (
  chave TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  ate TEXT NOT NULL
);

-- ===== Resultados dos criadores =====
-- Medição de inscritos do canal. Uma por canal por dia (o índice único é o que
-- impede medição repetida virar crescimento falso).
CREATE TABLE IF NOT EXISTS medicoes_canal (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  inscritos BIGINT,
  oculto INTEGER NOT NULL DEFAULT 0,
  precisao TEXT NOT NULL DEFAULT 'exata',
  origem TEXT NOT NULL DEFAULT 'canal',
  dia TEXT NOT NULL,
  medido_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_med_canal_dia ON medicoes_canal(canal_id, dia);
CREATE INDEX IF NOT EXISTS idx_med_user ON medicoes_canal(user_id, medido_em);

-- Acompanhamento do canal: um por usuário e canal.
CREATE TABLE IF NOT EXISTS acompanhamentos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  inicio TEXT,
  inscritos_inicial BIGINT,
  meta_alvo BIGINT,
  limiar BIGINT,
  grupo INTEGER,
  elegivel_em TEXT,
  elegivel_prova TEXT,
  fim TEXT,
  estado TEXT NOT NULL DEFAULT 'sem_dados',
  regras_versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acomp_user_canal ON acompanhamentos(user_id, canal_id);
CREATE INDEX IF NOT EXISTS idx_acomp_estado ON acompanhamentos(estado);

-- Conquista de meta. Uma vez gravada nunca é reclassificada nem apagada:
-- perder inscritos depois não desfaz o que aconteceu.
CREATE TABLE IF NOT EXISTS conquistas (
  id TEXT PRIMARY KEY,
  acompanhamento_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  meta BIGINT NOT NULL,
  registro INTEGER NOT NULL,
  inscritos_inicio BIGINT NOT NULL,
  inscritos_conquista BIGINT NOT NULL,
  atingida_em TEXT NOT NULL,
  precisao TEXT NOT NULL DEFAULT 'exata',
  regras_versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conq_canal_meta ON conquistas(canal_id, meta);
CREATE INDEX IF NOT EXISTS idx_conq_registro ON conquistas(registro);

-- Versões das regras de classificação. Nunca sobrescritas: cada acompanhamento
-- guarda em qual versão nasceu.
CREATE TABLE IF NOT EXISTS regras_estat (
  versao INTEGER PRIMARY KEY,
  regras TEXT NOT NULL,
  autor_id TEXT,
  autor_email TEXT,
  criado_em TEXT NOT NULL
);
`;

// id, nome, preco do MES em centavos, preco do ANO em centavos, creditos/mes, ordem, ativo, descricao
const PLAN_SEED = [
  ['free', 'Free', 0, 0, 5000, 0, 1, 'Plano gratuito com recarga mensal automática de créditos. Meta interna: uso muito superior ao de planos gratuitos de ferramentas similares.'],
  ['p10', 'Starter', 999, 9900, 60000, 1, 1, 'Para quem publica toda semana. Créditos mensais com folga para pesquisa e análises.'],
  ['p20', 'Creator', 1999, 19900, 140000, 2, 1, 'Para canais em crescimento, com análises de concorrentes frequentes.'],
  ['p40', 'Pro', 3999, 39900, 320000, 3, 1, 'Para criadores profissionais e equipes pequenas.'],
  ['p70', 'Studio', 6999, 69900, 600000, 4, 1, 'Para estúdios e múltiplos canais.'],
  ['p100', 'Max', 9999, 99900, 1000000, 5, 1, 'Maior capacidade de utilização entre os planos disponíveis.']
];
/* Precos do modelo ANTIGO, que vendia 2 meses pelo preco do plano. A migracao
 * abaixo so troca o preco de um plano que AINDA esta no valor antigo: se o dono
 * ajustou o preco na mao, o ajuste dele fica. */
const PRECOS_ANTIGOS = { p10: 1000, p20: 2000, p40: 4000, p70: 7000, p100: 10000 };

const TOOL_SEED = [
  ['video_search', 4, 'Busca de vídeos'],
  ['keyword_research', 5, 'Pesquisa de palavras-chave'],
  ['video_analysis', 8, 'Análise de vídeo (SEO)'],
  ['channel_analysis', 8, 'Análise de canal'],
  ['trends', 3, 'Tendências e ideias'],
  ['title_ai', 20, 'Sugestões de títulos (IA)'],
  ['description_ai', 15, 'Otimização de descrição (IA)'],
  ['video_insights_ai', 300, 'IA do vídeo: assiste e sugere título, descrição e tags'],
  ['channel_sync', 5, 'Sincronizar meu canal'],
  ['thumbnail_upload', 10, 'Enviar capa para o YouTube'],
  ['video_update', 10, 'Editar título/descrição no YouTube'],
  ['ab_test', 30, 'Teste A/B de capas'],
  ['video_upload', 20, 'Postar vídeo no YouTube'],
  ['live_create', 20, 'Criar transmissão ao vivo'],
  ['comment_reply', 2, 'Responder comentário'],
  ['video_panel', 1, 'Painel da extensão no YouTube'],
  ['prep_ai', 15, 'Preparar publicação (IA)'],
  ['transform_ai', 40, 'Transformar vídeo (IA): 3 cortes para Shorts, post, artigo'],
  ['reply_ai', 3, 'Sugerir resposta a comentário (IA)'],
  ['competitor_check', 8, 'Atualizar concorrente'],
  ['playlist_create', 10, 'Criar playlist no YouTube'],
  ['playlist_add', 5, 'Adicionar ou remover vídeo de playlist'],
  ['ideas_ai', 10, 'Ideias de vídeos para o seu canal (IA)'],
  ['coach_ai', 300, 'Análise da IA na extensão (resumo, gancho, desempenho, ideias)'],
  ['audit_ai', 200, 'Auditoria do canal (IA): nota, o que funciona e 5 melhorias'],
  ['title_lab', 100, 'Laboratório de título: nota, diagnóstico e 5 alternativas (IA)'],
  ['best_time', 10, 'Melhor horário para publicar (conta sobre os seus vídeos)']
];

const DEFAULT_SETTINGS = () => ({
  site_name: 'TurboCanal',
  owner_email: (process.env.OWNER_EMAIL || 'lcmatias777@gmail.com').toLowerCase(),
  free_monthly_topup: '5000',
  yt_api_key: '',
  gemini_api_key: '',
  mp_access_token: '',
  payments_enabled: '0',
  pix_key_value: '54984398807',
  pix_key_type: 'phone',
  pix_key_confirmed: '0',
  // Hotmart: o hottok e o token fixo do painel (Ferramentas > Webhook >
  // Autenticacao); o product_id e o ID do produto; as ofertas sao o mapa
  // {"CODIGO": {"plan": "p10", "periodo": "12m"}} que diz quanto cada oferta
  // vale. Vazio significa integracao desligada, e nada libera acesso.
  hotmart_hottok: '',
  hotmart_product_id: '',
  hotmart_ofertas: '{}'
});

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function wrap(exec) {
  // exec(sql, params) -> { rows, rowCount }
  return {
    async get(sql, params = []) {
      const r = await exec(toPg(sql), params);
      return r.rows[0];
    },
    async all(sql, params = []) {
      const r = await exec(toPg(sql), params);
      return r.rows;
    },
    async run(sql, params = []) {
      conferir(sql);   // guarda de escrita: ver src/guarda.js
      const r = await exec(toPg(sql), params);
      return { changes: r.rowCount ?? 0 };
    }
  };
}

async function makePg(url) {
  const { default: pg } = await import('pg');
  // SSL: obrigatório em hosts externos (render.com, neon.tech, supabase...); hosts
  // internos do Render (sem domínio) e localhost não usam. PGSSL=1/0 força.
  const needsSsl =
    process.env.PGSSL === '1' ? true
    : process.env.PGSSL === '0' ? false
    : /sslmode=require|\.render\.com|neon\.tech|supabase\.(co|com)|amazonaws\.com/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 5
  });
  const base = wrap((sql, params) => pool.query(sql, params));
  return {
    ...base,
    kind: 'postgres',
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = wrap((sql, params) => client.query(sql, params));
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    }
  };
}

async function makePglite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = dataDir ? new PGlite(dataDir) : new PGlite();
  await pgl.waitReady;
  const base = wrap((sql, params) => pgl.query(sql, params));
  let chain = Promise.resolve(); // serializa transações (PGlite é single-connection)
  return {
    ...base,
    kind: 'pglite',
    tx(fn) {
      const run = () =>
        pgl.transaction(async (t) => {
          const q = wrap((sql, params) => t.query(sql, params));
          return fn(q);
        });
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
    async exec(sql) {
      await pgl.exec(sql);
    },
    async close() {
      await pgl.close();
    }
  };
}

export async function getSetting(db, key) {
  const r = await db.get('SELECT value FROM settings WHERE key=?', [key]);
  return r?.value;
}
export async function setSetting(db, key, value) {
  await db.run(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
    [key, String(value)]
  );
}

async function seed(db) {
  for (const p of PLAN_SEED) {
    await db.run(
      'INSERT INTO plans(id,name,price_cents,price_year_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      p
    );
  }
  /* Modelo novo de preco (1 mes em vez de 2, e preco do ano proprio), pedido
   * pelo dono. ON CONFLICT DO NOTHING acima nao mexe em plano que ja existe,
   * entao a troca tem de ser explicita aqui, e so quando o valor ainda e o
   * antigo. */
  for (const linha of PLAN_SEED) {
    const [id, , mes, ano] = linha;
    if (!PRECOS_ANTIGOS[id]) continue;
    await db.run('UPDATE plans SET price_cents=? WHERE id=? AND price_cents=?', [mes, id, PRECOS_ANTIGOS[id]]);
    await db.run('UPDATE plans SET price_year_cents=? WHERE id=? AND price_year_cents=0', [ano, id]);
  }
  for (const t of TOOL_SEED) {
    await db.run('INSERT INTO tool_costs(tool,cost,label) VALUES(?,?,?) ON CONFLICT(tool) DO NOTHING', t);
  }
  // Atualizações de preço/nome pedidas pelo dono (só se o valor ainda for o padrão antigo; não pisa em ajuste manual)
  const MIGRATE = [
    ['video_insights_ai', 40, 300, 'IA assiste o vídeo (insights)', 'IA do vídeo: assiste e sugere título, descrição e tags']
  ];
  await db.run("DELETE FROM tool_costs WHERE tool='thumbnail_ai'"); // capa com IA foi retirada do site
  // Banimento de conta (pedido do dono): coluna nova nas contas já existentes
  try { await db.run('ALTER TABLE users ADD COLUMN banido INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN banido_motivo TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.run('ALTER TABLE users ADD COLUMN sessao_v INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.run('ALTER TABLE users ADD COLUMN foto_url TEXT'); } catch {}
  // De onde veio o bloqueio do filtro: o bate-papo ou um comentário de postagem.
  // Sem isso o dono via só metade do que o filtro barrou.
  try { await db.run("ALTER TABLE chat_bloqueios ADD COLUMN onde TEXT NOT NULL DEFAULT 'bate-papo'"); } catch {}
  // Capa enviada para um vídeo do canal de teste
  try { await db.run('ALTER TABLE demo_edicoes ADD COLUMN capa TEXT'); } catch {}
  // Plano pago por período: até quando vale, e o que cada pagamento comprou
  try { await db.run('ALTER TABLE users ADD COLUMN plano_ate TEXT'); } catch {}
  try { await db.run("ALTER TABLE payments ADD COLUMN periodo TEXT NOT NULL DEFAULT '2m'"); } catch {}
  try { await db.run('ALTER TABLE plans ADD COLUMN price_year_cents INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Quem JÁ tinha plano pago antes desta mudança não pode perder o plano porque
  // o prazo nasceu vazio. Ganha 2 meses a partir de agora, uma vez só.
  try {
    const d = new Date(); d.setMonth(d.getMonth() + 2);
    await db.run("UPDATE users SET plano_ate=? WHERE plano_ate IS NULL AND plan_id <> 'free'", [d.toISOString()]);
  } catch {}
  // review_replies virou 'respostas' (que serve também para comentários); só sai se estiver vazia
  try {
    const r = await db.get('SELECT COUNT(*) AS n FROM review_replies');
    if (Number(r?.n || 0) === 0) await db.run('DROP TABLE review_replies');
  } catch {}
  await db.run("UPDATE tool_costs SET label='Transformar vídeo (IA): 3 cortes para Shorts, post, artigo' WHERE tool='transform_ai' AND label='Transformar vídeo (IA)'");
  for (const [tool, oldCost, newCost, oldLabel, newLabel] of MIGRATE) {
    await db.run('UPDATE tool_costs SET cost=? WHERE tool=? AND cost=?', [newCost, tool, oldCost]);
    await db.run('UPDATE tool_costs SET label=? WHERE tool=? AND label=?', [newLabel, tool, oldLabel]);
  }
  // Versão 1 das regras dos resultados dos criadores. Fica no banco (e não só
  // no código) para que cada conquista possa apontar a versão que valia.
  try {
    const temRegras = await db.get('SELECT versao FROM regras_estat ORDER BY versao LIMIT 1');
    if (!temRegras) {
      const { REGRAS_PADRAO } = await import('./estatisticas.js');
      await db.run('INSERT INTO regras_estat(versao,regras,autor_id,autor_email,criado_em) VALUES(?,?,?,?,?)',
        [1, JSON.stringify(REGRAS_PADRAO), null, 'sistema', new Date().toISOString()]);
    }
  } catch (e) { console.error('[seed] regras de estatísticas:', e.message); }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS())) {
    if ((await getSetting(db, k)) === undefined) await setSetting(db, k, v);
  }
  if (!(await getSetting(db, 'jwt_secret'))) await setSetting(db, 'jwt_secret', crypto.randomBytes(32).toString('hex'));
  if (!(await getSetting(db, 'admin_setup_token'))) {
    await setSetting(db, 'admin_setup_token', crypto.randomBytes(16).toString('hex'));
  }
}

export async function openDb({ url = process.env.DATABASE_URL, dataDir } = {}) {
  let db;
  if (url) {
    db = await makePg(url);
  } else {
    const mem = !dataDir || dataDir === ':memory:';
    if (!mem) fs.mkdirSync(path.resolve(dataDir), { recursive: true });
    db = await makePglite(mem ? undefined : dataDir);
  }
  await db.exec(SCHEMA);
  // A carga inicial escreve em plans/tool_costs/settings, que a guarda protege.
  // Ela é trabalho do próprio site, não ação de administrador: diz isso por escrito.
  const { tarefaDoSite } = await import('./guarda.js');
  await tarefaDoSite('carga inicial do banco', ['plans', 'tool_costs', 'blocos', 'settings'], () => seed(db));
  return db;
}

export async function printSetupHints(db) {
  const ownerExists = await db.get("SELECT 1 AS x FROM users WHERE role='owner' LIMIT 1");
  console.log(`[banco] ${db.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'PGlite local (sem DATABASE_URL: dados nao persistem em hospedagem com disco efemero)'}`);
  if (!ownerExists) {
    const email = await getSetting(db, 'owner_email');
    const token = await getSetting(db, 'admin_setup_token');
    console.log('='.repeat(72));
    console.log('PRIMEIRA CONFIGURACAO DO ADMINISTRADOR PRINCIPAL');
    console.log(`1) Cadastre-se no site com o e-mail: ${email}`);
    console.log('2) Em Configuracoes > "Sou o administrador", informe o token de setup:');
    console.log(`   TOKEN DE SETUP: ${token}`);
    console.log('   (uso unico; ou entre com o Google usando esse e-mail, que dispensa o token)');
    console.log('='.repeat(72));
  }
}
