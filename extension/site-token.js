// Roda DENTRO do site do TurboCanal (não no YouTube).
// Pega a sessão que o site já tem e guarda para o painel do YouTube usar.
// É isto que faz a extensão reconhecer a sua conta sem depender do service worker.
(() => {
  const anotar = (o) => { try { document.documentElement.dataset.tcSite = JSON.stringify(o); } catch {} };
  const salvar = async () => {
    let passo = 'comecou';
    try {
      const r = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      passo = 'pedido respondeu ' + r.status;
      if (r.status === 401) { await chrome.storage.local.remove(['tc_token']); anotar({ passo, guardou: false, motivo: 'sem login no site' }); return; }
      if (!r.ok) { anotar({ passo, guardou: false }); return; }
      const d = await r.json();
      if (!d || !d.token) { anotar({ passo, guardou: false, motivo: 'resposta sem token' }); return; }
      await chrome.storage.local.set({ tc_token: d.token, tc_token_em: Date.now() });
      const conferido = (await chrome.storage.local.get(['tc_token'])).tc_token;
      anotar({ passo, guardou: conferido === d.token, tamanho: (conferido || '').length });
    } catch (e) { anotar({ passo, guardou: false, erro: String(e?.message || e) }); }
  };
  salvar();
  // o login com o Google volta para cá trocando só o endereço, sem recarregar a página
  window.addEventListener('hashchange', () => setTimeout(salvar, 500));
  window.addEventListener('focus', salvar);
})();
