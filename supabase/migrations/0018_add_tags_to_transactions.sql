-- ============================================================================
-- 0018_add_tags_to_transactions.sql
-- Adiciona a coluna tags para marcadores e etiquetas atribuídas aos lançamentos
-- ============================================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tags text[];

COMMENT ON COLUMN public.transactions.tags IS 'Tags e marcadores personalizados atribuídos ao lançamento';
