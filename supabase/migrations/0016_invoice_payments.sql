-- ============================================================================
-- 0016_invoice_payments.sql
-- Pagamento de faturas de cartão com débito em saldo de conta (bolsos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.cards (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  payment_method text NOT NULL DEFAULT 'account_balance',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_payments_card_idx ON public.invoice_payments (card_id);
CREATE INDEX IF NOT EXISTS invoice_payments_account_idx ON public.invoice_payments (account_id);
CREATE INDEX IF NOT EXISTS invoice_payments_paid_at_idx ON public.invoice_payments (paid_at);

-- RLS
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoice_payments' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.invoice_payments
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

REVOKE ALL ON public.invoice_payments FROM anon, authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
