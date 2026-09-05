import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSaldoTerceiros, processarPagamento } from '../../../src/services/debts/debtService';

// Mock do módulo do cliente Supabase (evita conexão real).
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

/** Cria um builder encadeado que resolve com { data, error }. */
function builderResolvendo(data: unknown, error: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('getSaldoTerceiros', () => {
  it('deve calcular saldo somando dívidas e subtraindo pagamentos', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 100, people: { name: 'Irmã' } },
          { third_party_id: 'p2', third_party_share_amount: 50, people: { name: 'João' } },
        ])
      )
      .mockImplementationOnce(() =>
        builderResolvendo([
          { person_id: 'p1', amount: 30 },
          { person_id: 'p2', amount: 10 },
        ])
      );

    const saldos = await getSaldoTerceiros('req-1');

    expect(saldos).toEqual([
      { nome: 'Irmã', valor: 70 },
      { nome: 'João', valor: 40 },
    ]);
  });

  it('deve ignorar linhas sem third_party_id ou nome', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: null, third_party_share_amount: 100, people: { name: 'Sem ID' } },
          { third_party_id: 'p1', third_party_share_amount: 50, people: null },
        ])
      )
      .mockImplementationOnce(() => builderResolvendo([]));

    const saldos = await getSaldoTerceiros('req-1');
    expect(saldos).toEqual([]);
  });

  it('deve filtrar saldos zerados ou negativos', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 100, people: { name: 'Irmã' } },
        ])
      )
      .mockImplementationOnce(() =>
        builderResolvendo([{ person_id: 'p1', amount: 100 }])
      );

    const saldos = await getSaldoTerceiros('req-1');
    expect(saldos).toEqual([]);
  });

  it('deve lançar erro se a busca de dívidas falhar', async () => {
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo(null, { message: 'erro ao buscar dívidas' })
    );

    await expect(getSaldoTerceiros('req-1')).rejects.toThrow('erro ao buscar dívidas');
  });
});

describe('processarPagamento', () => {
  it('deve retornar pessoa_nao_encontrada se a RPC não achar a pessoa', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const resultado = await processarPagamento('Irmã', 25, 'req-1');
    expect(resultado).toEqual({ status: 'pessoa_nao_encontrada', nome: 'Irmã' });
  });

  it('deve retornar sem_divida se a pessoa não tem saldo', async () => {
    mockRpc.mockResolvedValue({ data: 'p1', error: null });
    mockFrom
      .mockImplementationOnce(() => builderResolvendo([])) // dívidas
      .mockImplementationOnce(() => builderResolvendo([])); // pagamentos

    const resultado = await processarPagamento('Irmã', 25, 'req-1');
    expect(resultado).toEqual({ status: 'sem_divida', nome: 'Irmã' });
  });

  it('deve registrar pagamento total e retornar quitado', async () => {
    mockRpc.mockResolvedValue({ data: 'p1', error: null });
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 50, people: { name: 'Irmã' } },
        ])
      )
      .mockImplementationOnce(() => builderResolvendo([])) // pagamentos
      .mockImplementationOnce(() => builderResolvendo(null)); // insert debt_payments

    const resultado = await processarPagamento('Irmã', 50, 'req-1');
    expect(resultado).toEqual({ status: 'quitado', nome: 'Irmã', valorPago: 50 });
  });

  it('deve ajustar valor pago maior que o devido', async () => {
    mockRpc.mockResolvedValue({ data: 'p1', error: null });
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 30, people: { name: 'Irmã' } },
        ])
      )
      .mockImplementationOnce(() => builderResolvendo([]))
      .mockImplementationOnce(() => builderResolvendo(null));

    const resultado = await processarPagamento('Irmã', 100, 'req-1');
    expect(resultado.status).toBe('quitado');
    if (resultado.status === 'quitado') {
      expect(resultado.valorPago).toBe(30);
      expect(resultado.avisoValorAjustado).toContain('devia apenas');
    }
  });

  it('deve retornar parcial quando paga menos que o devido', async () => {
    mockRpc.mockResolvedValue({ data: 'p1', error: null });
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 50, people: { name: 'Irmã' } },
        ])
      )
      .mockImplementationOnce(() => builderResolvendo([]))
      .mockImplementationOnce(() => builderResolvendo(null));

    const resultado = await processarPagamento('Irmã', 20, 'req-1');
    expect(resultado).toEqual({
      status: 'parcial',
      nome: 'Irmã',
      valorPago: 20,
      saldoRestante: 30,
    });
  });
});