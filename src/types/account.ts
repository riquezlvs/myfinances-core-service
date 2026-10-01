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

export interface ProjectedIncomeItem {
  id: string;
  description: string;
  amount: number;
  expectedDate: string;
  incomeType?: 'salary' | 'freelance' | 'benefit' | 'other' | null;
  accountName?: string;
}

export interface SafeToSpendSummary {
  accountName: string;
  realBalance: number;
  openCreditInvoices: number;
  safeToSpend: number; // Saldo imediato - faturas
  projectedSafeToSpend: number; // Saldo real + entradas antes do fechamento - faturas
  projectedIncomes: number; // Soma de entradas que caem antes do fechamento
  projectedIncomesList: ProjectedIncomeItem[];
  targetClosingDay?: number;
  targetClosingDate?: string;
  coverageStatus: 'positive' | 'warning' | 'negative';
  explanationText?: string;
}

export interface ConsolidatedPositionSummary {
  totalLiquidBalance: number;
  totalOpenCreditInvoices: number;
  immediateNetBalance: number;
  projectedIncomesUntilClosing: number;
  projectedNetBalance: number;
  accounts: Array<{
    id: string;
    name: string;
    type: AccountType;
    balance: number;
  }>;
  cards: Array<{
    id: string;
    name: string;
    closing_day: number;
    due_day?: number;
    faturaAtual: number;
  }>;
}
