import { describe, it, expect, vi, beforeEach } from 'vitest';
import { obterExtratoCompletoUnificado } from '../../src/core/engine';

const mockFrom = vi.fn();
vi.mock('../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

function builderCom(data: unknown, error: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe('obterExtratoCompletoUnificado com recorrências', () => {
  it('deve retornar transações e mapear recorrências ativas com status realizado e previsto', async () => {
    const transactions = [
      {
        display_id: 101,
        description: 'Salário CLT',
        total_amount: 6500,
        occurred_at: '2026-09-04T12:00:00Z',
        payment_method: 'pix',
        entry_type: 'income',
        is_recurring: true,
      },
      {
        display_id: 102,
        description: 'Mercado',
        total_amount: 250,
        occurred_at: '2026-09-10T15:00:00Z',
        payment_method: 'credit_card',
        entry_type: 'expense',
        is_recurring: false,
      },
    ];

    const recurring = [
      {
        id: 'rec-1',
        description: 'Salário CLT',
        total_amount: 6500,
        day_of_month: 5,
        entry_type: 'income',
        income_type: 'salary',
        weekend_rule: 'anticipate',
        account_id: 'acc-1',
        payment_method: 'pix',
      },
      {
        id: 'rec-2',
        description: 'Freelance Design',
        total_amount: 1800,
        day_of_month: 25,
        entry_type: 'income',
        income_type: 'freelance',
        weekend_rule: 'postpone',
        account_id: 'acc-1',
        payment_method: 'pix',
      },
      {
        id: 'rec-3',
        description: 'Aluguel Apartamento',
        total_amount: 2200,
        day_of_month: 10,
        entry_type: 'expense',
        weekend_rule: 'postpone',
        payment_method: 'pix',
      },
    ];

    const accounts = [{ id: 'acc-1', name: 'Conta Nubank', type: 'checking' }];
    const categories = [{ id: 1, name: 'Moradia' }];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') return builderCom(transactions);
      if (table === 'recurring_transactions') return builderCom(recurring);
      if (table === 'accounts') return builderCom(accounts);
      if (table === 'categories') return builderCom(categories);
      return builderCom([]);
    });

    const resultado = await obterExtratoCompletoUnificado({ mesAno: '2026-09' }, 'test-req');

    expect(resultado.sucesso).toBe(true);
    expect(resultado.dados?.totalEntradas).toBe(6500);
    expect(resultado.dados?.totalSaidas).toBe(250);
    expect(resultado.dados?.itens).toHaveLength(2);
    expect(resultado.dados?.itens[0].is_recurring).toBe(true);

    const recorrencias = resultado.dados?.recorrencias;
    expect(recorrencias).toBeDefined();
    expect(recorrencias).toHaveLength(3);

    // Salário: foi encontrado nas transações com is_recurring=true -> realizada
    const sal = recorrencias.find((r: any) => r.id === 'rec-1');
    expect(sal).toBeDefined();
    expect(sal.status).toBe('realizada');
    expect(sal.account_name).toBe('Conta Nubank');
    expect(sal.income_type).toBe('salary');

    // Freelance: não está nas transações -> prevista
    const free = recorrencias.find((r: any) => r.id === 'rec-2');
    expect(free).toBeDefined();
    expect(free.status).toBe('prevista');
    expect(free.income_type).toBe('freelance');

    // Aluguel: despesa prevista
    const aluguel = recorrencias.find((r: any) => r.id === 'rec-3');
    expect(aluguel).toBeDefined();
    expect(aluguel.entry_type).toBe('expense');

    // Totais
    const totais = resultado.dados?.totaisRecorrentes;
    expect(totais).toBeDefined();
    expect(totais.totalEntradasPrevistas).toBe(6500 + 1800);
    expect(totais.totalSaidasPrevistas).toBe(2200);
    expect(totais.totalEntradasRealizadas).toBe(6500);
    expect(totais.saldoLiquidoRecorrente).toBe(8300 - 2200);
  });
});
