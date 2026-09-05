-- ============================================================================
-- 0006_budgets_and_cards.sql
-- Fase 6: orçamento mensal por categoria + multi-cartão com fechamento.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: public.budgets
-- Meta (limite) mensal de gasto por categoria. Uma meta por categoria.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id integer NOT NULL UNIQUE REFERENCES public.categories (id),
  monthly_limit numeric(12,2) NOT NULL CHECK (monthly_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.budgets IS
  'Limite mensal de gasto por categoria. O bot alerta ao atingir 80% e 100%.';

-- ----------------------------------------------------------------------------
-- Tabela: public.cards
-- Cartões de crédito com dia de fechamento personalizado (1–28).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  closing_day smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 28),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.cards.closing_day IS
  'Dia do mês em que a fatura fecha. O período da fatura vai do dia seguinte ao fechamento anterior até o dia de fechamento atual.';

-- ----------------------------------------------------------------------------
-- transactions.card_id: associa o gasto a um cartão específico (opcional).
-- Gastos com credit_card e card_id NULL pertencem ao cartão padrão (primeiro).
-- ----------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES public.cards (id);

CREATE INDEX IF NOT EXISTS transactions_card_idx
  ON public.transactions (card_id)
  WHERE card_id IS NOT NULL;