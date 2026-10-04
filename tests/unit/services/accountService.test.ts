import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('../../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn(),
  calcularPeriodoFatura: vi.fn(),
  getFaturaDoPeriodo: vi.fn(),
}));

import {
  listarContas,
  ajustarSaldo,
  calcularSafeToSpend,
  resolverContaParaTransacao,
  debitarSaldo,
  creditarSaldo,
  sincronizarAtivoComConta,
} from '../../../src/services/accounts/accountService';
import { listarCartoes, calcularPeriodoFatura, getFaturaDoPeriodo } from '../../../src/services/cards/cardService';

function builderResolvendo(data: unknown, error: unknown = null, singleData: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: singleData ?? (Array.isArray(data) ? data[0] : data), error })),
    single: vi.fn(() => Promise.resolve({ data: singleData ?? data, error })),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  vi.mocked(listarCartoes).mockReset();
  vi.mocked(calcularPeriodoFatura).mockReset();
  vi.mocked(getFaturaDoPeriodo).mockReset();
});

describe('accountService — Contas, saldos e Safe to Spend', () => {
  it('deve listar contas ativas', async () => {
    const contas = [
      { id: '1', name: 'Nubank', type: 'checking', balance: 1500, is_active: true },
      { id: '2', name: 'VR Flash', type: 'benefit', balance: 800, is_active: true },
    ];
    mockFrom.mockReturnValue(builderResolvendo(contas));

    const res = await listarContas('req-1');
    expect(res).toHaveLength(2);
    expect(res[0].name).toBe('Nubank');
  });

  it('deve ajustar o saldo da conta com sucesso', async () => {
    const conta = { id: 'acc-1', name: 'VR Flash', balance: 300 };
    const builderBusca = builderResolvendo(conta, null, conta);
    const builderUpdate = builderResolvendo({ ...conta, balance: 750 }, null, { ...conta, balance: 750 });

    mockFrom
      .mockReturnValueOnce(builderBusca)   // busca por nome
      .mockReturnValueOnce(builderUpdate); // update

    const res = await ajustarSaldo('VR Flash', 750, 'req-1');
    expect(res.balance).toBe(750);
  });

  it('deve calcular Safe to Spend (Saldo Real - Faturas Abertas)', async () => {
    const checkingAcc = { id: 'acc-1', name: 'Nubank', type: 'checking', balance: 3000 };
    mockFrom.mockReturnValue(builderResolvendo([checkingAcc], null, checkingAcc));

    vi.mocked(listarCartoes).mockResolvedValue([
      { id: 'card-1', name: 'Nubank Gold', closing_day: 10, card_type: 'credit', is_default: true },
    ] as any);

    vi.mocked(calcularPeriodoFatura).mockReturnValue({
      inicio: new Date(),
      fim: new Date(),
      fechamento: new Date(),
    });

    vi.mocked(getFaturaDoPeriodo).mockResolvedValue([
      { display_id: 1, description: 'Supermercado', total_amount: 1000, occurred_at: '2026-09-01', installment_number: null, installment_total: null },
      { display_id: 2, description: 'Uber', total_amount: 200, occurred_at: '2026-09-02', installment_number: null, installment_total: null },
    ]);

    const res = await calcularSafeToSpend('acc-1', 'req-1');
    expect(res.realBalance).toBe(3000);
    expect(res.openCreditInvoices).toBe(1200);
    expect(res.safeToSpend).toBe(1800);
  });

  it('deve resolver conta para benefício (VR/VA)', async () => {
    const contas = [
      { id: 'acc-1', name: 'Nubank', type: 'checking', balance: 2000 },
      { id: 'acc-2', name: 'VR Refeição', type: 'benefit', balance: 500 },
    ];
    mockFrom.mockReturnValue(builderResolvendo(contas));

    const res = await resolverContaParaTransacao('meal_voucher', null, null, 'req-1');
    expect(res?.id).toBe('acc-2');
    expect(res?.name).toBe('VR Refeição');
  });

  it('deve debitar saldo e sincronizar ativo espelho de renda fixa', async () => {
    const conta = { id: 'acc-fx-1', name: 'Caixinha Reserva', type: 'fixed_income', balance: 1000 };
    const builderGetConta = builderResolvendo(conta, null, conta);
    const builderUpdateConta = builderResolvendo({ ...conta, balance: 800 });
    const ativos = [{ id: 'asset-1', ticker: 'Caixinha Reserva', asset_type: 'other', quantity: 1, average_price: 1000 }];
    const builderGetAtivos = builderResolvendo(ativos);
    const builderUpdateAtivo = builderResolvendo({ ...ativos[0], average_price: 800 });

    mockFrom
      .mockReturnValueOnce(builderGetConta)     // obterContaPorId
      .mockReturnValueOnce(builderUpdateConta)  // update accounts
      .mockReturnValueOnce(builderGetAtivos)    // select investment_assets
      .mockReturnValueOnce(builderUpdateAtivo);  // update investment_assets

    const novoSaldo = await debitarSaldo('acc-fx-1', 200, 'req-deb');
    expect(novoSaldo).toBe(800);
    expect(builderUpdateConta.update).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 800 })
    );
    expect(builderUpdateAtivo.update).toHaveBeenCalledWith(
      expect.objectContaining({ average_price: 800 })
    );
  });

  it('deve creditar saldo da conta', async () => {
    const conta = { id: 'acc-1', name: 'Conta Corrente', type: 'checking', balance: 500 };
    const builderGetConta = builderResolvendo(conta, null, conta);
    const builderUpdateConta = builderResolvendo({ ...conta, balance: 750 });

    mockFrom
      .mockReturnValueOnce(builderGetConta)
      .mockReturnValueOnce(builderUpdateConta);

    const novoSaldo = await creditarSaldo('acc-1', 250, 'req-cred');
    expect(novoSaldo).toBe(750);
    expect(builderUpdateConta.update).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 750 })
    );
  });
});
