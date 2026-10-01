-- ============================================================================
-- 0015_allow_null_category_for_incomes.sql
-- Fase 15: Tornar category_id opcional para transações e recorrências de renda
--
-- Permite que receitas recorrentes e transações de entrada funcionem
-- sem obrigatoriedade de category_id e garante a categoria 'Receitas'.
-- ============================================================================

-- Torna category_id opcional na tabela de templates de recorrência
ALTER TABLE public.recurring_transactions
  ALTER COLUMN category_id DROP NOT NULL;

-- Torna category_id opcional na tabela de transações
ALTER TABLE public.transactions
  ALTER COLUMN category_id DROP NOT NULL;

-- Garante existência da categoria padrão de Receitas
INSERT INTO public.categories (name)
VALUES ('Receitas')
ON CONFLICT (name) DO NOTHING;
