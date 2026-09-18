import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/accounts/accountService', () => ({
  listarContas: vi.fn(),
}));

vi.mock('../../../src/services/investments/yieldService', () => ({
  obterTaxaCdiDiaria: vi.fn(),
  calcularRendimentoCdi: vi.fn(),
}));

vi.mock('../../../src/services/investments/assetPriceService', () => ({
  obterCarteiraComCotacoes: vi.fn(),
}));

vi.mock('../../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn(),
  calcularPeriodoFatura: vi.fn(),
  getFaturaDoPeriodo: vi.fn(),
}));

import { obterResumoPatrimonio, formatarMensagemPatrimonio } from '../../../src/services/patrimony/patrimonyService';
import { listarContas } from '../../../src/services/accounts/accountService';
import { obterTaxaCdiDiaria, calcularRendimentoCdi } from '../../../src/services/investments/yieldService';
import { obterCarteiraComCotacoes } from '../../../src/services/investments/assetPriceService';
import { listarCartoes, calcularPeriodoFatura, getFaturaDoPeriodo } from '../../../src/services/cards/cardService';

beforeEach(() => {
  vi.mocked(listarContas).mockReset();
  vi.mocked(obterTaxaCdiDiaria).mockReset();
  vi.mocked(calcularRendimentoCdi).mockReset();
  vi.mocked(obterCarteiraComCotacoes).mockReset();
  vi.mocked(listarCartoes).mockReset();
  vi.mocked(calcularPeriodoFatura).mockReset();
  vi.mocked(getFaturaDoPeriodo).mockReset();
});

describe('patrimonyService — Consolidação e Formatação de Patrimônio', () => {
  it('deve consolidar corretamente ativos líquidos, benefícios, caixinhas, ações e faturas', async () => {
    vi.mocked(listarContas).mockResolvedValue([
      { id: '1', name: 'Nubank', type: 'checking', balance: 5000, is_active: true } as any,
      { id: '2', name: 'VR Flash', type: 'benefit', balance: 800, is_active: true } as any,
      { id: '3', name: 'Caixinha Reserva', type: 'fixed_income', balance: 10000, cdi_rate: 115, is_active: true } as any,
    ]);

    vi.mocked(obterTaxaCdiDiaria).mockResolvedValue(0.0004);
    vi.mocked(calcularRendimentoCdi).mockReturnValue({
      grossAmount: 100,
      taxAmount: 22.5,
      netAmount: 77.5,
      effectiveRatePct: 1.0,
      daysPassed: 30,
      taxRatePct: 22.5,
    });

    vi.mocked(obterCarteiraComCotacoes).mockResolvedValue({
      assets: [
        { id: 'a1', account_id: 'acc', ticker: 'PETR4', asset_type: 'stock', quantity: 100, average_price: 30, current_price: 35, total_invested: 3000, market_value: 3500, profit_loss: 500, profit_loss_pct: 16.67, created_at: '', updated_at: '' },
      ],
      totalInvested: 3000,
      totalMarketValue: 3500,
      totalProfitLoss: 500,
    });

    vi.mocked(listarCartoes).mockResolvedValue([
      { id: 'c1', name: 'Nubank Ultravioleta', closing_day: 15, card_type: 'credit', is_default: true } as any,
    ]);
    vi.mocked(calcularPeriodoFatura).mockReturnValue({ inicio: new Date(), fim: new Date(), fechamento: new Date() });
    vi.mocked(getFaturaDoPeriodo).mockResolvedValue([
      { display_id: 1, description: 'Hotel', total_amount: 1200, occurred_at: '2026-09-01', installment_number: null, installment_total: null },
    ]);

    const res = await obterResumoPatrimonio('req-1');

    // Total Ativos:
    // Líquido: 5000
    // Benefício: 800
    // Caixinha Líquida: 10000 + 77.50 = 10077.50
    // Renda Variável: 3500
    // Total Ativos = 19377.50
    // Passivos (Fatura) = 1200
    // Patrimônio Líquido = 18177.50
    expect(res.liquidAssets.total).toBe(5000);
    expect(res.benefits.total).toBe(800);
    expect(res.fixedIncome.totalNet).toBe(10077.5);
    expect(res.variableIncome.totalMarketValue).toBe(3500);
    expect(res.openCreditInvoices.total).toBe(1200);
    expect(res.totalNetWorth).toBe(18177.5);
  });

  it('deve formatar a mensagem com Markdown rico e seções claras', () => {
    const summary = {
      totalNetWorth: 18177.5,
      liquidAssets: { total: 5000, accounts: [{ name: 'Nubank', type: 'checking', balance: 5000 }] },
      benefits: { total: 800, accounts: [{ name: 'VR Flash', balance: 800 }] },
      fixedIncome: { totalGross: 10000, totalNet: 10077.5, accounts: [{ name: 'Caixinha Reserva', balance: 10000, cdiRate: 115, estimatedNetBalance: 10077.5, accumulatedYield: 100 }] },
      variableIncome: { totalMarketValue: 3500, totalInvested: 3000, totalProfitLoss: 500, assets: [] },
      openCreditInvoices: { total: 1200, cards: [{ name: 'Nubank Ultravioleta', amount: 1200 }] },
    };

    const texto = formatarMensagemPatrimonio(summary);
    expect(texto).toContain('SEU PATRIMÔNIO CONSOLIDADO');
    expect(texto).toContain('18.177,50');
    expect(texto).toContain('Liquidez Imediata Livre');
    expect(texto).toContain('DISTRIBUIÇÃO DE ATIVOS');
    expect(texto).toContain('Contas Correntes');
    expect(texto).toContain('Benefícios (VR / VA)');
    expect(texto).toContain('Caixinhas & Renda Fixa');
    expect(texto).toContain('PASSIVOS & OBRIGAÇÕES');
    expect(texto).toContain('Total de Faturas a Pagar');
  });
});
