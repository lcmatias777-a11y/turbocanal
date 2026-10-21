import { baseUrl, getToken, setCfg, esc } from './common.js';

const VERSION = chrome.runtime.getManifest().version;
const bu = document.getElementById('bu');
const msg = document.getElementById('msg');
document.getElementById('ver').textContent = 'v' + VERSION;
baseUrl().then((b) => (bu.value = b));

document.getElementById('save').onclick = async () => {
  let v = bu.value.trim().replace(/\/$/, '');
  if (!v) { msg.innerHTML = '<span class="err">Escreva o endereço do site.</span>'; return; }
  if (!/^https?:\/\//.test(v)) v = 'https://' + v;
  await setCfg({ baseUrl: v });
  bu.value = v;
  msg.innerHTML = '<span class="ok">Salvo ✓</span>';
};

document.getElementById('test').onclick = async () => {
  msg.textContent = 'Testando…';
  const base = await baseUrl();
  const linhas = [];
  try {
    const t0 = Date.now();
    const d = await (await fetch(base + '/api/health', { cache: 'no-store' })).json();
    linhas.push(`✅ Site no ar (${Date.now() - t0} ms, banco ${esc(d.db || '?')})`);
  } catch { linhas.push('❌ Não consegui falar com o site. No plano gratuito ele dorme: espere 1 minuto e tente de novo.'); }
  linhas.push((await getToken()) ? '✅ Sessão encontrada' : '⚠️ Sem sessão: entre com o Google no site');
  try {
    const r = await (await fetch(base + '/api/extension/version', { cache: 'no-store' })).json();
    linhas.push(r.version === VERSION ? `✅ Extensão atualizada (v${esc(VERSION)})` : `🆕 O site tem a v${esc(r.version)} e você está na v${esc(VERSION)}`);
  } catch {}
  msg.innerHTML = linhas.map((l) => `<div>${l}</div>`).join('');
};
