-- ============================================================================
-- 0017_invoice_payments_billing_cycle.sql
-- Adiciona ciclo de referência (billing_cycle) para pagamentos de fatura
-- ============================================================================

ALTER TABLE public.invoice_payments 
ADD COLUMN IF NOT EXISTS billing_cycle text;

CREATE INDEX IF NOT EXISTS invoice_payments_billing_cycle_idx 
ON public.invoice_payments (card_id, billing_cycle);
