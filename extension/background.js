// Service worker: descobre a sessão do site (cookie) para o content script.
// O popup e as opções NÃO dependem daqui: leem o cookie direto.
const DEFAULT_URL = 'https://turbocanal.onrender.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('baseUrl').then(({ baseUrl }) => {
    if (!baseUrl) chrome.storage.sync.set({ baseUrl: DEFAULT_URL });
  }).catch(() => {});
});

async function getToken() {
  let base = DEFAULT_URL, saved = '';
  try {
    const c = await chrome.storage.sync.get(['baseUrl', 'token']);
    base = (c.baseUrl || DEFAULT_URL).replace(/\/$/, '');
    saved = c.token || '';
  } catch {}
  try {
    const l = await chrome.storage.local.get(['tc_token']);
    if (l?.tc_token) return l.tc_token;
  } catch {}
  try {
    const c = await chrome.cookies.get({ url: base + '/', name: 'tc_token' });
    if (c?.value) { try { await chrome.storage.local.set({ tc_token: c.value }); } catch {} return c.value; }
  } catch {}
  return saved;
}

// Responde SEMPRE, mesmo em erro: nenhum botão fica esperando para sempre.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const t = msg?.type;
  if (t === 'getToken') {
    getToken().then((token) => sendResponse({ token })).catch(() => sendResponse({ token: '' }));
    return true;
  }
  if (t === 'openTab') {
    chrome.tabs.create({ url: msg.url }).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, erro: String(e?.message || e) }));
    return true;
  }
  sendResponse({ ok: false });
  return false;
});
