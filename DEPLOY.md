# Hospedagem do TurboCanal (baixo custo)

O sistema é 1 processo Node que serve API + site, com banco SQLite em arquivo. Isso simplifica muito: qualquer máquina com Node 18+ e disco persistente roda tudo. Requisitos: Node >= 18, disco persistente para `server/data/`, HTTPS no domínio público (necessário para cookies seguros, extensão em produção e webhook do Mercado Pago).

Importante e honesto: eu não tenho acesso às suas contas de hospedagem, então NADA foi publicado ainda; os preços e limites de planos gratuitos mudam com frequência, confira a página de preços do serviço antes de decidir.

## Opção A (recomendada): VPS barato + Caddy

Serve para Hetzner, Contabo, Oracle Cloud (tem camada "Always Free" com VPS ARM, sujeita a disponibilidade), DigitalOcean etc. Passos num Ubuntu novo:

```bash
# 1) Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2) Projeto
sudo mkdir -p /opt/turbocanal && sudo chown $USER /opt/turbocanal
# envie a pasta do projeto (scp/sftp/git) para /opt/turbocanal
cd /opt/turbocanal/server && npm install --omit=dev

# 3) Variáveis (crie /opt/turbocanal/server/.env.prod a partir do .env.example)
#    PORT=8787, COOKIE_SECURE=1, BASE_URL=https://seudominio.com.br, OWNER_EMAIL=...

# 4) Serviço systemd
sudo tee /etc/systemd/system/turbocanal.service >/dev/null <<'EOF'
[Unit]
Description=TurboCanal
After=network.target
[Service]
WorkingDirectory=/opt/turbocanal/server
EnvironmentFile=/opt/turbocanal/server/.env.prod
ExecStart=/usr/bin/node src/index.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now turbocanal
journalctl -u turbocanal | grep "TOKEN DE SETUP"   # token do administrador principal

# 5) HTTPS automático com Caddy (aponte o DNS do domínio para o IP antes)
sudo apt install -y caddy
echo 'seudominio.com.br { reverse_proxy localhost:8787 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Backup diário simples (cron): `sqlite3 /opt/turbocanal/server/data/turbocanal.db ".backup /backups/turbocanal-$(date +%F).db"`.

## Opção B: PaaS com disco persistente (Render, Railway, Fly.io)

1. Render: Web Service apontando para `server/` (build `npm install`, start `npm start`). O plano gratuito NÃO tem disco persistente (o SQLite seria apagado a cada deploy) e hiberna; para produção, use a instância paga mais barata + um "Disk" montado em `/data` com `DB_PATH=/data/turbocanal.db`.
2. Railway: deploy do diretório `server/` + um Volume montado (ex.: `/data`) com `DB_PATH=/data/turbocanal.db`. Funciona dentro do crédito/assinatura de entrada deles.
3. Fly.io: `fly launch` no `server/`, crie um volume (`fly volumes create data`) e monte em `/data`.

Em todos: configure as variáveis do `.env.example`, use a URL pública como `BASE_URL`, `COOKIE_SECURE=1`, e pegue o TOKEN DE SETUP nos logs do serviço.

## Opção C: serverless gratuito (Cloudflare Pages/Workers, Vercel + Neon/Supabase)

Dá para chegar em custo zero contínuo, mas exige MIGRAR o banco de SQLite para Postgres (Neon/Supabase têm planos gratuitos com limites) ou Cloudflare D1, e adaptar o servidor Express para o runtime serverless. É uma evolução natural do projeto, não está feita nesta versão; se quiser seguir por aí, me peça a migração.

## Limites que não desaparecem com hospedagem grátis

1. YouTube Data API: cota gratuita diária (padrão 10.000 unidades/dia; busca = 100 unidades). O sistema de créditos existe para manter o uso dentro disso; acompanhe em Admin > Visão geral e ajuste custos/planos.
2. IA (Anthropic): paga por uso; sem chave, o modo heurístico gratuito continua funcionando.
3. Mercado Pago: cobra tarifa por transação Pix recebida (confira a tabela vigente deles).
