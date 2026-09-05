-- Modelo de "template" para despesas fixas mensais. Um job/trigger
-- externo (fora do escopo desta migration) materializa isso em
-- public.transactions todo mês.

CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
  category_id integer NOT NULL REFERENCES public.categories (id),
  payment_method text NOT NULL CHECK (payment_method IN ('pix', 'credit_card', 'debit_card')),
  my_share_amount numeric(12,2),
  third_party_id uuid REFERENCES public.people (id),
  day_of_month smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  is_active boolean NOT NULL DEFAULT true,
  last_generated_month date,           -- controla idempotência da geração mensal
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recurring_transactions IS
  'Templates de gastos fixos mensais (assinaturas, aluguel etc). Materializados em transactions com is_recurring = true.';
COMMENT ON COLUMN public.recurring_transactions.day_of_month IS
  'Limitado a 28 para evitar problemas em meses curtos (fevereiro).';
COMMENT ON COLUMN public.recurring_transactions.last_generated_month IS
  'Último mês (primeiro dia) em que essa recorrência já gerou uma transação — evita duplicidade se o job rodar mais de uma vez.';