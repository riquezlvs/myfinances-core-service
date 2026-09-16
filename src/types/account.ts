export type AccountType = 'checking' | 'benefit' | 'fixed_income' | 'investment_broker';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  cdi_rate?: number | null;
  start_date?: string | null;
  card_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SafeToSpendSummary {
  accountName: string;
  realBalance: number;
  openCreditInvoices: number;
  safeToSpend: number;
}
