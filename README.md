# TurboCanal 🚀

Plataforma original de ferramentas para criadores do YouTube (inspirada na categoria de produtos como o vidIQ, sem copiar código, marca ou visual de terceiros): site + API + extensão para Chrome, com sistema de créditos, 6 planos, pagamentos Pix e painel administrativo.

NÃO é afiliada ao YouTube, ao Google nem ao vidIQ.

## O que está incluído

```
turbocanal/
  server/        Backend Node.js + Express + SQLite (serve também o site)
    src/         Código da API (auth, créditos, YouTube, pagamentos, admin)
    test/        Testes automatizados obrigatórios (npm test)
    .env.example Variáveis de ambiente documentadas
  web/           Site (SPA sem build: HTML + CSS + JS) servido pelo backend
  extension/     Extensão Chrome Manifest V3 (carregar sem compactação)
  DEPLOY.md      Opções reais de hospedagem de baixo custo
```

Decisões técnicas (resumo): Node + Express + Postgres (driver pg em produção; PGlite, um Postgres embutido, para rodar local e nos testes sem instalar nada). O frontend é uma SPA estática servida pelo próprio backend (zero custo extra de hospedagem). Senhas com bcrypt, sessão JWT (cookie httpOnly no site, Bearer na extensão), SQL sempre com prepared statements, permissões e saldos validados SEMPRE no servidor.

## Rodar localmente

```bash
cd server
npm install
npm start          # http://localhost:8787
npm test           # roda os testes obrigatórios (34 verificações)
```

Sem DATABASE_URL, o banco embutido é criado sozinho em `server/data/pglite` com os 6 planos, a tabela de custos e as configurações iniciais. Em produção, defina DATABASE_URL (Postgres).

## Primeiro acesso do administrador principal (lcmatias777@gmail.com)

Segurança: o e-mail enviado pelo navegador NUNCA dá privilégio sozinho. Para virar administrador principal (owner):

1. Na primeira execução, o console do servidor imprime um TOKEN DE SETUP (uso único).
2. Cadastre-se no site com o e-mail configurado em `OWNER_EMAIL` (padrão: lcmatias777@gmail.com).
3. Vá em Conta > "Sou o administrador" e cole o token.

Pronto: a conta vira `owner`, com acesso total ao painel admin, uso ILIMITADO das ferramentas (nenhum crédito é cobrado, regra aplicada no backend e registrada no histórico), isenção de qualquer cobrança interna, e isso permanece após logout, novo login, atualização ou reinício do servidor (fica gravado no banco). Alternativa: com o Login com Google configurado, entrar com esse e-mail verificado também concede owner.

O administrador principal pode promover outras contas a administrador e removê-las (aba Administradores). Admins adicionais acessam o painel, mas não promovem/removem ninguém e não conseguem tocar no principal. Tudo fica na auditoria.

## Configurações que ainda dependem de você (checklist)

1. YouTube Data API (para dados reais): crie um projeto em console.cloud.google.com, ative a "YouTube Data API v3" e gere uma chave de API. Cole em Admin > Configurações (ou `YT_API_KEY`). Sem a chave, as ferramentas avisam a pendência e NÃO inventam dados (e não cobram créditos). Atenção à cota gratuita diária da API (10.000 unidades/dia por padrão; uma busca custa 100 unidades).
2. Pagamentos Pix (Mercado Pago): crie uma aplicação em mercadopago.com.br/developers, pegue o Access Token (comece pelo de TESTE), cole em Admin > Configurações, cadastre o webhook mostrado na tela (`/api/payments/webhook`, requer site publicado em HTTPS) e só então ative "Pagamentos". Créditos só são liberados com confirmação real do provedor, ou confirmação manual auditada por um admin que conferiu o comprovante. O dinheiro cai na conta Mercado Pago vinculada ao token (verificação de titularidade é feita pelo próprio Mercado Pago no cadastro).
3. Chave Pix de recebimento: o número 54984398807 foi salvo como candidato (tipo telefone), NÃO confirmado. Confira no app do banco se esse número está cadastrado como chave Pix e confirme no painel. Observação: com o Mercado Pago, o recebimento vai para a conta MP do token; a chave Pix do painel é informativa/para confirmação manual.
4. Login com Google (opcional): credenciais OAuth no Google Cloud (`GOOGLE_CLIENT_ID/SECRET`), redirect `SEU_SITE/api/auth/google/callback`.
5. IA real (opcional): `ANTHROPIC_API_KEY` (a API da Anthropic é paga por uso). Sem ela, títulos/descrições usam gerador local e avisam o método.
6. Hospedagem: veja DEPLOY.md.

## Canal do YouTube (OAuth) e IA

1. Login com Google e "Conectar meu canal" usam OAuth 2.0 (GOOGLE_CLIENT_ID/SECRET). Com o canal conectado: página Meu canal (vídeos e estatísticas), enviar capa (thumbnails.set), editar título/descrição (videos.update) e teste A/B de capas (alternância agendada pelo servidor, com views por período). Só vídeos do canal conectado podem ser alterados (verificado no servidor).
2. Entrar com o Google usando o e-mail do administrador principal concede o papel de owner automaticamente (e-mail verificado pelo Google), sem token de console.
3. IA Gemini (chave gratuita do Google AI Studio, colada em Admin > Configurações): "IA assiste o vídeo" (insights a partir da URL pública) e "Capa com IA" (imagem 16:9). Sem chave, as ferramentas avisam a pendência e não cobram.

## Sistema de créditos e planos

1. Free: R$ 0, saldo completado até 5.000 créditos todo mês (valor configurável no admin). Regra transparente de reposição, sem bloquear indevidamente as ferramentas gratuitas.
2. Starter R$ 10 (60.000), Creator R$ 20 (140.000), Pro R$ 40 (320.000), Studio R$ 70 (600.000), Max R$ 100 (1.000.000) créditos/mês. Tudo editável no painel (preço, créditos, ativo), escala proporcional.
3. Custos por ferramenta (editáveis): tendências 3, busca 4, palavras-chave 5, análise de vídeo/canal 8, descrição IA 15, títulos IA 20.
4. Importante sobre os "50x/100x": são METAS COMPARATIVAS internas de referência. O site não anuncia multiplicadores como fato comprovado. Referência mensurável: no Free, 5.000 créditos ≈ 1.000 pesquisas de palavra-chave ou 625 análises de vídeo por mês; ajuste os números no admin conforme os custos reais de API que você observar.
5. Garantias implementadas e testadas: débito no servidor, saldo nunca negativo, idempotência (sem cobrança duplicada), estorno automático se a ferramenta falhar, histórico completo, rate limit em cadastro/login/ferramentas contra abuso e criação automática de contas.

## Extensão do Chrome (não publicada na Web Store)

1. Chrome > `chrome://extensions` > ative "Modo do desenvolvedor".
2. "Carregar sem compactação" > escolha a pasta `extension/`.
3. Nas opções da extensão, informe o endereço do site (local ou publicado).
4. Entre com e-mail/senha ou com o token gerado em Conta > Token para a extensão.

Ela mostra seus créditos, faz pesquisa rápida de palavras-chave e adiciona o botão "TC" nas páginas de vídeo do YouTube com análise de SEO. Mesma conta, mesmo saldo, mesmas regras do site (tudo validado no servidor).

## Segurança e operação

1. Segredos só em variáveis de ambiente ou no banco (mascarados no painel); nunca no frontend.
2. Logs e auditoria não expõem segredos (valores sensíveis aparecem mascarados).
3. Backup: copie `server/data/turbocanal.db` (com o servidor parado, ou use `sqlite3 ... ".backup"`). Guarde cópias fora do servidor. Restauração = devolver o arquivo e reiniciar.
4. Produção: use HTTPS (COOKIE_SECURE=1) e um proxy como Caddy/Nginx.

## Estado honesto do projeto

1. FUNCIONANDO E TESTADO (34 testes automatizados + testes manuais via HTTP): cadastro/login, créditos (débito, recarga mensal, idempotência, estorno, saldo nunca negativo), isolamento entre contas, papéis user/admin/owner, proteção contra e-mail forjado, owner ilimitado/isento persistente, gestão de admins com auditoria, site completo, API, extensão (mesmo backend).
2. IMPLEMENTADO, AGUARDANDO SUAS CREDENCIAIS PARA DADOS REAIS: YouTube Data API, Login com Google, IA (Anthropic), cobrança Pix via Mercado Pago (criação de cobrança, QR Code, copia-e-cola, webhook, reconciliação). Teste primeiro com o token de TESTE do Mercado Pago.
3. NÃO FEITO: publicação em hospedagem (precisa das suas contas; roteiro no DEPLOY.md), publicação da extensão na Chrome Web Store (exige conta de desenvolvedor, taxa única da Google e revisão), e-mail transacional de verificação de conta (o fluxo do owner usa token de console justamente para não depender disso).
