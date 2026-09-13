-- ============================================================================
-- 0008_card_types_benefits.sql
-- 8.2: tipos de cartão (crédito / vale-refeição / vale-alimentação),
-- cartão PRINCIPAL por tipo e métodos de pagamento de benefício.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cards.card_type + cards.is_default
-- ----------------------------------------------------------------------------
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'credit',
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_card_type_check;
ALTER TABLE public.cards ADD CONSTRAINT cards_card_type_check
  CHECK (card_type IN ('credit', 'meal_voucher', 'food_voucher'));

-- Um único cartão principal (is_default) por tipo — a inferência (8.2)
-- consulta SEMPRE o principal; o índice único parcial garante a invariante.
CREATE UNIQUE INDEX IF NOT EXISTS cards_single_default_per_type
  ON public.cards (card_type) WHERE is_default;

CREATE INDEX IF NOT EXISTS cards_type_idx ON public.cards (card_type);

-- ----------------------------------------------------------------------------
-- transactions.payment_method: novos métodos de benefício.
-- Gasto no vale NÃO entra na fatura do cartão de crédito (filtros por
-- payment_method já isolam os grupos naturalmente).
-- ----------------------------------------------------------------------------
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN ('pix', 'credit_card', 'debit_card', 'meal_voucher', 'food_voucher'));

COMMENT ON COLUMN public.cards.card_type IS
  'Tipo: credit, meal_voucher (vale-refeição) ou food_voucher (vale-alimentação).';
COMMENT ON COLUMN public.cards.is_default IS
  'Cartão principal do seu tipo — usado pela inferência de método de pagamento (8.2).';