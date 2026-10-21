// Service worker da extensão TurboCanal (MV3).
// Serve só ao content script (que não pode ler o cookie da sessão sozinho).
// O popup e as opções NÃO dependem deste arquivo: eles leem o cookie direto.
const DEFAULT_URL = 'https://turbocanal.onrender.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('baseUrl').then(({ baseUrl }) => {
    if (!baseUrl) chrome.storage.sync.set({ baseUrl: DEFAULT_URL });
  }).catch(() => {});
});

async function getToken() {
  let baseUrl = DEFAULT_URL, saved = '';
  try {
    const c = await chrome.storage.sync.get(['baseUrl', 'token']);
    baseUrl = c.baseUrl || DEFAULT_URL;
    saved = c.token || '';
  } catch {}
  try {
    const c = await chrome.cookies.get({ url: baseUrl.replace(/\/$/, '') + '/', name: 'tc_token' });
    if (c?.value) return c.value;
  } catch {}
  return saved;
}

// Responde SEMPRE (mesmo em erro): assim nenhum botão do site fica esperando para sempre.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg?.type;
  if (type === 'getToken') {
    getToken().then((token) => sendResponse({ token })).catch(() => sendResponse({ token: '', erro: true }));
    return true;
  }
  if (type === 'openLogin' || type === 'openTab') {
    (async () => {
      try {
        const { baseUrl } = await chrome.storage.sync.get('baseUrl');
        const base = (baseUrl || DEFAULT_URL).replace(/\/$/, '');
        await chrome.tabs.create({ url: type === 'openLogin' ? base + '/api/auth/google' : msg.url || base });
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, erro: String(e?.message || e) }); }
    })();
    return true;
  }
  if (type === 'ping') { sendResponse({ ok: true }); return false; }
  sendResponse({ ok: false, erro: 'mensagem desconhecida' });
  return false;
});
