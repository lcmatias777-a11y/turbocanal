# Hospedagem e operação do TurboCanal

O sistema é 1 processo Node 22 que serve a API e o site, com banco Postgres (variável `DATABASE_URL`). Sem `DATABASE_URL` ele usa o PGlite (Postgres embutido em arquivo), útil só para rodar local.

## Como está publicado hoje

1. Render, Web Service gratuito `turbocanal` (raiz `server/`, build `npm install`, start `npm start`, Node 22), endereço https://turbocanal.onrender.com. O plano gratuito hiberna após 15 minutos sem acesso: o primeiro acesso depois disso demora cerca de 50 segundos.
2. Render Postgres gratuito `turbocanal-db`, ligado ao serviço pela `DATABASE_URL`. Atenção: o Postgres gratuito do Render expira em 19/11/2026. Antes disso, crie um banco gratuito no Neon (neon.tech), copie os dados (`pg_dump` do Render e `psql` no Neon) e troque a `DATABASE_URL` no Render.
3. Deploy: código no GitHub (lcmatias777-a11y/turbocanal). Em Render > turbocanal > Manual Deploy > "Deploy latest commit".

## Variáveis de ambiente (Render > Environment)

1. `DATABASE_URL`: ligada ao Postgres.
2. `BASE_URL=https://turbocanal.onrender.com` e `COOKIE_SECURE=1`.
3. `OWNER_EMAIL=lcmatias777@gmail.com`.
4. `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: cliente OAuth "TurboCanal Web" do projeto turbocanal no Google Cloud, com redirect `https://turbocanal.onrender.com/api/auth/google/callback`.
5. Opcionais: `GEMINI_API_KEY` (ou cole em Admin > Configurações), `ANTHROPIC_API_KEY`, token do Mercado Pago (Admin > Configurações).

## Google Cloud (projeto turbocanal)

1. APIs ativadas: YouTube Data API v3 e YouTube Analytics API.
2. Tela de consentimento: externa, em modo "Teste" (só os usuários de teste entram). Links: página inicial, /privacidade e /termos do site.
3. Para abrir a todos: Google Auth Platform > Público-alvo > Publicar app. Sem verificação o Google mostra aviso de "app não verificado" e limita a 100 usuários. A verificação dos escopos do YouTube é feita pelo Google e pode pedir vídeo de demonstração.

## Backup

O Postgres gratuito do Render não tem backup automático; faça manualmente: `pg_dump "$DATABASE_URL" > turbocanal-$(date +%F).sql`. Restauração: `psql "$NOVA_DATABASE_URL" < arquivo.sql`.

## Alternativa paga (sem hibernação)

Instância Starter do Render (cerca de US$ 7/mês) mantém o site acordado; o banco pode continuar no Neon gratuito.
