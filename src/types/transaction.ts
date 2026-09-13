export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'meal_voucher' | 'food_voucher';

/**
 * 8.2 — Tipo do cartão cadastrado. Crédito fecha fatura; vales (refeição/
 * alimentação) são saldo pré-pago por categoria de uso.
 */
export type CardType = 'credit' | 'meal_voucher' | 'food_voucher';

/**
 * Intenções reconhecidas pelo bot.
 *
 * SEGURANÇA (Fase 8): NÃO existem intenções destrutivas neste enum. O LLM
 * NUNCA pode executar "apagar/remover"; quando o usuário as pedir, o router
 * responde com CONFIRMACAO_REQUERIDA e a ação acontece só via botão
 * inline do Telegram (fora da cadeia do LLM).
 */
export type Intent =
  | 'NOVO_GASTO'
  | 'PAGAMENTO_DIVIDA'
  | 'CONSULTA'
  | 'EXPORTAR'
  | 'META'
  | 'CARTAO'
  | 'RECORRENTE'
  | 'GRAFICO'
  | 'INSIGHT'
  | 'POUPANCA'
  | 'CONFIRMACAO_REQUERIDA'
  | 'OUTROS';

/** Entidade consultada em CONSULTA (todas leem dados, nunca mutam). */
export type EntidadeConsulta = 'resumo' | 'fatura' | 'dividas' | 'gastos';

/**
 * 8.4 — Natureza do lançamento consultado. Hoje o ledger é expense-only
 * ("gasto"); o enum existe para o usuário poder dizer "o que gastei" sem
 * que a IA invente outro tipo — qualquer valor fora daqui é descartado.
 */
export type TipoConsulta = 'gasto';

export interface IntentParams {
  /** CONSULTA: que tipo de informação quer o usuário. */
  entidade?: EntidadeConsulta;
  /** Mês no formato 'YYYY-MM' (consultas e exportações). */
  month?: string;
  /** CONSULTA/gastos: quantidade de lançamentos (default 5). */
  limite?: number;
  /**
   * 8.4 — CONSULTA granular: nome da categoria citada na pergunta
   * ("quanto gastei com transporte?"). Resolvido contra o catálogo do
   * Supabase em CÓDIGO — a IA nunca escolhe o category_id da consulta.
   */
  category?: string;
  /** 8.4 — CONSULTA granular: natureza do lançamento (hoje só 'gasto'). */
  type?: TipoConsulta;
  /** EXPORTAR: 'gastos' (default) ou 'dividas'. */
  tipoExport?: 'gastos' | 'dividas';
  /** META: 'listar' (default) | 'definir' | 'remover'. */
  accionMeta?: 'listar' | 'definir' | 'remover';
  /** META: nome da categoria (validado contra o catálogo antes de usar). */
  categoriaMeta?: string;
  /** META: limite mensal em reais. */
  limiteMeta?: number;
  /** CARTAO: 'listar' (default) | 'add' | 'remover' | 'fatura' | 'principal'. */
  accionCartao?: 'listar' | 'add' | 'remover' | 'fatura' | 'principal';
  /** CARTAO: nome do cartão. */
  nomeCartao?: string;
  /** CARTAO add: dia de fechamento (1-28). */
  closingDay?: number;
  /** RECORRENTE: 'listar' (default) | 'add' | 'remover'. */
  accionRecorrente?: 'listar' | 'add' | 'remover';
  /** 8.7 — POUPANCA: 'listar' (default) | 'definir' | 'adicionar'. */
  accionPoupanca?: 'listar' | 'definir' | 'adicionar';
  /** 8.7 — POUPANCA: nome da meta (ex: "viagem"). */
  nomePoupanca?: string;
  /** 8.7 — POUPANCA: alvo da meta ou valor do aporte, em reais. */
  valorPoupanca?: number;
  /** 8.7 — POUPANCA: prazo da meta no formato YYYY-MM. */
  prazoPoupanca?: string;
  /** CONFIRMACAO_REQUERIDA: descrição humana do que o usuário pediu. */
  pedidoDescricao?: string;
}

export interface ParsedTransaction {
  description: string;
  total_amount: number;
  category_id: number;
  /**
   * 8.2: a IA pode omitir (null) quando o usuário não cita a forma de
   * pagamento — nesse caso a inferência determinística escolhe (vale/crédito).
   */
  payment_method: PaymentMethod | null;
  occurred_at: string;
  my_share_amount?: number | null;
  third_party_name?: string | null;
  /**
   * 8.7 — Split múltiple: TODAS as pessoas citadas quando a despesa é
   * dividida entre várias (ex: "dividido em 3 com Maria e João"). O serviço
   * calcula a parte de cada uma e cria as linhas de dívida no ledger.
   */
  third_party_names?: string[];
  installment_total?: number | null;
  /**
   * 8.2 — NUNCA vem da IA (o guard descarta/audita a chave). Preenchido
   * apenas pela inferência determinística em código (paymentInference.ts).
   */
  card_id?: string | null;
}

/**
 * Payload único que o Gemini retorna para TODA mensagem (1 chamada):
 * intent + params + transaction já extraída. substitui a concatenação
 * classificarIntencao() + interpretarGasto() (antes: 2 chamadas).
 */
export interface IntentPayload {
  intent: Intent;
  params: IntentParams;
  transaction: ParsedTransaction | null;
  /** Avisos do guard (ex.: data clampeada) para mostrar na confirmação. */
  avisos: string[];
}

export interface SaldoTerceiro {
  nome: string;
  valor: number;
}

export type ResultadoPagamento =
  | { status: 'pessoa_nao_encontrada'; nome: string }
  | { status: 'sem_divida'; nome: string }
  | { status: 'quitado'; nome: string; valorPago: number; avisoValorAjustado?: string }
  | { status: 'parcial'; nome: string; valorPago: number; saldoRestante: number; avisoValorAjustado?: string };