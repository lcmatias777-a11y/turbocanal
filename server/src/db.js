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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_provider ON payments(provider_id);
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
`;

const PLAN_SEED = [
  ['free', 'Free', 0, 5000, 0, 1, 'Plano gratuito com recarga mensal automática de créditos. Meta interna: uso muito superior ao de planos gratuitos de ferramentas similares.'],
  ['p10', 'Starter', 1000, 60000, 1, 1, 'Para quem publica toda semana. Créditos mensais com folga para pesquisa e análises.'],
  ['p20', 'Creator', 2000, 140000, 2, 1, 'Para canais em crescimento, com análises de concorrentes frequentes.'],
  ['p40', 'Pro', 4000, 320000, 3, 1, 'Para criadores profissionais e equipes pequenas.'],
  ['p70', 'Studio', 7000, 600000, 4, 1, 'Para estúdios e múltiplos canais.'],
  ['p100', 'Max', 10000, 1000000, 5, 1, 'Maior capacidade de utilização entre os planos disponíveis.']
];

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
  pix_key_confirmed: '0'
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
      'INSERT INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      p
    );
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
  await seed(db);
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
