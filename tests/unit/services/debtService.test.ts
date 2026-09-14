import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSaldoTerceiros, processarPagamento, salvarDividida, listarListasDivididas } from '../../../src/services/debts/debtService';
import * as peopleModule from '../../../src/services/people/peopleService';

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
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    single: vi.fn(() => Promise.resolve({ data, error })),
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
      {
        nome: 'Irmã',
        valor: 70,
        parcelas: [
          {
            displayId: undefined,
            descricao: undefined,
            valor: 70,
            numero: undefined,
            total: undefined,
            ocorreuEm: undefined,
          },
        ],
      },
      {
        nome: 'João',
        valor: 40,
        parcelas: [
          {
            displayId: undefined,
            descricao: undefined,
            valor: 40,
            numero: undefined,
            total: undefined,
            ocorreuEm: undefined,
          },
        ],
      },
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

describe('salvarDividida', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(peopleModule, 'listarOuCriarPessoas').mockResolvedValue(
      new Map([
        ['maria', 'p1'],
        ['joão', 'p2'],
      ])
    );
  });

  it('deve registrar despesa dividida com 3 pessoas', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Primeira chamada: insert da transação principal + select single
        return builderResolvendo({ id: 't1' });
      }
      // Chamadas subsequentes: insert das dívidas individuais
      return builderResolvendo({ id: `t${callCount}` });
    });

    const resultado = await salvarDividida({
      descricao: 'Jantar',
      total: 120,
      categoryId: 1,
      paymentMethod: 'pix',
      ocorreuEm: '2026-09-15T20:00:00',
      pessoas: ['Maria', 'João'],
      requestId: 'req-1',
    });

    expect(resultado.total).toBe(120);
    expect(resultado.minhaParte).toBe(40); // 120 / 3
    expect(resultado.partes).toHaveLength(2);
    expect(resultado.transactionId).toBe('t1');
  });

  it('deve lançar erro com menos de 2 pessoas', async () => {
    await expect(
      salvarDividida({
        descricao: 'Jantar',
        total: 100,
        categoryId: 1,
        paymentMethod: 'pix',
        ocorreuEm: '2026-09-15T20:00:00',
        pessoas: ['Maria'],
        requestId: 'req-1',
      })
    ).rejects.toThrow('pelo menos 2 pessoas');
  });

  it('deve lançar erro com descrição vazia', async () => {
    await expect(
      salvarDividida({
        descricao: '',
        total: 100,
        categoryId: 1,
        paymentMethod: 'pix',
        ocorreuEm: '2026-09-15T20:00:00',
        pessoas: ['Maria', 'João'],
        requestId: 'req-1',
      })
    ).rejects.toThrow('Descrição');
  });
});

describe('listarListasDivididas', () => {
  it('deve retornar despesas divididas do mês', async () => {
    mockFrom.mockImplementation(() =>
      builderResolvendo([
        {
          id: 't1',
          description: 'Jantar',
          total_amount: 120,
          my_share_amount: 40,
          occurred_at: '2026-09-15T20:00:00',
          third_party_id: 'p1',
          people: { name: 'Maria' },
        },
      ])
    );

    const linhas = await listarListasDivididas('req-1', '2026-09');

    expect(linhas).toHaveLength(1);
    expect(linhas[0].descricao).toBe('Jantar');
    expect(linhas[0].total).toBe(120);
    expect(linhas[0].minhaParte).toBe(40);
    expect(linhas[0].devedores[0].nome).toBe('Maria');
  });

  it('deve retornar lista vazia quando não há splits', async () => {
    mockFrom.mockImplementation(() => builderResolvendo([]));

    const linhas = await listarListasDivididas('req-1', '2026-09');

    expect(linhas).toEqual([]);
  });
});