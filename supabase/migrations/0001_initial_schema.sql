-- ============================================================================
-- 0001_initial_schema.sql
-- Esquema inicial completo do MyFinances (Supabase / PostgreSQL)
--
-- Contém todas as tabelas base do domínio, as RPCs usadas pelo backend e um
-- seed mínimo de categorias. As migrations sequenciais (0003 em diante)
-- aplicam evoluções incrementais em cima deste schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: public.categories
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Tabela: public.people
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Tabela: public.transactions
-- Modelo central do ledger pessoal.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ID curto e sequencial exposto ao usuário (botões, /apagar <id>).
  display_id integer GENERATED ALWAYS AS IDENTITY,
  description text NOT NULL,
  total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
  category_id integer NOT NULL REFERENCES public.categories (id),
  payment_method text NOT NULL CHECK (payment_method IN ('pix', 'credit_card', 'debit_card')),
  -- Data/hora REAL do gasto (extraída pela IA). Distinta de created_at.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Cláusula de divisão de despesa.
  my_share_amount numeric(12,2),
  third_party_id uuid REFERENCES public.people (id),
  -- Quanto o terceiro ficou devendo (base para o módulo de dívidas).
  third_party_share_amount numeric(12,2) NOT NULL DEFAULT 0,
  -- Verdadeiro quando a linha foi materializada por uma recorrência mensal.
  is_recurring boolean NOT NULL DEFAULT false,
  -- Texto original do usuário (para auditoria/debug).
  raw_input text,
  -- Colunas de compra parcelada (1 linha por parcela, agrupadas).
  installment_group_id uuid,
  installment_number smallint,
  installment_total smallint,
  -- Coluna legada do monólito original (usada no backfill do 0003).
  transaction_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_display_id_key
  ON public.transactions (display_id);

CREATE INDEX IF NOT EXISTS transactions_occurred_at_idx
  ON public.transactions (occurred_at);

CREATE INDEX IF NOT EXISTS transactions_third_party_idx
  ON public.transactions (third_party_id)
  WHERE third_party_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Tabela: public.debt_payments
-- Ledger de pagamentos recebidos (abate o saldo devido de cada pessoa).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people (id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debt_payments_person_idx
  ON public.debt_payments (person_id);

-- ----------------------------------------------------------------------------
-- Tabela: public.recurring_transactions
-- Templates de gastos fixos mensais (assinaturas, aluguel etc).
-- Materializados em transactions com is_recurring = true.
-- ----------------------------------------------------------------------------
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
  last_generated_month date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- RPCs usadas pelo backend (src/services/people/peopleService.ts)
-- ----------------------------------------------------------------------------

-- Busca o UUID de uma pessoa pelo nome (case-insensitive). Retorna NULL
-- se não existir.
CREATE OR REPLACE FUNCTION public.find_person(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM public.people
  WHERE LOWER(name) = LOWER(p_name)
  LIMIT 1;
$$;

-- Busca uma pessoa pelo nome; se não existir, cria e retorna o UUID.
CREATE OR REPLACE FUNCTION public.get_or_create_person(p_name text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.people
  WHERE LOWER(name) = LOWER(p_name)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.people (name)
    VALUES (p_name)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Seed mínimo de categorias padrão (pt-BR).
-- Necessário para o cache de categorias e para o schema dinâmico do Gemini.
-- ----------------------------------------------------------------------------
INSERT INTO public.categories (name)
VALUES
  ('Alimentação'),
  ('Transporte'),
  ('Moradia'),
  ('Lazer'),
  ('Saúde'),
  ('Educação'),
  ('Compras'),
  ('Assinaturas'),
  ('Outros')
ON CONFLICT (name) DO NOTHING;