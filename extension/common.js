// Funções compartilhadas (popup e options). A extensão fala com o MESMO backend
// do site: mesma conta, mesmo saldo, mesmas regras validadas no servidor.
// IMPORTANTE: estas páginas NÃO dependem do service worker. O token é lido direto
// pelas APIs do Chrome, porque se o service worker estiver dormindo ou com erro os
// botões ficavam "mortos" (sem nenhum aviso na tela).
const DEFAULT_URL = 'https://turbocanal.onrender.com';
export const TIMEOUT_MS = 25000;

export async function baseUrl() {
  try {
    const { baseUrl } = await chrome.storage.sync.get(['baseUrl']);
    return (baseUrl || DEFAULT_URL).replace(/\/$/, '');
  } catch { return DEFAULT_URL; }
}

/** Token: 1) cookie da sessão do site; 2) token salvo nas opções. Nunca lança erro. */
export async function getToken() {
  const base = await baseUrl();
  try {
    const c = await chrome.cookies.get({ url: base + '/', name: 'tc_token' });
    if (c?.value) return c.value;
  } catch {}
  try {
    const { token } = await chrome.storage.sync.get(['token']);
    return token || '';
  } catch { return ''; }
}

export async function getCfg() {
  return { baseUrl: await baseUrl(), token: await getToken() };
}
export async function setCfg(obj) {
  try { await chrome.storage.sync.set(obj); } catch {}
}

export async function api(path, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  const { baseUrl: base, token } = await getCfg();
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
      ? 'O site demorou demais para responder. No plano gratuito ele "dorme" e leva até 1 minuto para acordar: tente de novo.'
      : 'Não consegui falar com o site (' + base + '). Veja se está no ar e confira o endereço nas opções.');
    err.status = 0;
    throw err;
  } finally { clearTimeout(t); }
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(data.error || 'Erro na requisição (' + r.status + ')');
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Abre uma aba. Funciona mesmo se o service worker estiver parado. */
export async function openTab(url) {
  try { await chrome.tabs.create({ url }); return true; }
  catch {
    try { window.open(url, '_blank'); return true; } catch { return false; }
  }
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
