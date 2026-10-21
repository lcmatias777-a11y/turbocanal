// Teste da extensão v1.0.0 no Chromium.
// Páginas do YouTube simuladas (com a MESMA regra de Trusted Types do YouTube, que bloqueia
// innerHTML) + ytInitialPlayerResponse de verdade, porque é dali que a extensão lê os dados.
// A regra que está sendo testada: NUNCA aparece tela de login; sem conta o painel funciona.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');

const EXT = process.argv[2], LOCAL = process.argv[3];
const VER = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
const PUBLIC = 'https://turbocanal.onrender.com';
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU ', n); } else { fail++; console.log('  FALHOU ', n, x); } };
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const TT = { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types default" };

const VID = 'dQw4w9WgXcQ';
const DESC = 'Nesse vídeo eu mostro os 7 truques que mais funcionam no bedwars, do começo ao fim da partida, '
  + 'com exemplos de verdade em cada mapa e o que fazer quando a cama já caiu e você está em desvantagem total.\n'
  + '00:00 Começo\n01:30 Truque 1\nhttps://turbocanal.onrender.com';
const PLAYER = {
  videoDetails: {
    videoId: VID, title: 'Bedwars: 7 truques para vencer sempre', shortDescription: DESC,
    keywords: ['bedwars', 'minecraft', 'dicas de bedwars', 'como jogar bedwars', 'truques', 'minecraft pvp'],
    viewCount: '120000', lengthSeconds: '600', author: 'Canal do Teste', channelId: 'UCtesteteste0000000001', isLiveContent: false
  },
  microformat: { playerMicroformatRenderer: { publishDate: new Date(Date.now() - 48 * 3600e3).toISOString(), category: 'Jogos' } }
};
const item = (id, title, line, tag = 'yt-lockup-view-model') => `<ytd-rich-item-renderer><${tag}><a href="/watch?v=${id}"><img src="${IMG}" width="320" height="180"></a><div><h3>${title}</h3><div>Canal X</div><div>${line}</div></div></${tag}></ytd-rich-item-renderer>`;
const PAGES = {
  home: `<!doctype html><html><body><div id="contents">
    ${item('aaaaaaaaaa1', 'Vídeo estourado', '1,2 mi há 3 dias')}
    ${item('aaaaaaaaaa2', 'Vídeo normal', '20 mil há 2 sem')}
    ${item('aaaaaaaaaa3', 'Vídeo em inglês', '345K views • 2 weeks ago')}
    ${item('aaaaaaaaaa4', 'Outro', '15 mil visualizações • há 1 mês')}
    ${item('aaaaaaaaaa5', 'Mais um', '9,8 mil há 5 h')}
    ${item('aaaaaaaaaa6', 'Ao vivo', '273 assistindo')}
  </div></body></html>`,
  watch: `<!doctype html><html><body>
    <script>window.ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};</script>
    <div id="columns"><div id="primary">player</div></div>
    <script>
      // o YouTube só monta estes pedaços depois; a extensão tem que se virar com isso
      setTimeout(() => {
        const lb = document.createElement('like-button-view-model');
        const b = document.createElement('button');
        b.setAttribute('aria-label', 'marcar este vídeo como "Gostei" com mais 4.800 pessoas');
        b.append(document.createTextNode('4,8 mil'));
        lb.append(b);
        const ch = document.createElement('ytd-comments-header-renderer');
        const c = document.createElement('h2');
        c.id = 'count';
        c.append(document.createTextNode('1.234 Comentários'));
        ch.append(c);
        document.getElementById('primary').append(lb, ch);
      }, 2200);
      setTimeout(() => {
        // sem innerHTML: a regra de Trusted Types do YouTube proíbe, igual à página real
        const criar = (id, titulo, linha) => {
          const item = document.createElement('ytd-rich-item-renderer');
          const lock = document.createElement('yt-lockup-view-model');
          const a = document.createElement('a');
          a.href = '/watch?v=' + id;
          const img = document.createElement('img');
          img.src = ${JSON.stringify(IMG)}; img.width = 320; img.height = 180;
          a.append(img);
          const box = document.createElement('div');
          const h3 = document.createElement('h3'); h3.append(document.createTextNode(titulo));
          const can = document.createElement('div'); can.append(document.createTextNode('Canal X'));
          const meta = document.createElement('ytd-video-meta-block'); meta.append(document.createTextNode(linha));
          box.append(h3, can, meta);
          lock.append(a, box);
          item.append(lock);
          return item;
        };
        const sec = document.createElement('div'); sec.id = 'secondary';
        const inner = document.createElement('div'); inner.id = 'secondary-inner';
        inner.append(criar('bbbbbbbbbb1', 'Relacionado 1', '50 mil há 2 dias'), criar('bbbbbbbbbb2', 'Relacionado 2', '3 mil há 1 ano'));
        sec.append(inner);
        document.getElementById('columns').append(sec);
      }, 3200);
    </script>
  </body></html>`,
  shorts: `<!doctype html><html><body>
    <script>window.ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};</script>
    <div id="shorts-player">short</div>
    <ytd-reel-video-renderer is-active>
      <yt-shorts-video-title-view-model>Meu short de teste</yt-shorts-video-title-view-model>
      <div>12 mil visualizações</div>
      <div id="channel-name"><a href="/@canaldoshort">Canal do Short</a></div>
    </ytd-reel-video-renderer></body></html>`,
  search: `<!doctype html><html><body><ytd-search><ytd-section-list-renderer><div id="contents"><ytd-item-section-renderer>
    ${[['250 mil há 3 dias'], ['1,1 mi há 2 meses'], ['80 mil há 1 sem'], ['12 mil há 4 dias'], ['300 mil há 1 ano'], ['45 mil há 20 dias']]
      .map(([l], i) => `<ytd-video-renderer><a id="thumbnail" href="/watch?v=cccccccccc${i}"><img src="${IMG}"></a><div><h3>Bedwars ${i}</h3><ytd-channel-name>Canal ${i % 4}</ytd-channel-name><ytd-video-meta-block>${l}</ytd-video-meta-block></div></ytd-video-renderer>`).join('')}
  </ytd-item-section-renderer></div></ytd-section-list-renderer></ytd-search></body></html>`,
  channel: `<!doctype html><html><body><div id="contents">
    ${item('dddddddddd1', 'Do canal 1', '10 mil visualizações • há 3 dias')}${item('dddddddddd2', 'Do canal 2', '12 mil visualizações • há 1 semana')}
    ${item('dddddddddd3', 'Do canal 3', '90 mil visualizações • há 2 semanas')}${item('dddddddddd4', 'Do canal 4', '11 mil visualizações • há 3 semanas')}
  </div></body></html>`,
  studio: `<!doctype html><html><body><div id="main">Detalhes do vídeo</div></body></html>`
};

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ext3-'));
  const ctx = await chromium.launchPersistentContext(userDir, { channel: 'chromium', headless: true, viewport: { width: 1300, height: 950 }, args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const errors = [];
  let versionOverride = null;
  await ctx.route('https://www.youtube.com/**', (route) => {
    const u = new URL(route.request().url());
    const key = u.pathname === '/watch' ? 'watch' : u.pathname === '/results' ? 'search' : u.pathname.startsWith('/@') ? 'channel' : u.pathname.startsWith('/shorts/') ? 'shorts' : 'home';
    route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...TT }, body: PAGES[key] });
  });
  await ctx.route('https://studio.youtube.com/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...TT }, body: PAGES.studio }));
  let travarMe = false;
  await ctx.route(PUBLIC + '/**', async (route) => {
    const url = route.request().url();
    if (travarMe && /\/api\/me$/.test(url)) return new Promise(() => {}); // nunca responde

    if (versionOverride && url.includes('/api/extension/version')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ version: versionOverride, download: '/turbocanal-extensao.zip' }) });
    const resp = await route.fetch({ url: url.replace(PUBLIC, LOCAL) });
    await route.fulfill({ response: resp });
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  const api = ctx.request;
  await api.post(LOCAL + '/api/auth/register', { data: { email: 'ext3' + Date.now() + '@example.com', password: 'senha12345', name: 'Criador Teste' } });
  const tok = (await (await api.get(LOCAL + '/api/auth/token')).json()).token;
  const credits = async () => (await (await api.get(LOCAL + '/api/me', { headers: { Authorization: 'Bearer ' + tok } })).json()).user.credits;
  const login = () => ctx.addCookies([{ name: 'tc_token', value: tok, domain: 'turbocanal.onrender.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return p; };
  await ctx.clearCookies();

  /* ================= 1. SEM CONTA: o painel tem que funcionar inteiro ================= */
  console.log('\n— Sem conta (a regra: nada de tela de login) —');
  const c0 = await credits();
  const page = watch(await ctx.newPage());
  await page.goto('https://www.youtube.com/watch?v=' + VID);
  await page.waitForSelector('#tc-panel .tc-grid', { timeout: 20000 });
  const corpo = await page.textContent('#tc-panel');
  check('sem conta o painel abre preenchido (sem tela de login)', /Views/.test(corpo) && !/^\s*Entrar com Google\s*$/.test(corpo.trim()));
  check('a extensão carregada é a ' + VER, (await page.getAttribute('html', 'data-tc-on')) === VER, await page.getAttribute('html', 'data-tc-on'));
  const abas = await page.$$eval('#tc-panel .tc-tab', (b) => b.map((x) => x.textContent));
  check('painel com as abas Vídeo, SEO, Canal e IA', abas.join(',') === 'Vídeo,SEO,Canal,IA', abas.join(','));
  const inicio = await page.textContent('#tc-panel .tc-pane');
  check('não espera a página terminar de montar: já abre com views e VPH', /120\.000/.test(inicio) && /2,5 mil\/h/.test(inicio), inicio.replace(/\s+/g, ' ').slice(0, 160));
  await page.waitForFunction(() => /4\.800/.test(document.querySelector('#tc-panel .tc-pane')?.textContent || ''), null, { timeout: 25000 });
  const vt = await page.textContent('#tc-panel .tc-pane');
  check('quando o YouTube monta os likes e comentários, o painel se atualiza sozinho',
    /4\.800/.test(vt) && /1\.234/.test(vt) && /5,03%/.test(vt), vt.replace(/\s+/g, ' ').slice(0, 200));
  check('aba Vídeo: views, VPH, duração, idade e canal',
    /120\.000/.test(vt) && /2,5 mil\/h/.test(vt) && /10:00/.test(vt) && /há 2 dias/.test(vt) && /Canal do Teste/.test(vt), vt.replace(/\s+/g, ' ').slice(0, 320));
  await page.waitForFunction(() => !!document.querySelector('#secondary-inner #tc-panel'), null, { timeout: 25000 });
  check('o painel se encaixa na coluna dos relacionados assim que ela aparece', (await page.$eval('#tc-panel', (e) => e.className)).includes('tc-inline'));
  check('aba Vídeo diz que não gasta créditos', /Não gasta créditos/i.test(vt));
  const dl = await page.getAttribute('#tc-panel a[download]', 'href');
  check('"Baixar a capa" aponta para a capa do vídeo', dl === `https://i.ytimg.com/vi/${VID}/maxresdefault.jpg`, dl);
  // SEO calculado no navegador, sem conta
  await page.click('#tc-panel .tc-tab:nth-child(2)');
  const st = await page.textContent('#tc-panel .tc-pane');
  check('aba SEO: nota calculada aqui (86 com 6 de 7 itens)', (await page.textContent('#tc-panel .tc-score-n')) === '86', await page.textContent('#tc-panel .tc-score-n'));
  check('checklist mostra o item que falta com a dica', /⚠️ Pelo menos 8 tags/.test(st) && /Tem 6\./.test(st), st.replace(/\s+/g, ' ').slice(0, 400));
  check('checklist marca os itens que já estão certos', (st.match(/✅/g) || []).length === 6, String((st.match(/✅/g) || []).length));
  const tags = await page.$$eval('#tc-panel .tc-tags a', (a) => a.map((x) => ({ t: x.textContent, h: x.getAttribute('href'), star: x.className })));
  check('as 6 tags do vídeo aparecem clicáveis para pesquisar', tags.length === 6 && tags[0].h === '/results?search_query=bedwars', JSON.stringify(tags[0]));
  check('★ marca a tag que está no título e ▲ a que está na descrição', tags[0].t.startsWith('★ ') && tags[0].star === 'star' && tags.some((x) => x.t.includes('▲')), tags.map((x) => x.t).join(' | '));
  // Canal e IA: caixinha de conta, NÃO tela de login
  await page.click('#tc-panel .tc-tab:nth-child(3)');
  await page.waitForSelector('#tc-panel .tc-need', { timeout: 5000 });
  check('aba Canal sem conta: caixinha dentro do painel, com o painel inteiro ainda à vista',
    /precisa da sua conta/.test(await page.textContent('#tc-panel .tc-need')) && (await page.$$('#tc-panel .tc-tab')).length === 4);
  check('a caixinha avisa que o resto funciona sem conta', /O resto funciona sem conta/.test(await page.textContent('#tc-panel .tc-need')));
  await page.click('#tc-panel .tc-tab:nth-child(4)');
  await page.waitForSelector('#tc-panel .tc-need', { timeout: 5000 });
  check('aba IA sem conta: explica o que a IA faz e oferece entrar', /A IA assiste a este vídeo/.test(await page.textContent('#tc-panel .tc-pane')) && !!(await page.$('#tc-panel .tc-need')));
  check('miniaturas dos relacionados ganham VPH sem conta', (await page.$$('#secondary .tc-badge')).length === 2);
  check('nada disso gastou crédito', (await credits()) === c0);

  /* ================= 2. etiquetas na página inicial ================= */
  console.log('\n— Etiquetas nas miniaturas —');
  const home = watch(await ctx.newPage());
  await home.goto('https://www.youtube.com/');
  await home.waitForSelector('.tc-badge', { timeout: 15000 });
  const badges = await home.$$eval('.tc-badge', (b) => b.map((x) => ({ t: x.textContent, hot: x.classList.contains('hot') })));
  check('VPH em todas as miniaturas com views e data (5), sem a live', badges.length === 5, JSON.stringify(badges));
  check('1,2 mi em 3 dias = 16,7 mil/h e marcado como outlier 🔥', badges[0]?.t.startsWith('⚡ 16,7 mil/h') && badges[0].hot, badges[0]?.t);
  check('entende o formato curto do YouTube de hoje, sem a palavra "visualizações"', badges[0]?.t.includes('16,7 mil'), badges[0]?.t);
  check('entende a idade abreviada ("há 2 sem")', badges[1]?.t.startsWith('⚡ 60/h'), badges[1]?.t);
  check('entende a idade abreviada ("há 5 h")', badges[4]?.t.startsWith('⚡ 2 mil/h'), badges[4]?.t);
  check('lê também o formato em inglês (345K views, 2 weeks ago)', badges[2]?.t.startsWith('⚡ 1 mil/h'), badges[2]?.t);
  check('não põe etiqueta em transmissão ao vivo ("273 assistindo")', badges.length === 5);
  check('botão de ideia na miniatura abre o Preparar com o título', (await home.$$eval('.tc-remix', (a) => a.length)) >= 5);

  /* ================= 3. busca ================= */
  console.log('\n— Busca —');
  const sp = watch(await ctx.newPage());
  await sp.goto('https://www.youtube.com/results?search_query=bedwars');
  await sp.waitForSelector('#tc-search .tc-score-n', { timeout: 15000 });
  const sb = await sp.textContent('#tc-search');
  check('busca: pontuação da palavra-chave + demanda, mediana, recentes, canais e oportunidade',
    +(await sp.textContent('#tc-search .tc-score-n')) > 0 && /Demanda/.test(sb) && /Canais diferentes\s*4 de 6/.test(sb) && /Oportunidade/.test(sb), sb.replace(/\s+/g, ' ').slice(0, 260));
  check('resultados da busca ganham VPH', (await sp.$$('ytd-video-renderer .tc-badge')).length === 6);
  const ordem0 = await sp.$$eval('ytd-search ytd-video-renderer h3', (n) => n.map((x) => x.textContent));
  await sp.click('#tc-search .tc-sort button:nth-child(2)');
  const ordemV = await sp.$$eval('ytd-search ytd-video-renderer h3', (n) => n.map((x) => x.textContent));
  check('"Mais vistos" reordena na tela', ordemV[0] === 'Bedwars 1' && ordemV.join() !== ordem0.join(), ordemV.join(' | '));
  await sp.click('#tc-kwgo');
  await sp.waitForSelector('#tc-kwout .tc-need, #tc-kwout table', { timeout: 10000 });
  check('termos relacionados sem conta: pede a conta ali mesmo, sem sair da busca', !!(await sp.$('#tc-kwout .tc-need')));

  /* ================= 4. canal e Shorts ================= */
  console.log('\n— Página de canal e Shorts —');
  const ch = watch(await ctx.newPage());
  await ch.goto('https://www.youtube.com/@canalteste/videos');
  await ch.waitForSelector('#tc-chan .tc-fab', { timeout: 15000 });
  await ch.click('#tc-chan .tc-fab');
  check('canal: cartão flutuante com "Analisar canal" e "Adicionar aos concorrentes"', /Analisar canal/.test(await ch.textContent('#tc-chan')) && /concorrentes/.test(await ch.textContent('#tc-chan')));
  check('miniaturas do canal ganham VPH', (await ch.$$('.tc-badge')).length === 4);
  const sh = watch(await ctx.newPage());
  await sh.goto('https://www.youtube.com/shorts/shortsAAAA1');
  await sh.waitForSelector('#tc-shorts', { timeout: 15000 });
  await sh.click('#tc-shorts');
  await sh.waitForSelector('#tc-panel', { timeout: 10000 });
  check('Shorts: botão abre o painel flutuante do Short', (await sh.$eval('#tc-panel', (e) => e.className)).includes('tc-floating'));
  const sht = await sh.textContent('#tc-panel');
  check('Shorts: lê as views e o canal da própria tela quando o player ainda está no vídeo antigo',
    /12\.000/.test(sht) && /Canal do Short/.test(sht) && /Lido da tela deste Short/.test(sht), sht.replace(/\s+/g, ' ').slice(0, 220));
  await sh.click('#tc-panel .tc-tab:nth-child(2)');
  check('Shorts: a aba SEO avisa que falta descrição e tags, em vez de dar nota errada',
    /precisa da descrição e das tags/.test(await sh.textContent('#tc-panel .tc-pane')));
  await sh.close();

  // Botões: têm que ser links de verdade, para funcionarem com o service worker parado
  const lk = watch(await ctx.newPage());
  await lk.goto('https://www.youtube.com/watch?v=' + VID);
  await lk.waitForSelector('#tc-panel .tc-actions a[href]', { timeout: 20000 });
  const links = await lk.$$eval('#tc-panel a[href]', (as) => as.map((a) => ({ h: a.getAttribute('href'), t: a.getAttribute('target') })));
  check('os atalhos do painel são links de verdade (abrem mesmo com o service worker parado)',
    links.filter((l) => l.h.startsWith(PUBLIC)).every((l) => l.t === '_blank') && links.some((l) => l.h.includes('/#/ferramentas/insights?video=' + VID)), JSON.stringify(links.slice(0, 4)));
  const botoesMortos = await lk.$$eval('#tc-panel button', (bs) => bs.filter((b) => /IA do vídeo|cortes|Meu canal/.test(b.textContent)).length);
  check('nenhum atalho do site ficou como botão dependente de mensagem', botoesMortos === 0, String(botoesMortos));
  await lk.close();

  // O painel não pode depender do servidor para aparecer
  travarMe = true;
  const lento = watch(await ctx.newPage());
  await lento.goto('https://www.youtube.com/watch?v=' + VID);
  await lento.waitForSelector('#tc-panel .tc-grid', { timeout: 15000 });
  const lentoTxt = await lento.textContent('#tc-panel .tc-pane');
  check('com o servidor travado, o painel abre do mesmo jeito com views, VPH e SEO',
    /120\.000/.test(lentoTxt) && /2,5 mil\/h/.test(lentoTxt), lentoTxt.replace(/\s+/g, ' ').slice(0, 160));
  await lento.click('#tc-panel .tc-tab:nth-child(2)');
  const notaSemServidor = +(await lento.textContent('#tc-panel .tc-score-n'));
  check('e a nota de SEO sai mesmo sem o servidor', notaSemServidor >= 50 && notaSemServidor <= 100, String(notaSemServidor));
  await lento.close();
  travarMe = false;

  /* ================= 5. Studio ================= */
  console.log('\n— YouTube Studio —');
  const sd = watch(await ctx.newPage());
  await sd.goto('https://studio.youtube.com/video/' + VID + '/edit');
  await sd.waitForSelector('#tc-studio .tc-fab', { timeout: 15000 });
  await sd.click('#tc-studio .tc-fab');
  check('Studio: botão flutuante com atalhos do TurboCanal', /SEO deste vídeo|IA do vídeo/.test(await sd.textContent('#tc-studio')));
  await sd.close();

  /* ================= 6. a sessão chega pelo site, sem service worker ================= */
  console.log('\n— Entrar pelo site e o painel reconhecer sozinho —');
  await login();
  const siteTab = watch(await ctx.newPage());
  await siteTab.goto(PUBLIC + '/#/dashboard');
  await siteTab.waitForTimeout(2500); // site-token.js guarda a sessão
  await siteTab.close();
  await ctx.clearCookies(); // tira o cookie: agora SÓ o que o site guardou pode servir
  const semCookie = watch(await ctx.newPage());
  await semCookie.goto('https://www.youtube.com/watch?v=' + VID);
  await semCookie.waitForSelector('#tc-panel .tc-grid', { timeout: 20000 });
  await semCookie.waitForFunction(() => /💎/.test(document.querySelector('#tc-panel .tc-credits')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  check('entrou no site uma vez: o painel do YouTube reconhece a conta mesmo sem o cookie',
    /💎/.test(await semCookie.textContent('#tc-panel .tc-credits')), await semCookie.textContent('#tc-panel .tc-credits'));
  await semCookie.click('#tc-panel .tc-tab:nth-child(3)');
  await semCookie.waitForSelector('#tc-panel .tc-chan, #tc-panel .tc-need', { timeout: 20000 });
  check('e a aba Canal abre de verdade, sem pedir login de novo', !(await semCookie.$('#tc-panel .tc-need')));
  await semCookie.close();

  /* ================= 7. COM CONTA: Canal e IA de verdade ================= */
  console.log('\n— Com a conta ligada —');
  await login();
  const c1 = await credits();
  const p2 = watch(await ctx.newPage());
  await p2.goto('https://www.youtube.com/watch?v=' + VID);
  await p2.waitForSelector('#tc-panel .tc-credits', { timeout: 20000 });
  check('painel mostra o saldo quando tem conta', /💎/.test(await p2.textContent('#tc-panel .tc-credits')));
  await p2.click('#tc-panel .tc-tab:nth-child(3)');
  await p2.waitForSelector('#tc-panel .tc-chan', { timeout: 20000 });
  const ct = await p2.textContent('#tc-panel .tc-pane');
  check('aba Canal: inscritos, views, vídeos, mediana recente e outlier', /Inscritos/.test(ct) && /Mediana recente/.test(ct) && /Outlier/.test(ct), ct.replace(/\s+/g, ' ').slice(0, 300));
  check('painel do canal custou 1 crédito', c1 - (await credits()) === 1, String(c1 - (await credits())));
  const c2 = await credits();
  await p2.click('#tc-panel .tc-tab:nth-child(4)');
  await p2.waitForSelector('#tc-panel .tc-pane .tc-btn', { timeout: 10000 });
  await p2.click('#tc-panel .tc-pane .tc-btn');
  await p2.waitForSelector('#tc-panel .tc-pane .tc-sec', { timeout: 60000 });
  const ai = await p2.textContent('#tc-panel .tc-pane');
  check('aba IA: resumo, nota do gancho, desempenho, 3 ideias e dicas (300 créditos)',
    /Resumo/.test(ai) && /Gancho: \d+\/10/.test(ai) && /Desempenho/.test(ai) && /3 ideias/.test(ai) && /inscritos/i.test(ai) && c2 - (await credits()) === 300, ai.replace(/\s+/g, ' ').slice(0, 260));
  await p2.close();

  /* ================= 8. popup (sem tela de login) ================= */
  console.log('\n— Popup —');
  await ctx.clearCookies();
  const anon = watch(await ctx.newPage());
  const opened = [];
  await anon.exposeFunction('__open', (u) => opened.push(u));
  await anon.addInitScript(() => {
    const t = setInterval(() => {
      if (window.chrome?.tabs?.create) {
        clearInterval(t);
        window.chrome.tabs.create = async ({ url }) => { await window.__open(url); return {}; };
        window.chrome.runtime.sendMessage = () => Promise.reject(new Error('service worker fora do ar'));
      }
    }, 5);
  });
  await anon.goto(`chrome-extension://${extId}/popup.html`);
  // sair de verdade: sem cookie E sem a sessão guardada pela extensão
  await anon.evaluate(() => chrome.storage.local.remove(['tc_token', 'tc_token_em']));
  await anon.reload();
  await anon.waitForSelector('#canal', { timeout: 15000 });
  const pt0 = await anon.textContent('body');
  check('popup SEM conta já mostra as ferramentas (nenhuma tela de login)', !!(await anon.$('#tend')) && !!(await anon.$('#ideias')) && !!(await anon.$('#kw')));
  check('popup mostra a versão instalada', pt0.includes('v' + VER), pt0.slice(0, 60));
  await anon.waitForSelector('#conta .conta', { timeout: 15000 });
  check('a conta aparece como uma caixinha, não como tela', /precisam da sua conta/.test(await anon.textContent('#conta')) && /sem conta/.test(await anon.textContent('#conta')));
  await anon.click('#cEntrar');
  check('botão "Entrar com Google" abre o login mesmo com o service worker fora do ar', opened.filter((u) => u.endsWith('/api/auth/google')).length === 1, JSON.stringify(opened));
  check('e o botão avisa na tela o que fez', /Abri o login do Google/.test(await anon.textContent('#msg')));
  check('popup tem o botão de recarregar a extensão (sem precisar de chrome://extensions)', !!(await anon.$('#rec')));
  await anon.click('#diag');
  await anon.waitForFunction(() => /Site no ar|Não consegui falar/.test(document.querySelector('#msg')?.textContent || ''), null, { timeout: 25000 });
  check('"testar conexão" mostra o diagnóstico', /Site no ar/.test(await anon.textContent('#msg')), (await anon.textContent('#msg')).slice(0, 120));
  for (const [sel, hash] of [['#tend', 'ferramentas/tendencias'], ['#ideias', 'ferramentas/ideias'], ['#canal', 'canal'], ['#postar', 'canal/postar'], ['#dash', 'dashboard']]) await anon.click(sel);
  const esperado = ['ferramentas/tendencias', 'ferramentas/ideias', 'canal', 'canal/postar', 'dashboard'].map((x) => PUBLIC + '/#/' + x);
  check('botões do popup abrem as páginas certas do site', opened.slice(1).join(' ') === esperado.join(' '), opened.slice(1).join(' '));
  await anon.close();

  await login();
  versionOverride = '9.9.9';
  const pop = watch(await ctx.newPage());
  await pop.addInitScript(() => {
    const t = setInterval(() => { if (window.chrome?.tabs?.create) { clearInterval(t); window.chrome.tabs.create = async () => ({}); } }, 5);
  });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForSelector('#conta .badge', { timeout: 20000 });
  check('com conta, o popup mostra nome, saldo e plano', /Criador Teste/.test(await pop.textContent('#conta')) && /créditos/.test(await pop.textContent('#conta')) && /plano/.test(await pop.textContent('#conta')));
  await pop.waitForSelector('#upd .warn', { timeout: 15000 });
  check('popup avisa quando há versão nova', /Saiu a v9\.9\.9/.test(await pop.textContent('#upd')));
  versionOverride = null;
  await pop.fill('#kw', 'bedwars');
  await pop.click('#kwgo');
  await pop.waitForSelector('#out table', { timeout: 30000 });
  check('pesquisa rápida do popup funciona', /views médias/.test(await pop.textContent('#out')));
  await pop.uncheck('#swB');
  await home.waitForFunction(() => document.querySelectorAll('.tc-badge').length === 0, null, { timeout: 10000 }).catch(() => {});
  check('desligar "VPH nas miniaturas" tira as etiquetas na hora', (await home.$$('.tc-badge')).length === 0);
  await pop.check('#swB');
  await home.waitForFunction(() => document.querySelectorAll('.tc-badge').length === 5, null, { timeout: 10000 }).catch(() => {});
  check('religar mostra de novo', (await home.$$('.tc-badge')).length === 5);
  await pop.close();

  /* ============ 9. endereço torto no armazenamento: conserta sozinho ============ */
  console.log('\n— Endereço corrompido —');
  const fix = watch(await ctx.newPage());
  await fix.goto(`chrome-extension://${extId}/popup.html`);
  // exatamente o lixo que apareceu na máquina do usuário: com "#" no meio
  await fix.evaluate(() => chrome.storage.sync.set({ baseUrl: 'https://turbocanal.onrender.com/#/dashboard/api/auth/google' }));
  const quebrado = watch(await ctx.newPage());
  await quebrado.goto('https://www.youtube.com/watch?v=' + VID);
  await quebrado.waitForSelector('#tc-panel .tc-grid', { timeout: 20000 });
  await quebrado.waitForFunction(() => {
    try { return JSON.parse(document.documentElement.dataset.tcCfg || '{}').baseUrl === 'https://turbocanal.onrender.com'; } catch { return false; }
  }, null, { timeout: 15000 }).catch(() => {});
  const cfg = JSON.parse(await quebrado.getAttribute('html', 'data-tc-cfg') || '{}');
  check('endereço com "#" guardado por engano é limpo sozinho', cfg.baseUrl === PUBLIC, cfg.baseUrl);
  await quebrado.waitForFunction(() => /💎/.test(document.querySelector('#tc-panel .tc-credits')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  check('e a conta volta a ser reconhecida depois do conserto', /💎/.test(await quebrado.textContent('#tc-panel .tc-credits')), await quebrado.textContent('#tc-panel .tc-credits'));
  const guardado = await fix.evaluate(() => chrome.storage.sync.get(['baseUrl']).then((x) => x.baseUrl));
  check('o endereço consertado fica guardado (não volta a quebrar)', guardado === PUBLIC, String(guardado));
  await quebrado.close();
  await fix.close();

  /* ================= 10. opções ================= */
  const opt = watch(await ctx.newPage());
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector('#bu', { timeout: 15000 });
  check('opções: mostra o endereço do site e a versão', (await opt.inputValue('#bu')) === PUBLIC && (await opt.textContent('#ver')) === 'v' + VER);
  await opt.click('#test');
  await opt.waitForFunction(() => /Site no ar|Não consegui falar/.test(document.querySelector('#msg')?.textContent || ''), null, { timeout: 25000 });
  check('opções: "testar conexão" responde', /Site no ar/.test(await opt.textContent('#msg')), (await opt.textContent('#msg')).slice(0, 120));
  await opt.close();

  const graves = errors.filter((e) => !/net::|favicon|Trusted Type|ERR_/.test(e));
  check('nenhum erro de JavaScript nas páginas', graves.length === 0, graves.slice(0, 3).join(' | '));
  console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
  await ctx.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
