import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const ym = (d = new Date()) => d.toISOString().slice(0, 7); // ano-mês, ex.: 2026-10

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function must(value, name, { max = 300 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Campo obrigatório: ${name}`);
  }
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `Campo ${name} muito longo (máx. ${max}).`);
  return v;
}

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 190;
}

export async function audit(db, actor, action, target = '', detail = '') {
  try {
    await db.run(
      'INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [
        uid(),
        actor?.id || null,
        actor?.email || 'sistema',
        action,
        String(target || ''),
        typeof detail === 'string' ? detail : JSON.stringify(detail),
        now()
      ]
    );
  } catch (e) {
    console.error('[audit] falha ao registrar auditoria:', e.message);
  }
}

// Rate limit simples em memória (por IP + rota). Suficiente para 1 instância;
// em produção com várias instâncias, trocar por limite no proxy/por Redis.
export function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}|${req.path}`;
    const t = Date.now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    arr.push(t);
    hits.set(key, arr);
    if (hits.size > 50000) hits.clear(); // proteção de memória
    if (arr.length > max) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    next();
  };
}

// Gerador pseudoaleatório determinístico (usado SÓ no modo de teste/mock)
export function seededRand(seedStr) {
  let h = 2166136261;
  for (const c of String(seedStr)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
