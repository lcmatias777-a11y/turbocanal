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
  ['video_insights_ai', 40, 'IA assiste o vídeo (insights)'],
  ['thumbnail_ai', 60, 'Capa gerada por IA'],
  ['channel_sync', 5, 'Sincronizar meu canal'],
  ['thumbnail_upload', 10, 'Enviar capa para o YouTube'],
  ['video_update', 10, 'Editar título/descrição no YouTube'],
  ['ab_test', 30, 'Teste A/B de capas'],
  ['video_upload', 20, 'Postar vídeo no YouTube'],
  ['live_create', 20, 'Criar transmissão ao vivo'],
  ['comment_reply', 2, 'Responder comentário']
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
