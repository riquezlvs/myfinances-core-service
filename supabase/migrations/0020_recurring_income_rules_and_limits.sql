-- Migration 0020: Flexibilizar limites de dia e metodos de pagamento para receitas recorrentes
-- Permite dia do mes ate 31 (mesmo comportamento de faturas/salarios) e aceita meal_voucher (beneficios VR/VA)

ALTER TABLE recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_day_of_month_check;
ALTER TABLE recurring_transactions ADD CONSTRAINT recurring_transactions_day_of_month_check
  CHECK (day_of_month >= 1 AND day_of_month <= 31);

ALTER TABLE recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_payment_method_check;
ALTER TABLE recurring_transactions ADD CONSTRAINT recurring_transactions_payment_method_check
  CHECK (payment_method = ANY (ARRAY['pix'::text, 'credit_card'::text, 'debit_card'::text, 'meal_voucher'::text]));
