// Roda DENTRO do site do TurboCanal (não no YouTube).
// Pega a sessão que o site já tem e guarda para o painel do YouTube usar.
// É isto que faz a extensão reconhecer a sua conta sem depender do service worker.
(() => {
  const salvar = async () => {
    try {
      const r = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { await chrome.storage.local.remove(['tc_token']); return; }
      if (!r.ok) return;
      const d = await r.json();
      if (!d || !d.token) return;
      const atual = (await chrome.storage.local.get(['tc_token'])).tc_token;
      if (atual !== d.token) await chrome.storage.local.set({ tc_token: d.token, tc_token_em: Date.now() });
    } catch {}
  };
  salvar();
  // o login com o Google volta para cá trocando só o endereço, sem recarregar a página
  window.addEventListener('hashchange', () => setTimeout(salvar, 500));
  window.addEventListener('focus', salvar);
})();
