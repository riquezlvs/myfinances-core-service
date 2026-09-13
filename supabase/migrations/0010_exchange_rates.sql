-- ============================================================================
-- 0010_exchange_rates.sql
-- Fase 9 — Cache de taxas de câmbio (modo viagem).
--
-- Tabela simples para cache diário de cotações USD/EUR vs BRL. O cache
-- primário é em memória (exchangeService.ts); esta tabela serve como
-- backup/persistência entre reinicializações do serviço.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency char(3) NOT NULL CHECK (currency IN ('USD', 'EUR')),
  rate numeric(12,6) NOT NULL CHECK (rate > 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  fetched_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exchange_rates_currency_date_key UNIQUE (currency, date)
);

CREATE INDEX IF NOT EXISTS exchange_rates_currency_date_idx
  ON public.exchange_rates (currency, date);

-- RLS: service_role gerencia; anon não tem acesso direto.
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exchange_rates' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.exchange_rates
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

REVOKE ALL ON public.exchange_rates FROM anon, authenticated;
GRANT ALL ON public.exchange_rates TO service_role;