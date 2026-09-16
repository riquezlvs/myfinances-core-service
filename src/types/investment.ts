export type AssetType = 'stock' | 'fii' | 'etf' | 'crypto' | 'other';

export interface InvestmentAsset {
  id: string;
  account_id: string;
  ticker: string;
  asset_type: AssetType;
  quantity: number;
  average_price: number;
  created_at: string;
  updated_at: string;
  // Campos enriquecidos em tempo de consulta:
  current_price?: number;
  total_invested?: number;
  market_value?: number;
  profit_loss?: number;
  profit_loss_pct?: number;
}

export interface YieldCalculationResult {
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  effectiveRatePct: number;
  daysPassed: number;
  taxRatePct: number;
}

export interface PatrimonySummary {
  totalNetWorth: number;
  liquidAssets: {
    total: number;
    accounts: Array<{ name: string; type: string; balance: number }>;
  };
  benefits: {
    total: number;
    accounts: Array<{ name: string; balance: number }>;
  };
  fixedIncome: {
    totalGross: number;
    totalNet: number;
    accounts: Array<{
      name: string;
      balance: number;
      cdiRate: number;
      estimatedNetBalance: number;
      accumulatedYield: number;
    }>;
  };
  variableIncome: {
    totalMarketValue: number;
    totalInvested: number;
    totalProfitLoss: number;
    assets: InvestmentAsset[];
  };
  openCreditInvoices: {
    total: number;
    cards: Array<{ name: string; amount: number }>;
  };
}
