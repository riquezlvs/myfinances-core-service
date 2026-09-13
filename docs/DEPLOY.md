# Guia de Deploy — MyFinances Core Service

Este guia explica como colocar o bot em produção usando serviços gratuitos.

---

## Pré-requisitos

- Conta [Supabase](https://supabase.com) (projeto gratuito)
- API Key do [Gemini](https://aistudio.google.com/apikey)
- Bot Token do Telegram ([@BotFather](https://t.me/BotFather))
- Node.js 20+ instalado localmente

---

## 1. Configuração do Supabase

### Criar projeto
1. Acesse [supabase.com](https://supabase.com) → New Project
2. Escolha região (São Paulo recomendada para latência)
3. Aguarde o provisionamento

### Aplicar migrações
```bash
# Instalar Supabase CLI
npm install -g supabase

# Login
supabase login

# Link com seu projeto
supabase link --project-ref SEU_PROJECT_ID

# Aplicar todas as migrações
supabase db push
```

Isso cria todas as tabelas, índices, RPCs e políticas RLS.

### Configurar RLS
As migrações já habilitam RLS e criam policies para `service_role`. Verifique no Dashboard → Authentication → Policies que todas as tabelas têm:
- `service_role`: acesso total (full CRUD)
- `anon`/`authenticated`: sem acesso (REVOKE)

---

## 2. Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

| Variável | Onde obter |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `TELEGRAM_AUTHORIZED_USER_ID` | @userinfobot (seu ID numérico) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `SUPABASE_URL` | Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API → service_role key |

⚠️ **NUNCA** commite o arquivo `.env` real. Ele está no `.gitignore`.

---

## 3. Deploy em Serviços Gratuitos

### Railway (recomendado)

1. Conecte seu GitHub ao [Railway](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Em **Variables**, adicione todas as variáveis do `.env`
4. Em **Settings → Deploy**, configure:
   - Start Command: `npm start`
   - Healthcheck Path: `/health` (se implementado)

### Fly.io

```bash
# Instalar flyctl
flyctl auth login

# Criar app
flyctl launch

# Configurar secrets
flyctl secrets set TELEGRAM_BOT_TOKEN=xxx
flyctl secrets set TELEGRAM_AUTHORIZED_USER_ID=xxx
flyctl secrets set GEMINI_API_KEY=xxx
flyctl secrets set SUPABASE_URL=xxx
flyctl secrets set SUPABASE_SERVICE_ROLE_KEY=xxx

# Deploy
flyctl deploy
```

### Render

1. Conecte seu GitHub ao [Render](https://render.com)
2. New Web Service → Build from GitHub
3. Build Command: `npm ci && npm run build`
4. Start Command: `npm start`
5. Em **Environment**, adicione as variáveis

---

## 4. Verificação pós-deploy

Após o deploy, envie `/status` para o bot. Você deve receber:

```
🟢 Status do MyFinances Core

⏱ Uptime: 0h 2min
🗄 Supabase: online (45ms)
📦 Versão: 2.0.0
```

---

## 5. Monitoramento

### Logs
- **Railway**: Dashboard → Deployments → Logs
- **Fly.io**: `flyctl logs`
- **Render**: Dashboard → Logs

### Healthcheck
O comando `/status` retorna uptime, latência do Supabase e versão. Use para monitoramento externo (ex: UptimeRobot).

---

## 6. Atualizações

Para atualizar o bot em produção:

```bash
# Local: aplicar novas migrações
supabase db push

# Commit e push
git add .
git commit -m "feat: nova funcionalidade"
git push origin main

# O serviço de deploy detecta o push e faz redeploy automático
```

---

## Troubleshooting

| Problema | Solução |
|---|---|
| Bot não responde | Verifique `TELEGRAM_BOT_TOKEN` e se o webhook/polling está configurado |
| Erro de banco | Rode `supabase db push` para aplicar migrações pendentes |
| Gemini timeout | Verifique `GEMINI_API_KEY` e cotas no AI Studio |
| Rate limit | Aguarde 1 minuto; o limite é 30 msg/min |