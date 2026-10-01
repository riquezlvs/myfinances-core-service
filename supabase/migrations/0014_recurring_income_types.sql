-- ============================================================================
-- 0014_recurring_income_types.sql
-- Fase 14: Tipos semânticos de renda recorrente + regra de fim de semana
--
-- Adiciona income_type e weekend_rule em recurring_transactions para
-- suportar classificação (salário, freelance, benefício, outro) e
-- comportamento em fins de semana/feriados na projeção de fatura.
-- ============================================================================

-- Tipo semântico de receita
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS income_type text
    CHECK (income_type IN ('salary', 'freelance', 'benefit', 'other'));

-- Regra de deslocamento quando o dia cai em fim de semana/feriado
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS weekend_rule text NOT NULL DEFAULT 'postpone'
    CHECK (weekend_rule IN ('anticipate', 'postpone', 'exact'));
