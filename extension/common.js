// Funções compartilhadas (popup e options). A extensão fala com o MESMO backend
// do site: mesma conta, mesmo saldo, mesmas regras validadas no servidor.
export async function getCfg() {
  const { baseUrl, token } = await chrome.storage.sync.get(['baseUrl', 'token']);
  return { baseUrl: (baseUrl || 'https://turbocanal.onrender.com').replace(/\/$/, ''), token: token || '' };
}
export async function setCfg(obj) {
  await chrome.storage.sync.set(obj);
}
export async function api(path, { method = 'GET', body } = {}) {
  const { baseUrl, token } = await getCfg();
  const r = await fetch(baseUrl + '/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(data.error || 'Erro na requisição (' + r.status + ')');
    e.status = r.status;
    throw e;
  }
  return data;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
