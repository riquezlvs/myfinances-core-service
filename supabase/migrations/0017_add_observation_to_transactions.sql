-- ============================================================================
-- 0017_add_observation_to_transactions.sql
-- Adiciona a coluna observation para anotações livres e notas em lançamentos
-- ============================================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS observation text;

COMMENT ON COLUMN public.transactions.observation IS 'Anotações e notas descritivas do lançamento feitas pelo usuário';
