// Usado pelo popup e pelas opções (páginas da extensão, com acesso direto às APIs do Chrome).
const DEFAULT_URL = 'https://turbocanal.onrender.com';

/** Só o endereço do site (https://host). Qualquer caminho, "#" ou "?" grudado é lixo e sai:
 *  um endereço com "#" faz TODA chamada da API cair na página inicial, sem erro aparente. */
export function limparUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return /^https?:$/.test(x.protocol) ? x.origin : DEFAULT_URL;
  } catch { return DEFAULT_URL; }
}
export async function baseUrl() {
  try {
    const guardado = (await chrome.storage.sync.get(['baseUrl'])).baseUrl;
    const limpo = limparUrl(guardado || DEFAULT_URL);
    // conserta sozinho o que estiver torto, para não voltar a acontecer
    if (guardado && guardado !== limpo) { try { await chrome.storage.sync.set({ baseUrl: limpo }); } catch {} }
    return limpo;
  } catch { return DEFAULT_URL; }
}
export async function getToken() {
  const base = await baseUrl();
  try {
    const c = await chrome.cookies.get({ url: base + '/', name: 'tc_token' });
    // guarda para o painel do YouTube, que não tem acesso aos cookies
    if (c?.value) { try { await chrome.storage.local.set({ tc_token: c.value, tc_token_em: Date.now() }); } catch {} return c.value; }
  } catch {}
  try {
    const l = await chrome.storage.local.get(['tc_token']);
    if (l?.tc_token) return l.tc_token;
  } catch {}
  try { return (await chrome.storage.sync.get(['token'])).token || ''; } catch { return ''; }
}
export async function setCfg(obj) { try { await chrome.storage.sync.set(obj); } catch {} }

export async function api(path, { method = 'GET', body, timeout = 25000 } = {}) {
  const base = await baseUrl();
  const token = await getToken();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(base + '/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError'
      ? 'O site demorou demais. No plano gratuito ele dorme e leva até 1 minuto para acordar: tente de novo.'
      : 'Não consegui falar com o site (' + base + ').');
    err.status = 0;
    throw err;
  } finally { clearTimeout(t); }
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || 'Erro ' + r.status); e.status = r.status; throw e; }
  return data;
}
export async function openTab(url) {
  try { await chrome.tabs.create({ url }); return true; }
  catch { try { window.open(url, '_blank'); return true; } catch { return false; } }
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
