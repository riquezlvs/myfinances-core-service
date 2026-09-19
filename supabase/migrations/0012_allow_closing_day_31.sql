-- ============================================================================
-- 0012_allow_closing_day_31.sql
-- Permite que o dia de fechamento do cartão (closing_day) vá de 1 a 31.
-- O cálculo de período no backend faz o clamping dinâmico para o último
-- dia de cada mês (ex: 28/29 em fev, 30 em abr/jun/set/nov, 31 nos demais).
-- ============================================================================

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_closing_day_check;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_closing_day_check
  CHECK (closing_day BETWEEN 1 AND 31);

COMMENT ON COLUMN public.cards.closing_day IS
  'Dia do mês em que a fatura fecha (1 a 31). Em meses mais curtos, fecha dinamicamente no último dia do mês.';
