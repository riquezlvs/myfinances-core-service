-- ============================================================================
-- Migration: 0009_cards_enhancements.sql
-- Objetivo: Suportar limite, dia de vencimento, nome do titular impresso,
--           finais do cartão (4 dígitos), tema visual e modalidade física/virtual.
-- ============================================================================

-- 1. Adiciona novas colunas na tabela public.cards
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_day smallint CHECK (due_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS card_holder text,
  ADD COLUMN IF NOT EXISTS last_four_digits varchar(4),
  ADD COLUMN IF NOT EXISTS color_theme text NOT NULL DEFAULT 'titanium',
  ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false;

-- 2. Documentação das colunas
COMMENT ON COLUMN public.cards.credit_limit IS 'Limite de crédito total disponível no cartão';
COMMENT ON COLUMN public.cards.due_day IS 'Dia de vencimento da fatura (1 a 31)';
COMMENT ON COLUMN public.cards.card_holder IS 'Nome do titular impresso no cartão';
COMMENT ON COLUMN public.cards.last_four_digits IS 'Últimos 4 dígitos do cartão para identificação visual';
COMMENT ON COLUMN public.cards.color_theme IS 'Identificador do tema visual do cartão (ex: titanium, slate, warm, light)';
COMMENT ON COLUMN public.cards.is_virtual IS 'Indica se o cartão é virtual ou físico';

-- 3. Recarrega o cache do PostgREST para reconhecer as novas colunas imediatamente
NOTIFY pgrst, 'reload schema';
