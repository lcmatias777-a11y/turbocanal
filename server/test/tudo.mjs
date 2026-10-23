// Roda TODOS os arquivos de teste, um por vez, e reprova se qualquer um falhar.
// Existe porque teste que ninguem roda nao protege nada: antes disto cada
// arquivo era chamado na mao e era facil esquecer um.
import { readdirSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const aqui = new URL('.', import.meta.url).pathname;
// Lista por EXCLUSAO, nao por padrao de nome. Com o padrao "-test." ficavam de
// fora, caladas, as duas maiores suites do projeto: run-tests.js (quase 400
// verificacoes) e teste-ferramentas.mjs (111). Agora entra todo arquivo da
// pasta menos o proprio corredor e os ajudantes.
const NAO_SAO_TESTE = new Set(['tudo.mjs', 'fake-gemini.js', 'fake-youtube.js']);
const arquivos = readdirSync(aqui)
  .filter((f) => /\.(mjs|cjs|js)$/.test(f) && !NAO_SAO_TESTE.has(f))
  .sort();

const so = process.argv[2];           // node tudo.mjs xss   -> roda so os que casam
const lista = so ? arquivos.filter((f) => f.includes(so)) : arquivos;

/* Cada teste de navegador (.cjs) ganha um site NOVO, com banco limpo em memoria
 * e YouTube simulado. Tentei servir todos com um site so e varios quebraram:
 * eles criam contas com os mesmos e-mails e esbarram no limite de cadastros.
 * Site por teste e mais lento, mas e o que esses testes esperam. */
const precisaDeSite = (f) => f.endsWith('.cjs');
async function subirSite() {
  const porta = 8900 + Math.floor(Math.random() * 900);
  const servidor = spawn(process.execPath, ['../src/index.js'], {
    cwd: aqui,
    env: { ...process.env, PORT: String(porta), YT_MOCK: '1', DATABASE_URL: '', DATA_DIR: ':memory:', OWNER_EMAIL: 'admin@example.com', GEMINI_API_BASE: gemini.base },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let erro = '', saida = '', morreu = false;
  servidor.stderr.on('data', (d) => (erro += d));
  servidor.stdout.on('data', (d) => (saida += d));
  servidor.on('exit', () => (morreu = true));
  const site = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 120; i++) {
    // Se o processo morreu (porta ocupada, por exemplo), nao adianta insistir:
    // sem isto o corredor conversava com um servidor VELHO que ficou na porta.
    if (morreu) { const e = new Error('o servidor morreu ao subir: ' + (erro || saida).slice(-300)); e.__porta = true; throw e; }
    try { await fetch(site + '/api/settings/public'); await donoPronto(site, () => saida); return { site, servidor }; }
    catch (e) { if (e.__meu) { servidor.kill(); throw e; } await new Promise((r) => setTimeout(r, 200)); }
  }
  servidor.kill();
  throw new Error('o site nao subiu em 24s: ' + erro.slice(-400));
}

/* Os testes de navegador esperam que admin@example.com seja o administrador
 * principal, mas o site so promove pelo Google ou pelo token de setup impresso
 * no console: cadastro por senha nunca promove ninguem, e com razao. Entao o
 * corredor faz aqui, uma vez, o mesmo caminho que uma pessoa faria na mao:
 * cria a conta, pega o token do console e reivindica. Os testes depois acham a
 * conta pronta (eles ja tratam 409 fazendo login). Sem isto eles abriam o
 * painel como usuario comum e ficavam esperando um botao que nunca aparecia. */
async function donoPronto(site, lerSaida) {
  const EMAIL = 'admin@example.com', SENHA = 'senha12345';
  // O token sai no console antes do servidor atender, mas o texto chega aqui
  // por evento: esperar ele aparecer evita falha por corrida.
  let m = null;
  for (let i = 0; i < 50 && !m; i++) {
    m = /TOKEN DE SETUP:\s*([0-9a-f]{8,})/i.exec(lerSaida());
    if (!m) await new Promise((r) => setTimeout(r, 100));
  }
  if (!m) { const e = new Error('o servidor nao imprimiu o token de setup em 5s'); e.__meu = true; throw e; }
  const post = async (caminho, body, cookie) => {
    const r = await fetch(site + caminho, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body)
    });
    return { r, cookie: r.headers.get('set-cookie') || cookie, data: await r.json().catch(() => ({})) };
  };
  let a = await post('/api/auth/register', { email: EMAIL, password: SENHA, name: 'Admin do Site' });
  if (a.r.status === 409) a = await post('/api/auth/login', { email: EMAIL, password: SENHA });
  if (!a.r.ok) { const e = new Error('nao consegui criar a conta do dono: ' + a.r.status + ' ' + JSON.stringify(a.data)); e.__meu = true; throw e; }
  const c = await post('/api/auth/claim-owner', { token: m[1] }, (a.cookie || '').split(';')[0]);
  if (c.data?.user?.role !== 'owner') { const e = new Error('a conta do dono nao foi promovida: ' + JSON.stringify(c.data)); e.__meu = true; throw e; }
  // Liga a chave do Gemini simulado, pelo painel, como uma pessoa faria.
  await fetch(site + '/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: (c.cookie || a.cookie || '').split(';')[0] },
    body: JSON.stringify({ updates: { gemini_api_key: gemini.key } })
  }).catch(() => {});
}

/* Varios testes de navegador tiram foto da tela e recebem a pasta em
 * process.argv[3]. Quando eu rodava na mao sem passar nada, elas iam parar numa
 * pasta chamada "undefined" dentro do projeto. Agora a pasta e sempre esta. */
const TELAS = aqui + 'telas';
mkdirSync(TELAS, { recursive: true });

/* Gemini simulado, um so para todos os testes de navegador. Sem ele o servidor
 * sobe sem chave de IA e qualquer teste que peca analise da IA recebe 409 e
 * uma caixa de erro — foi o que escondeu o ext-test3.cjs por tanto tempo. */
const { startFakeGemini } = await import('./fake-gemini.js');
const gemini = await startFakeGemini();

const roda = (f, url) => new Promise((ok) => {
  const t0 = Date.now();
  // ext-test3.cjs recebe os argumentos ao contrario dos outros: primeiro a
  // pasta da extensao, depois o endereco do site. Ficou anos fora do corredor
  // e ninguem notou que a assinatura dela era diferente.
  const args = f === 'ext-test3.cjs'
    ? [aqui + '../../extension', url]
    : (url ? [url, TELAS] : []);
  const p = spawn(process.execPath, [aqui + f, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  p.stdout.on('data', (d) => (saida += d));
  p.stderr.on('data', (d) => (saida += d));
  p.on('close', (code) => ok({ f, code, saida, ms: Date.now() - t0 }));
});

console.log(`Rodando ${lista.length} arquivos de teste…\n`);
const maus = [];
for (const f of lista) {
  let sitio = null;
  if (precisaDeSite(f)) { try { sitio = await subirSite(); } catch (e1) { try { sitio = await subirSite(); } catch (e) { console.log(`  FALHA ${f.padEnd(26)}        ${e.message}`); maus.push({ f, saida: e.message }); continue; } } }
  let r = await roda(f, sitio?.site);
  if (sitio) sitio.servidor.kill();
  // Teste de navegador falha de vez em quando por tempo (porta, maquina cheia).
  // Uma segunda tentativa separa o que esta quebrado do que estava so lento, e
  // a repeticao aparece na linha para a instabilidade nao ficar escondida.
  if (r.code !== 0 && precisaDeSite(f)) {
    let s2 = null;
    try { s2 = await subirSite(); } catch {}
    if (s2) { const r2 = await roda(f, s2.site); s2.servidor.kill(); if (r2.code === 0) { r = r2; r.instavel = true; } }
  }
  const ultima = r.saida.trim().split('\n').filter(Boolean).pop() || '(sem saida)';
  const seg = (r.ms / 1000).toFixed(1) + 's';
  if (r.code === 0) console.log(`  ${r.instavel ? 'ok*  ' : 'ok   '} ${f.padEnd(26)} ${seg.padStart(6)}  ${ultima.slice(0, 90)}${r.instavel ? '  (passou na 2a tentativa: instavel)' : ''}`);
  else { console.log(`  FALHA ${f.padEnd(26)} ${seg.padStart(6)}  (codigo ${r.code})`); maus.push(r); }
}
for (const r of maus) {
  console.log(`\n================ ${r.f} ================\n` + r.saida.trim().split('\n').slice(-40).join('\n'));
}
console.log(maus.length ? `\nRESULTADO: ${maus.length} de ${lista.length} arquivos FALHARAM.` : `\nRESULTADO: os ${lista.length} arquivos passaram.`);
process.exit(maus.length ? 1 : 0);
