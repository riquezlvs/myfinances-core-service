-- ============================================================================
-- 0007_guards.sql
-- Fase 8 — Blindagem anti-alucinação (capa final de defesa no banco).
--
-- Mesmo que a validação Zod falhe por bug na aplicação, estas constraints
-- impedem que valores alucinados pela IA corrompam o ledger. O Postgres é
-- a última parede do "cofre".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Constraints de sanidade em public.transactions
-- ----------------------------------------------------------------------------

-- total_amount já exige > 0 (0001). Aqui adicionamos um TETO explícito,
-- consistente com MAX_TRANSACTION_AMOUNT da aplicação.
-- 8.7 — O CHECK original (> 0) é relaxado para >= 0: as linhas de dívida do
-- split múltiple têm total_amount = 0 (a parte da pessoa fica em
-- third_party_share_amount). A validação de valor positivo de gastos reais
-- continua sendo responsabilidade do guard de aplicação (Zod).
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_total_amount_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_total_amount_check CHECK (total_amount >= 0);

-- Teto explícito (independente do ajuste acima).
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_sane
  CHECK (total_amount <= 1000000);

-- A parte própria não pode ser negativa nem exceder o total.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_share_sane
  CHECK (
    my_share_amount IS NULL
    OR (my_share_amount >= 0 AND my_share_amount <= total_amount)
  );

-- A parte do terceiro nunca é negativa.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_share_3p_sane
  CHECK (third_party_share_amount >= 0);

-- Descrição não vazia e com tamanho razoável.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_description_sane
  CHECK (char_length(description) BETWEEN 1 AND 200);

-- ----------------------------------------------------------------------------
-- 2) Constraints de sanidade nas demais tabelas de negócio
-- ----------------------------------------------------------------------------

-- Parcelas: o número de parcela não pode exceder e o total não passa de 120.
-- 8.7 — Terceiro caso do CHECK: grupo de SPLIT (transação principal + linhas
-- de dívida da divisão) usa installment_group_id sem campos de parcela.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS installment_fields_consistent;

-- (recriado com o mesmo contrato: campos de parcela são todos NULL ou todos preenchidos)
ALTER TABLE public.transactions
  ADD CONSTRAINT installment_fields_consistent
  CHECK (
    (installment_group_id IS NULL AND installment_number IS NULL AND installment_total IS NULL)
    OR
    (installment_group_id IS NOT NULL AND installment_number IS NOT NULL AND installment_total IS NOT NULL
     AND installment_number BETWEEN 1 AND installment_total
     AND installment_total BETWEEN 2 AND 120)
    OR
    (installment_group_id IS NOT NULL AND installment_number IS NULL AND installment_total IS NULL)
  );

-- Recorrência: valores positivos com teto.
ALTER TABLE public.recurring_transactions
  ADD CONSTRAINT recurring_total_sane
  CHECK (total_amount BETWEEN 0.01 AND 1000000);

-- Budgets: limite mensal positivo com teto.
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_limit_sane
  CHECK (monthly_limit BETWEEN 0.01 AND 1000000);

-- ----------------------------------------------------------------------------
-- 3) ROW LEVEL SECURITY (defesa em profundidade)
--
-- O bot usa o service_role (que ignora RLS). Habilitamos RLS em todas as
-- tabelas de negócio e REVOGAMOS o acesso anônimo por padrão: sem policies,
-- qualquer request com anon key fica bloqueado. Se no futuro se expõe a
-- anon key (ex.: cliente web), o RLS bloqueia acesso indevido.
-- ----------------------------------------------------------------------------

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Não se definem policies: por padrão, RLS nega todo o acesso a roles não
-- superiores. O service_role do backend ignora o RLS e segue funcionando.
REVOKE ALL ON public.categories FROM anon;
REVOKE ALL ON public.people FROM anon;
REVOKE ALL ON public.transactions FROM anon;
REVOKE ALL ON public.debt_payments FROM anon;
REVOKE ALL ON public.recurring_transactions FROM anon;
REVOKE ALL ON public.budgets FROM anon;
REVOKE ALL ON public.cards FROM anon;