import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',            -- user | admin | owner
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
  status TEXT NOT NULL,                          -- pending | approved | cancelled | expired | refunded | error
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
`;

const PLAN_SEED = [
  // Os "multiplicadores" dos planos são METAS COMPARATIVAS internas, não promessas auditadas.
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
  ['description_ai', 15, 'Otimização de descrição (IA)']
];

const DEFAULT_SETTINGS = () => ({
  site_name: 'TurboCanal',
  owner_email: (process.env.OWNER_EMAIL || 'lcmatias777@gmail.com').toLowerCase(),
  free_monthly_topup: '5000',
  yt_api_key: '',
  mp_access_token: '',
  payments_enabled: '0',
  // Chave Pix informada pelo dono. NÃO está confirmada: o tipo precisa ser
  // validado pelo administrador antes de ativar pagamentos reais.
  pix_key_value: '54984398807',
  pix_key_type: 'phone',
  pix_key_confirmed: '0'
});

export function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
}
export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(value));
}

function seed(db) {
  const insPlan = db.prepare(
    'INSERT OR IGNORE INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?)'
  );
  for (const p of PLAN_SEED) insPlan.run(...p);

  const insTool = db.prepare('INSERT OR IGNORE INTO tool_costs(tool,cost,label) VALUES(?,?,?)');
  for (const t of TOOL_SEED) insTool.run(...t);

  const defaults = DEFAULT_SETTINGS();
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(db, k) === undefined) setSetting(db, k, v);
  }
  if (!getSetting(db, 'jwt_secret')) setSetting(db, 'jwt_secret', crypto.randomBytes(32).toString('hex'));
  if (!getSetting(db, 'admin_setup_token')) {
    setSetting(db, 'admin_setup_token', crypto.randomBytes(16).toString('hex'));
  }
}

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

export function printSetupHints(db) {
  const ownerExists = db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get();
  if (!ownerExists) {
    const email = getSetting(db, 'owner_email');
    const token = getSetting(db, 'admin_setup_token');
    console.log('='.repeat(72));
    console.log('PRIMEIRA CONFIGURACAO DO ADMINISTRADOR PRINCIPAL');
    console.log(`1) Cadastre-se no site com o e-mail: ${email}`);
    console.log('2) Em Configuracoes > "Sou o administrador", informe o token de setup:');
    console.log(`   TOKEN DE SETUP: ${token}`);
    console.log('   (o token e de uso unico e e trocado apos a reivindicacao)');
    console.log('So quem tem acesso a este console consegue virar administrador principal.');
    console.log('='.repeat(72));
  }
}
