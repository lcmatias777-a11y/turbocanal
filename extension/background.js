// Service worker da extensão TurboCanal (MV3).
const DEFAULT_URL = 'https://turbocanal.onrender.com';

chrome.runtime.onInstalled.addListener(async () => {
  const { baseUrl } = await chrome.storage.sync.get('baseUrl');
  if (!baseUrl) await chrome.storage.sync.set({ baseUrl: DEFAULT_URL });
});

// Token da sessão: a sessão atual do site (cookie do login com Google) vale primeiro,
// assim a extensão sempre mostra a mesma conta que está aberta no site.
async function getToken() {
  const { baseUrl, token } = await chrome.storage.sync.get(['baseUrl', 'token']);
  try {
    const c = await chrome.cookies.get({ url: (baseUrl || DEFAULT_URL).replace(/\/$/, '') + '/', name: 'tc_token' });
    if (c?.value) return c.value;
  } catch {}
  return token || '';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'getToken') {
    getToken().then((token) => sendResponse({ token }));
    return true; // resposta assíncrona
  }
  if (msg?.type === 'openLogin') {
    chrome.storage.sync.get('baseUrl').then(({ baseUrl }) => chrome.tabs.create({ url: (baseUrl || DEFAULT_URL) + '/api/auth/google' }));
    sendResponse({ ok: true });
    return false;
  }
});
