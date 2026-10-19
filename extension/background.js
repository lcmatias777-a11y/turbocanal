// Service worker da extensão TurboCanal (MV3).
chrome.runtime.onInstalled.addListener(async () => {
  const { baseUrl } = await chrome.storage.sync.get('baseUrl');
  if (!baseUrl) {
    await chrome.storage.sync.set({ baseUrl: 'http://localhost:8787' });
  }
});
