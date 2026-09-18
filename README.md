# MyFinances Core Service — Guará IA 🦅

**Guará IA** é o nome do assistente no Telegram: um bot inteligente de finanças pessoais, com processamento de linguagem natural via Gemini 3.5-flash, persistência no Supabase (PostgreSQL) e proteções robustas contra alucinações de IA.

---

## Visão Geral

O MyFinances permite registrar gastos, consultar resumos, dividir contas, criar metas de poupança e receber insights preditivos — tudo em linguagem natural, sem precisar decorar comandos.

**Exemplo de uso:**
```
"Gastei 45 reais no almoço"           → registra gasto automaticamente
"Caiu 800 de VR hoje"                 → registra entrada e credita saldo pré-pago
"Recebi 5000 de salário no Nubank"    → registra receita e atualiza saldo bancário
"Qual meu patrimônio total?"          → visão consolidada de contas, caixinhas e ações
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
| Dados de Mercado | API do Banco Central do Brasil (SGS CDI diário) & Brapi/Yahoo Finance |
| Validação | Zod (runtime type checking) |
| Testes | Vitest |

---

## Funcionalidades

### Principais
- **Central de Ajuda Interativa & Onboarding**: `/ajuda` navegável por tópicos com inline buttons, onboarding `/start` enxuto e fallbacks de erro inteligentes com análise contextual.
- **Registro de Entradas & Saldos**: Salários, recargas de benefícios (VR/VA), freelas e PIX recebidos alimentam o saldo real da conta indicada.
- **Patrimônio Consolidado com Alocação & Barras Gráficas**: Visão em blocos (Ativos vs Passivos = Patrimônio Líquido), % de distribuição por classe com barras unicode, e destaque de Liquidez Imediata Livre.
- **Modelo Híbrido Safe-to-Spend**: Saldo Real em conta vs Saldo Livre para gastar (descontando faturas de cartão de crédito em aberto).
- **Caixinhas com Rendimento Automático (% CDI)**: Integração com API oficial do Banco Central (SGS Série 12), projeção de dias úteis e alíquotas regressivas de IR (22,5% a 15%) e IOF.
- **Renda Variável a Mercado**: Ações, FIIs e Criptos por ticker com cotação pública em tempo real e rentabilidade sobre o preço médio.
- **Registro de Gastos por Linguagem Natural**: "Gastei 30 no mercado" → transação categorizada e validada.
- **Consultas Granulares**: "Quanto gastei com lazer em agosto?" → resposta determinística.
- **Exportação CSV**: `/exportar` ou "manda a planilha de setembro".
- **Metas de Orçamento**: alertas automáticos em 80% (🟡) e 100% (🔴).
- **Insights Preditivos**: análise IA com projeção de fechamento do mês.

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

## 📖 Guia Rápido: Como Usar o Sistema

> 💡 **Quer aprender todos os detalhes e cenários práticos?** Confira o **[Guia Completo de Uso](docs/GUIA_DE_USO.md)**.

### 1️⃣ Calibre seus Saldos Iniciais
Defina quanto dinheiro você tem em cada conta ou benefício para o bot saber de onde tirar ou creditar:
- `/ajustar_saldo Nubank 2500` → define o saldo bancário da conta corrente
- `/ajustar_saldo VR 800` → define o saldo do seu vale refeição/alimentação
- *Ou fale normalmente:* `"Meu saldo no Nubank é 2500"` ou `"Tenho 800 no VR"`

### 2️⃣ Registre Entradas de Dinheiro
Sempre que pingar salário, freelance ou recarga:
- `"Caiu meu salário de 5000 no Nubank"`
- `"Recarga do VR de 800"`
- `"Recebi 1200 de freela no Inter"`
O bot credita na conta certa e atualiza seu saldo e patrimônio líquido!

### 3️⃣ Registre Gastos no Dia a Dia
O bot identifica automaticamente a categoria e o meio de pagamento:
- `"Almoço 42 no VR"` → debita do saldo pré-pago do seu benefício (sem mexer no banco)
- `"Mercado 150 no débito"` → debita do saldo da conta corrente
- `"Tênis 350 em 3x no cartão Nubank"` → entra na fatura de crédito futura
- `"Jantar 120 dividido com João e Maria"` → divide a despesa e anota quem te deve

### 4️⃣ Acompanhe seu Dinheiro & Investimentos
- `/patrimonio`: Visão 360° do patrimônio líquido consolidado: contas bancárias + saldo VR + caixinhas com rendimento + ações − faturas abertas a pagar.
- `/saldo`: **Safe-to-Spend** — mostra seu saldo real em conta vs quanto você realmente pode gastar sem comprometer a fatura do cartão que vai vencer.
- `/investimentos`: Detalha suas Caixinhas de renda fixa (rendimento automático em % CDI pelo Banco Central com desconto de IR) e ações a mercado.

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
| `/start` | Onboarding pedagógico e botões de início rápido |
| `/ajuda` ou `/tutorial` | Central interativa de tutoriais navegável por tópicos |
| `/comandos` | Índice completo e categorizado de comandos |
| `/patrimonio` | Visão estruturada (Ativos vs Passivos = Líquido, % de alocação e Safe-to-Spend) |
| `/saldo` | Saldo real vs Saldo livre (Safe-to-Spend) |
| `/investimentos` | Caixinhas (% CDI) e Renda Variável |
| `/ajustar_saldo <conta> <valor>` | Conciliar saldo de conta ou VR |
| `/resumo` | Resumo do mês atual |
| `/fatura` | Fatura do cartão de crédito |
| `/dividas` | Quem te deve |
| `/gastos [n]` | Últimos gastos registrados |
| `/pago <nome> [valor]` | Registrar pagamento recebido |
| `/desfazer` | Desfazer último gasto |
| `/apagar <id>` | Apagar lançamento específico |
| `/recorrente` | Despesas fixas mensais |
| `/exportar [gastos\|dividas] [mês]` | Exportar CSV |
| `/grafico` | Gráfico de gastos |
| `/insight` | Análise IA do mês |
| `/meta <categoria> <limite>` | Metas de orçamento |
| `/cartao` | Lista os comandos + cartões/vales (ajuda clara) |
| `/cartao listar` | Apenas a lista, sem repetir a ajuda |
| `/cartao add <nome> [dia] [credito\|vr\|va]` | Adicionar cartão/vale (dia=1 e tipo=credito por padrão) |
| `/cartao add Santander 30` | Nome + dia (tipo=credit por padrão) |
| `/cartao add Santander vr` | Nome + tipo (dia=1 por padrão) |
| `/cartao principal <nome>` | Definir como principal |
| `/cartao fatura <nome>` | Ver fatura do período |
| `/cartao remover <nome>` | Remover cartão/vale |
| `/poupanca` | Metas de poupança |
| `/poupanca definir <nome> <valor> [mês]` | Criar meta de poupança |
| `/poupanca add <nome> <valor>` | Adicionar aporte |
| `/viagem` | Ver cotações (USD/EUR) |
| `/viagem registrar <valor> <moeda>` | Converter para BRL |
| `/status` | Status do serviço |

### Tipos de cartão

| Atalho | Tipo |
|---|---|
| `credit` ou `credito` | Cartão de crédito (fatura) |
| `vr` ou `refeicao` | Vale-refeição |
| `va` ou `alimentacao` | Vale-alimentação |

> Dia de fechamento: número de 1 a 28 (`30` é normalizado para `28`).
> Sem cartão cadastrado, `/cartao` mostra primeiro a ajuda com todos os
> sub-comandos e depois a orientação de cadastro com exemplos.

**Exemplo:**
```bash
/cartao                      # ajuda + lista (vazia: "Nenhum cartão ou vale cadastrado ainda")
/cartao listar               # só a lista
/cartao add Santander        # nome, dia=1, tipo=credit
/cartao add Santander 30     # nome, dia=28 (clamp), tipo=credit
/cartao add Santander vr     # nome, dia=1, tipo=meal_voucher
/cartao add Santander 1 credito
/cartao add Ticket 15 vr
```

---

## Estrutura do Projeto

```
src/
├── bot/                  # Handlers e comandos do Telegram
│   ├── commands/         # Comandos individuais (/patrimonio, /saldo, /resumo, etc.)
│   ├── handlers/         # messageHandler, voiceHandler, callbackQueryHandler
│   ├── keyboards/        # Teclados inline dinâmicos
│   └── index.ts          # Setup do bot
├── clients/              # Clientes (Supabase, Gemini, Telegram)
├── config/               # Constantes e variáveis de ambiente
├── services/
│   ├── accounts/         # Gestão de contas, saldos e Safe-to-Spend
│   ├── categories/       # Cache de categorias
│   ├── debts/            # Split e pagamentos
│   ├── exchange/         # Taxas de câmbio
│   ├── gemini/           # Integração com Gemini (guards, prompts, parsers)
│   ├── investments/      # Rendimento CDI (Bacen) e Renda Variável (Brapi/Yahoo)
│   ├── patrimony/        # Consolidador de patrimônio líquido
│   ├── people/           # Resolução de pessoas
│   ├── savings/          # Metas de poupança
│   └── transactions/     # CRUD de transações e entradas
├── types/                # Tipos TypeScript
└── utils/                # Utilitários (concurrency, rateLimit, formatters, etc.)
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
| `BOT_NAME` | Nome exibido do bot (padrão: `Guará IA`) |
| `BOT_PROFILE_PHOTO_PATH` | Caminho local (`./assets/bot-avatar.jpg`) ou URL da foto de perfil |

---

## Identidade do Bot (Guará IA) 🦅

Na inicialização (`iniciarBot()` → `configureBot()`), o serviço sincroniza a
identidade do bot no Telegram:

1. **Nome** — `setMyName({ name: BOT_NAME })` (padrão: `Guará IA`);
2. **Descrição curta** — o que o bot faz (via `setMyShortDescription`);
3. **Descrição longa** — bio com exemplos de uso (via `setMyDescription`);
4. **Foto de perfil** — `BOT_PROFILE_PHOTO_PATH` pode ser caminho local ou URL.
   O caminho é resolvido a partir da **raiz do projeto** (ex:
   `BOT_PROFILE_PHOTO_PATH=./assets/bot-avatar.jpg` resolve para
   `<repo>/assets/bot-avatar.jpg`), e imagens acima de 512KB são recusadas
   antes do upload. A biblioteca `node-telegram-bot-api@0.66` ainda não expõe
   `setMyProfilePhoto`, então o upload usa `fetch` direto na API do Telegram.

> ⚠️ A Bot API impõe texto puro + limites: `short_description` 0–120 e
> `description` 0–512 caracteres (Markdown, emoji e quebras de linha causam
> `400 BOT_SHARETEXT_INVALID` / `BOT_DESC_INVALID`). O código sanitiza e
> trunca localmente (`sanitizarTextoIdentidade` + `truncarNoLimite`) antes de
> enviar, em vez de deixar a API rejeitar.

Arquivos:

| Arquivo | Papel |
|---|---|
| `src/bot/setupBot.ts` | `configureBot(bot)` — aplica nome/descrições/foto |
| `scripts/configure-bot.ts` | Script standalone: `npm run setup-bot` |
| `assets/README.md` | Onde colocar a imagem real do projeto (`assets/bot-avatar.jpg`) |

> 📸 Foto real: salve a imagem em `assets/bot-avatar.jpg`,
> defina `BOT_PROFILE_PHOTO_PATH=./assets/bot-avatar.jpg` no `.env` e rode
> `npm run setup-bot` (ou apenas suba o serviço — a configuração também roda
> no boot via `iniciarBot()`).
>
> ⚠️ 429 `Too Many Requests` (ex: `retry after 85994`) após várias tentativas
> é rate-limit da Bot API no `setMy*`, não erro de código — aguarde o tempo
> indicado e rode `npm run setup-bot` de novo (cada etapa tem try/catch
> próprio, então o que já sincronizou não precisa repetir).
>
> ⚠️ Limitação conhecida da Bot API: o username (@...) e a foto do cabeçalho
> do chat só podem ser trocados manualmente no **@BotFather**. O que dá para
> sincronizar via código (`setMyName`, `setMyShortDescription`,
> `setMyDescription`, `setMyProfilePhoto`) já está coberto por `configureBot`.
> Testes: `tests/unit/commands/setupBot.test.ts` (identidade, tolerância a
> falhas, `montarFotoPerfil`) e `tests/unit/commands/cartao.test.ts`
> (`parseArgumentosAdd` + ajuda do `/cartao`).

---

## Arquitetura

Para decisões arquiteturais detalhadas, consulte [`docs/adrs/`](docs/adrs/):

1. **Intent Routing com Payload Único**: por que unimos intenção + extração em 1 chamada
2. **Segurança contra Alucinações**: Zod, double-opt-in e hard-limits
3. **Fila Serial por ChatId**: concorrência sem Redis
4. **Contas, Patrimônio e Rendimento CDI**: Ledger unificado com receitas, Safe-to-Spend híbrido e rendimentos CDI automáticos via Bacen

---

## Licença

MIT
