-- Adiciona timestamp real do evento (permite lançamentos retroativos)
-- e um identificador curto e sequencial para uso em botões/comandos
-- (evita expor UUID em /apagar <id>).

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS display_id integer GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_display_id_key
  ON public.transactions (display_id);

-- Backfill: transaction_date (date) -> occurred_at (timestamptz), meio-dia UTC
-- como aproximação para registros antigos sem hora.
UPDATE public.transactions
SET occurred_at = (transaction_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC'
WHERE occurred_at IS NULL OR occurred_at = created_at;

COMMENT ON COLUMN public.transactions.occurred_at IS
  'Data/hora real do gasto, extraída pela IA (ex: "ontem ao meio-dia"). Distinta de created_at (quando a linha foi inserida).';
COMMENT ON COLUMN public.transactions.display_id IS
  'Identificador curto e sequencial exposto ao usuário (botões, /apagar <id>). Nunca usar o UUID interno na UI.';