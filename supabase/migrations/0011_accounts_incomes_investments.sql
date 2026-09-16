-- ============================================================================
-- 0011_accounts_incomes_investments.sql
-- Fase 11: Contas, Entradas (Incomes), Patrimônio e Investimentos (CDI / Renda Variável)
--
-- Transforma o MyFinances em um ledger financeiro completo:
-- 1. Tabela accounts: contas correntes, carteiras de benefícios (VR/VA),
--    caixinhas (% CDI) e carteiras de investimento.
-- 2. Suporte a receitas (income), transferências e rendimentos no ledger.
-- 3. Tabela investment_assets: ações, FIIs, ETFs e cripto por ticker.
-- 4. Extensão de recurring_transactions para entradas programadas com confirmação interativa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('checking', 'benefit', 'fixed_income', 'investment_broker')),
  balance numeric(12,2) NOT NULL DEFAULT 0,
  cdi_rate numeric(6,2),
  start_date date DEFAULT CURRENT_DATE,
  card_id uuid REFERENCES public.cards (id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounts_type_idx ON public.accounts (type);

-- ----------------------------------------------------------------------------
-- 2. Tabela: public.investment_assets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
  ticker text NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('stock', 'fii', 'etf', 'crypto', 'other')),
  quantity numeric(14,6) NOT NULL CHECK (quantity > 0),
  average_price numeric(12,4) NOT NULL CHECK (average_price > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_assets_account_ticker_key UNIQUE (account_id, ticker)
);

CREATE INDEX IF NOT EXISTS investment_assets_account_idx ON public.investment_assets (account_id);

-- ----------------------------------------------------------------------------
-- 3. Extensões na tabela public.transactions
-- ----------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid REFERENCES public.accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gross_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2);

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_entry_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_entry_type_check
  CHECK (entry_type IN ('expense', 'income', 'yield', 'transfer'));

CREATE INDEX IF NOT EXISTS transactions_entry_type_idx ON public.transactions (entry_type);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON public.transactions (account_id);

-- ----------------------------------------------------------------------------
-- 4. Extensões na tabela public.recurring_transactions
-- ----------------------------------------------------------------------------
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reminder_only boolean NOT NULL DEFAULT true;

ALTER TABLE public.recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_entry_type_check;
ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_transactions_entry_type_check
  CHECK (entry_type IN ('expense', 'income'));

-- ----------------------------------------------------------------------------
-- 5. Seed inicial de contas padrão (retrocompatibilidade)
-- ----------------------------------------------------------------------------
INSERT INTO public.accounts (name, type, balance)
VALUES ('Conta Principal', 'checking', 0)
ON CONFLICT (name) DO NOTHING;

-- Cria contas de benefício para cartões de VR/VA já cadastrados
INSERT INTO public.accounts (name, type, balance, card_id)
SELECT c.name, 'benefit', 0, c.id
FROM public.cards c
WHERE c.card_type IN ('meal_voucher', 'food_voucher')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. RLS e Permissões
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'accounts' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.accounts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investment_assets' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.investment_assets
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

REVOKE ALL ON public.accounts FROM anon, authenticated;
GRANT ALL ON public.accounts TO service_role;

REVOKE ALL ON public.investment_assets FROM anon, authenticated;
GRANT ALL ON public.investment_assets TO service_role;
