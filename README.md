# TurboCanal 🚀

Plataforma original de ferramentas para criadores do YouTube (da mesma categoria de produtos como o vidIQ, sem copiar código, marca ou visual de terceiros): site + API + extensão para Chrome, com sistema de créditos, 6 planos, pagamentos Pix e painel administrativo.

Endereço público: https://turbocanal.onrender.com (Render, plano gratuito).

NÃO é afiliada ao YouTube, ao Google nem ao vidIQ.

## O que está incluído

```
turbocanal/
  server/        Backend Node.js 22 + Express + Postgres (serve também o site)
    src/         API: auth Google, créditos, YouTube, canal (Studio), IA, pagamentos, admin
    test/        Testes automatizados (npm test) + YouTube simulado para testar "Meu canal"
    .env.example Variáveis de ambiente documentadas
  web/           Site (SPA sem build: HTML + CSS + JS) servido pelo backend
  extension/     Extensão Chrome Manifest V3 (carregar sem compactação)
  render.yaml    Blueprint do Render
  DEPLOY.md      Hospedagem e operação
```

Decisões técnicas: Postgres via `pg` em produção (DATABASE_URL) e PGlite (Postgres embutido) para rodar local e nos testes. Login SOMENTE com Google (OAuth 2.0); sessão JWT em cookie httpOnly no site e Bearer na extensão. Permissões, saldos e pagamentos validados SEMPRE no servidor; SQL sempre parametrizado.

## Funcionalidades

1. Pesquisa: palavras-chave, busca de vídeos, tendências do nicho do canal (descobertas pelos vídeos dele), análise de vídeo e de canal, com VPH (views por hora), engajamento e outliers (vídeo acima da mediana).
2. IA (Gemini, só texto e cortes, sempre IA de verdade; o site não gera imagens): IA do vídeo (o usuário só escolhe o vídeo; a IA assiste os públicos, vê quadros reais e sugere título, descrição, tags, hashtags e capítulos; dá para tirar o que não quiser, revisar e salvar no YouTube; 300 créditos), ideias de vídeos, Preparar publicação, Transformar (a IA acha os 3 melhores cortes para Shorts e o editor faz os 3 de uma vez; também post, artigo, thread) e sugestão de resposta a comentários. Sem chave de IA, essas ferramentas avisam e não cobram nada. Os modelos são tentados em ordem (gemini-3.8-flash, 3.6-flash, 3.5-flash-lite...) e o que funcionar fica guardado.
3. Meu canal (como no YouTube Studio, via OAuth): meus vídeos com nota de SEO, editar título, descrição, tags e visibilidade, "Otimizar com IA", enviar capa, teste A/B de capas (alternância automática), playlists (criar, adicionar e remover vídeos), postar vídeo (upload direto do navegador para o Google, com agendamento), criar live (RTMP e chave), analytics (28 dias) e comentários (ler, responder, sugerir resposta). Só vídeos e playlists do canal vinculado podem ser alterados (verificado no servidor).
4. Editor de vídeo e criador de capas no navegador (ffmpeg.wasm servido pelo próprio site): cortar, Shorts 9:16 (corte ou fundo desfocado), tirar som, MP3, acelerar, comprimir; quadro do vídeo vira capa 1280x720 com prévia no feed. O arquivo não sai do computador.
5. Concorrentes: acompanhe até 20 canais e veja os vídeos recentes deles.
6. Extensão Chrome (v1.0.2, refeita do zero): **não tem tela de login**. Ao abrir um vídeo o painel já aparece preenchido, porque as abas **Vídeo** (views, VPH, likes, comentários, engajamento, duração, idade, canal) e **SEO** (nota de 0 a 100, checklist e tags com ★ para as que estão no título e ▲ para as da descrição) são calculadas no próprio navegador, a partir do que a página do YouTube já carregou (um content script no mundo da página lê o `ytInitialPlayerResponse`): de graça e sem gastar créditos. Também sem conta: VPH e outlier em cima das miniaturas (início, busca, relacionados, canal), pontuação da palavra-chave e resumo da busca, reordenar por mais vistos/VPH/outliers/mais novos, baixar capa, copiar título, descrição, tags e incorporação, botão de ideia na miniatura, cartão na página do canal, botão nos Shorts e no YouTube Studio. Só usam a conta as abas **Canal** (inscritos, idade, mediana recente, outlier, tags do canal) e **IA** (300 créditos), a análise de canal e os termos relacionados — e aí aparece uma caixinha dentro do painel, nunca uma tela. A sessão é reconhecida sozinha pelo cookie do site (`chrome.cookies`), então o popup e as opções funcionam mesmo se o service worker estiver parado; os dois mostram a versão instalada e têm o "testar conexão", e o menu tem um link "recarregar" (chrome.runtime.reload()) para não precisar abrir chrome://extensions a cada atualização. Os leitores de views e de idade entendem os formatos que o YouTube usa hoje de verdade, inclusive o curto, sem a palavra "visualizações" ("4,5 mil há 2 h"), e as abreviações ("há 3 sem").

## Rodar localmente

```bash
cd server
npm install
npm start          # http://localhost:8787
npm test           # 110 verificações automáticas
```

Sem DATABASE_URL, o banco embutido é criado sozinho em `server/data/pglite`. Sem Google configurado (só no ambiente local), o cadastro por senha fica disponível para testes.

## Administrador principal (lcmatias777@gmail.com)

Entrar com o Google usando esse e-mail (verificado pelo Google) concede o papel `owner`: acesso total ao painel, uso ILIMITADO e sem cobrança (regra do backend, registrada no histórico), e isso persiste após logout, novo login, atualização ou reinício. O e-mail enviado pelo navegador nunca dá privilégio sozinho. O principal promove e remove administradores; admins adicionais acessam o painel mas não mexem em admins nem no principal. Tudo fica na auditoria.

## O que ainda depende do dono da conta

1. Entrar com o Google de novo e clicar em "Vincular meu canal" (autorização do YouTube, feita pela própria pessoa).
2. Chave do Gemini (gratuita em aistudio.google.com/apikey), colada em Admin > Configurações.
3. App OAuth em modo "Teste" no Google Cloud: só usuários de teste entram. Para abrir a todos, publicar o app (o Google mostra aviso de app não verificado até a verificação, e há limite de 100 usuários sem verificação).
4. Pagamentos Pix: token do Mercado Pago em Admin > Configurações, webhook `/api/payments/webhook`, e confirmar se 54984398807 é mesmo uma chave Pix (está salvo como candidato NÃO confirmado). Créditos só são liberados com confirmação real do provedor.
5. Cota da YouTube Data API: 10.000 unidades/dia por projeto, divididas entre todos os usuários (busca 100, envio de vídeo 1.600, alterações 50, leituras 1). Pedido de aumento: support.google.com/youtube/contact/yt_api_form.
6. Banco Postgres gratuito do Render expira em 19/11/2026: migrar antes (ex.: Neon gratuito) trocando o DATABASE_URL.
7. Extensão: instalação manual (modo do desenvolvedor). Não está publicada na Chrome Web Store.

## Créditos e planos

Free R$ 0 (saldo completado até 5.000 por mês), Starter R$ 10 (60.000), Creator R$ 20 (140.000), Pro R$ 40 (320.000), Studio R$ 70 (600.000), Max R$ 100 (1.000.000). Preços, créditos e custos por ferramenta são editáveis no admin. Os "50x/100x" são metas comparativas internas, não números comprovados. Garantias testadas: débito no servidor, saldo nunca negativo, idempotência, estorno automático em falha, histórico e rate limit.

## Testes

1. `npm test`: 110 verificações (créditos, owner, admins, isolamento, pagamentos sem confirmação falsa, login só com Google, ferramentas, IA contra um Gemini simulado (troca de modelo, chave recusada, vídeo privado, 3 cortes) e "Meu canal" contra um YouTube simulado: só altera o que é seu, estorna em falha, envia todos os campos de status ao mudar visibilidade, playlists, upload, live, analytics, comentários).
2. Testes de navegador (Playwright): interface completa, editor de vídeo com arquivos reais, telas do "Meu canal" e 55 verificações da extensão carregada no Chromium (`server/test/ext-test3.cjs`), contra páginas do YouTube simuladas com os formatos reais, com Trusted Types ligado e montando likes, comentários e a coluna da direita com atraso, como o YouTube faz.
