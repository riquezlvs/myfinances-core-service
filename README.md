# MyFinances Core Service

Bot inteligente para Telegram de finanças pessoais, com processamento de linguagem natural via Gemini 3.5-flash, persistência no Supabase (PostgreSQL) e proteções robustas contra alucinações de IA.

---

## Visão Geral

O MyFinances permite registrar gastos, consultar resumos, dividir contas, criar metas de poupança e receber insights preditivos — tudo em linguagem natural, sem precisar decorar comandos.

**Exemplo de uso:**
```
"Gastei 45 reais no almoço"           → registra gasto automaticamente
"Quanto gastei com transporte mês passado?" → consulta granular
"Jantar de 120 dividido em 3 com Maria e João" → split de contas
"Quero juntar 5000 para viagem até dezembro" → meta de poupança
"Manda a planilha de setembro"        → exporta CSV
```

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ com TypeScript |
| Bot | node-telegram-bot-api |
| Banco de dados | PostgreSQL via Supabase (RLS habilitado) |
| IA | Gemini 3.5-flash (Google AI Studio) |
| Validação | Zod (runtime type checking) |
| Testes | Vitest |

---

## Funcionalidades

### Principais
- **Registro por linguagem natural**: "Gastei 30 no mercado" → transação categorizada e validada
- **Consultas granulares**: "Quanto gastei com lazer em agosto?" → resposta determinística
- **Exportação CSV**: `/exportar` ou "manda a planilha de setembro"
- **Metas de orçamento**: alertas automáticos em 80% (🟡) e 100% (🔴)
- **Insights preditivos**: análise IA com projeção de fechamento do mês

### Avançadas
- **Split de contas**: "dividido em 3 com Maria e João" → criação automática de dívidas
- **Poupança de longo prazo**: `/poupanca definir viagem 5000 2026-12` com cálculo de aporte mensal
- **Modo viagem**: gastos em USD/EUR convertidos para BRL com taxa de câmbio
- **Gráficos**: PNG gerado via @napi-rs/canvas com semáforo de orçamento

### Segurança
- **Autenticação**: apenas `TELEGRAM_AUTHORIZED_USER_ID` pode usar
- **Rate limiting**: 30 msg/min por usuário (token bucket)
- **Fila serial**: evita race conditions por chat
- **Validação Zod**: todo output do Gemini é validado antes de persistir
- **RLS**: Row Level Security habilitado em todas as tabelas
- **Double-opt-in**: ações destrutivas só via comando `/`, nunca via IA

---

## Pré-requisitos

- Node.js 20+
- Conta no [Supabase](https://supabase.com) (projeto gratuito)
- API Key do [Gemini](https://aistudio.google.com/apikey)
- Bot Token do Telegram (via [@BotFather](https://t.me/BotFather))

---

## Instalação

```bash
# Clonar o repositório
git clone https://github.com/seu-usuario/myfinances-core-service.git
cd myfinances-core-service

# Instalar dependências
npm ci

# Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Aplicar migrações no Supabase
supabase db push
```

---

## Execução

```bash
# Desenvolvimento (hot reload)
npm run dev

# Produção
npm run build
npm start
```

---

## Testes

```bash
# Suíte completa
npm test

# Com cobertura
npm run test:coverage

# Type checking
npm run typecheck
```

---

## Comandos do Bot

| Comando | Descrição |
|---|---|
| `/start` | Introdução e lista de comandos |
| `/resumo` | Resumo do mês atual |
| `/fatura` | Fatura do cartão de crédito |
| `/dividas` | Quem te deve |
| `/gastos` | Últimos lançamentos |
| `/pago` | Registrar pagamento recebido |
| `/desfazer` | Desfazer último gasto |
| `/apagar <id>` | Apagar lançamento específico |
| `/recorrente` | Despesas fixas mensais |
| `/exportar [mês]` | Exportar CSV |
| `/grafico` | Gráfico de gastos |
| `/insight` | Análise IA do mês |
| `/meta` | Metas de orçamento |
| `/cartao` | Gerenciar cartões |
| `/poupanca` | Metas de poupança |
| `/viagem` | Modo viagem (USD/EUR) |
| `/status` | Status do serviço |

---

## Estrutura do Projeto

```
src/
├── bot/                  # Handlers e comandos do Telegram
│   ├── commands/         # Comandos individuais (/resumo, /grafico, etc.)
│   ├── handlers/         # messageHandler, voiceHandler, callbackQueryHandler
│   ├── keyboards/        # Teclados inline dinâmicos
│   └── index.ts          # Setup do bot
├── clients/              # Clientes (Supabase, Gemini, Telegram)
├── config/               # Constantes e variáveis de ambiente
├── services/
│   ├── categories/       # Cache de categorias
│   ├── debts/            # Split e pagamentos
│   ├── exchange/         # Taxas de câmbio
│   ├── gemini/           # Integração com Gemini (guards, prompts, parsers)
│   ├── people/           # Resolução de pessoas
│   ├── savings/          # Metas de poupança
│   └── transactions/     # CRUD de transações
├── types/                # Tipos TypeScript
└── utils/                # Utilitários (concurrency, rateLimit, etc.)
```

---

## Variáveis de Ambiente

Veja `.env.example` para a lista completa. Principais:

| Variável | Descrição |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do bot (@BotFather) |
| `TELEGRAM_AUTHORIZED_USER_ID` | ID do usuário autorizado |
| `GEMINI_API_KEY` | API Key do Google AI Studio |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key (nunca expor) |

---

## Arquitetura

Para decisões arquiteturais detalhadas, consulte [`docs/adrs/`](docs/adrs/):

1. **Intent Routing com Payload Único**: por que unimos intenção + extração em 1 chamada
2. **Segurança contra Alucinações**: Zod, double-opt-in e hard-limits
3. **Fila Serial por ChatId**: concorrência sem Redis

---

## Licença

MIT
