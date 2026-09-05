-- Suporte a compras parceladas: cada parcela é uma linha própria,
-- agrupada por installment_group_id, com número da parcela e total.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS installment_group_id uuid,
  ADD COLUMN IF NOT EXISTS installment_number smallint,
  ADD COLUMN IF NOT EXISTS installment_total smallint;

CREATE INDEX IF NOT EXISTS transactions_installment_group_idx
  ON public.transactions (installment_group_id)
  WHERE installment_group_id IS NOT NULL;

ALTER TABLE public.transactions
  ADD CONSTRAINT installment_fields_consistent
  CHECK (
    (installment_group_id IS NULL AND installment_number IS NULL AND installment_total IS NULL)
    OR
    (installment_group_id IS NOT NULL AND installment_number IS NOT NULL AND installment_total IS NOT NULL
     AND installment_number BETWEEN 1 AND installment_total)
  );

COMMENT ON COLUMN public.transactions.installment_group_id IS
  'Agrupa as N linhas geradas por uma compra parcelada (ex: "Tênis (1/3)", "Tênis (2/3)"...).';