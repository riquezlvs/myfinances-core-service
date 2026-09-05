export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card';
export type Intent = 'NOVO_GASTO' | 'PAGAMENTO_DIVIDA' | 'CONSULTA' | 'OUTROS';

export interface ParsedTransaction {
  description: string;
  total_amount: number;
  category_id: number;
  payment_method: PaymentMethod;
  occurred_at: string;
  my_share_amount?: number | null;
  third_party_name?: string | null;
  installment_total?: number | null;
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