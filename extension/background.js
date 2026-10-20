// Service worker da extensão TurboCanal (MV3).
const DEFAULT_URL = 'https://turbocanal.onrender.com';

chrome.runtime.onInstalled.addListener(async () => {
  const { baseUrl } = await chrome.storage.sync.get('baseUrl');
  if (!baseUrl) await chrome.storage.sync.set({ baseUrl: DEFAULT_URL });
});

// Token da sessão: usa o token salvo ou o cookie de login do site (login com Google).
async function getToken() {
  const { baseUrl, token } = await chrome.storage.sync.get(['baseUrl', 'token']);
  if (token) return token;
  try {
    const c = await chrome.cookies.get({ url: (baseUrl || DEFAULT_URL).replace(/\/$/, '') + '/', name: 'tc_token' });
    return c?.value || '';
  } catch {
    return '';
  }
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
