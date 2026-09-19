-- ============================================================================
-- 0009_savings_goals.sql
-- Fase 8.7 — Metas de poupança de longo prazo.
--
-- Cada linha é um objetivo (ex: "viagem até dezembro") com valor-alvo,
-- valor já poupado e prazo opcional. O cálculo do aporte mensal sugerido
-- (restante / meses restantes) é feito pela aplicação (savingsService).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0 AND target_amount <= 1000000),
  saved_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  deadline_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defesa em profundidade (mesma política das demais tabelas — migration 0007):
-- RLS habilitado sem policies + acesso anônimo revogado. O backend usa o
-- service_role, que ignora o RLS.
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.savings_goals FROM anon;