# ADR-0004: Arquitetura de Contas, Entradas, Patrimônio e Rendimento CDI

**Status:** Aceito  
**Data:** 2026-09-16  
**Contexto:** Fase 11 — Entradas no sistema, saldos de benefícios (VR/VA), consolidação patrimonial e cálculo transparente de CDI

---

## Contexto

Originalmente, o MyFinances operava como um ledger estritamente focado em despesas (*expense-only*):
1. **Ausência de Entradas (Receitas):** Não havia mecanismo para registrar salários, recargas de benefícios ou freelancers.
2. **Saldos de Benefícios (VR/VA):** Embora cartões de benefício pudessem ser cadastrados, eles não possuíam saldo pré-pago recarregável.
3. **Visão de Patrimônio e Investimentos:** Não era possível visualizar onde o dinheiro estava alocado (contas correntes, caixinhas, renda variável) e nem acompanhar rendimentos com transparência.

## Decisões

1. **Ledger Unificado com Entidade `accounts`:**
   - Criada a tabela `accounts` para contas correntes (`checking`), benefícios pré-pagos (`benefit`), caixinhas de renda fixa (`fixed_income`) e corretoras (`investment_broker`).
   - `transactions` estendido com `entry_type` (`expense`, `income`, `yield`, `transfer`) e `account_id`.
   - Depósitos alimentam o saldo real da conta correspondente.

2. **Modelo Híbrido de Saldo Livre (Safe-to-Spend):**
   - Em vez de abater despesas de crédito imediatamente da conta corrente ou ignorar o comprometimento de renda, adotou-se o modelo paralelo:
     $$\text{Saldo Livre} = \text{Saldo Real da Conta Corrente} - \text{Faturas Abertas de Cartão de Crédito}$$
   - Isso garante que o usuário saiba exatamente quanto dinheiro tem no banco e quanto está realmente livre para gastar sem comprometer a fatura.

3. **Cálculo Transparente de Rendimentos (% CDI):**
   - Integração com a API do Banco Central (SGS Série 12) para buscar a taxa DI diária oficial.
   - Aplicação de dias úteis com taxa composta e alíquotas regressivas reais de IR (22,5% a 15%) e IOF (primeiros 29 dias).
   - Botão interativo para atualizar rendimentos e creditar o ganho líquido no saldo da caixinha gerando lançamentos transparentes (`entry_type: 'yield'`).

4. **Renda Variável por Ticker:**
   - Tabela `investment_assets` com tickers B3/Cripto, quantidade e preço médio.
   - Consulta de cotação atual a mercado via APIs públicas com cache em memória (15 min) e fallback seguro.

5. **Entradas Recorrentes Interativas:**
   - Lembrete com botões inline no Telegram no dia previsto para confirmação antes de efetuar o crédito no saldo.

## Consequências

**Positivas:**
- Eliminação completa do gap de receitas e saldos pré-pagos.
- Transparência total em investimentos de renda fixa e variável.
- Manutenção da integridade de todo o histórico anterior de despesas e compatibilidade retroativa com cartões existentes.

**Negativas / Cuidados:**
- Dependência de rede externa para APIs do Banco Central e cotações, tratada com mecanismos de timeout resiliente e fallbacks determinísticos.

## Referências

- `supabase/migrations/0011_accounts_incomes_investments.sql`
- `src/services/accounts/accountService.ts`
- `src/services/investments/yieldService.ts`
- `src/services/investments/assetPriceService.ts`
- `src/services/patrimony/patrimonyService.ts`
