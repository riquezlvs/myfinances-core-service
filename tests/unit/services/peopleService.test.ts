import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buscarPessoaId, resolveThirdPartyId, listarOuCriarPessoas, listarPessoasComSaldos } from '../../../src/services/people/peopleService';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

function builderResolvendo(data: unknown, error: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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

describe('buscarPessoaId', () => {
  it('deve retornar o UUID quando a pessoa existe', async () => {
    mockRpc.mockResolvedValue({ data: 'uuid-123', error: null });
    const id = await buscarPessoaId('Maria', 'req-1');
    expect(id).toBe('uuid-123');
    expect(mockRpc).toHaveBeenCalledWith('find_person', { p_name: 'Maria' });
  });

  it('deve retornar null quando a pessoa não existe', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const id = await buscarPessoaId('Desconhecido', 'req-1');
    expect(id).toBeNull();
  });

  it('deve lançar erro se a RPC falhar', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'erro RPC' } });
    await expect(buscarPessoaId('Maria', 'req-1')).rejects.toThrow('erro RPC');
  });
});

describe('resolveThirdPartyId', () => {
  it('deve retornar o UUID da pessoa', async () => {
    mockRpc.mockResolvedValue({ data: 'uuid-456', error: null });
    const id = await resolveThirdPartyId('João', 'req-1');
    expect(id).toBe('uuid-456');
  });

  it('deve lançar erro se a RPC falhar', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'falha' } });
    await expect(resolveThirdPartyId('João', 'req-1')).rejects.toThrow('falha');
  });
});

describe('listarOuCriarPessoas', () => {
  it('deve criar pessoas que não existem e retornar o mapa', async () => {
    // Primeira chamada: busca (ninguém existe)
    mockFrom.mockImplementationOnce(() => builderResolvendo([]));
    // Segunda chamada: insert (cria as pessoas)
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'p1', name: 'Maria' },
      { id: 'p2', name: 'João' },
    ]));

    const mapa = await listarOuCriarPessoas(['Maria', 'João'], 'req-1');

    expect(mapa.size).toBe(2);
    expect(mapa.get('maria')).toBe('p1');
    expect(mapa.get('joão')).toBe('p2');
  });

  it('deve reutilizar pessoas existentes sem recriar', async () => {
    // Maria já existe, João não
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'p1', name: 'Maria' },
    ]));
    // Insert só para João
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'p2', name: 'João' },
    ]));

    const mapa = await listarOuCriarPessoas(['Maria', 'João'], 'req-1');

    expect(mapa.size).toBe(2);
    expect(mapa.get('maria')).toBe('p1');
    expect(mapa.get('joão')).toBe('p2');
  });

  it('deve lançar erro se nenhum nome for informado', async () => {
    await expect(listarOuCriarPessoas([], 'req-1')).rejects.toThrow('Nenhuma pessoa informada');
  });

  it('deve lançar erro se nome for muito longo', async () => {
    const nomeLongo = 'A'.repeat(61);
    await expect(listarOuCriarPessoas([nomeLongo], 'req-1')).rejects.toThrow('muito longo');
  });

  it('deve remover duplicatas antes de criar', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([]));
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'p1', name: 'Maria' },
    ]));

    const mapa = await listarOuCriarPessoas(['Maria', 'Maria', 'maria'], 'req-1');

    expect(mapa.size).toBe(1);
  });
});

describe('listarPessoasComSaldos', () => {
  it('deve listar pessoas com saldos e não requisitar paid_at de debt_payments', async () => {
    // 1. people
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        { id: 'p1', name: 'Maria Silva', created_at: '2026-09-01T10:00:00Z' },
      ])
    );
    // 2. transactions (dívidas)
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        {
          display_id: 10,
          description: 'Pizza',
          third_party_id: 'p1',
          third_party_share_amount: 50,
          occurred_at: '2026-10-04T12:00:00Z',
        },
      ])
    );
    // 3. debt_payments
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        {
          person_id: 'p1',
          amount: 20,
          created_at: '2026-10-04T13:00:00Z',
        },
      ])
    );

    const resultado = await listarPessoasComSaldos(undefined, 'req-1');

    expect(resultado).toHaveLength(1);
    expect(resultado[0].name).toBe('Maria Silva');
    expect(resultado[0].saldoDevedor).toBe(30); // 50 - 20
    expect(resultado[0].totalOriginal).toBe(50);
    expect(resultado[0].totalPago).toBe(20);
    expect(resultado[0].status).toBe('Em aberto');
    expect(resultado[0].itensInclusos).toHaveLength(1);
  });

  it('deve filtrar saldoDevedorMes e itens quando mesAno for fornecido', async () => {
    // 1. people
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        { id: 'p1', name: 'João Santos', created_at: '2026-08-01T10:00:00Z' },
      ])
    );
    // 2. transactions (1 em setembro, 1 em outubro)
    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        {
          display_id: 21,
          description: 'Almoço Outubro',
          third_party_id: 'p1',
          third_party_share_amount: 40,
          occurred_at: '2026-10-02T12:00:00Z',
        },
        {
          display_id: 15,
          description: 'Cinema Setembro',
          third_party_id: 'p1',
          third_party_share_amount: 30,
          occurred_at: '2026-09-15T12:00:00Z',
        },
      ])
    );
    // 3. debt_payments
    mockFrom.mockImplementationOnce(() => builderResolvendo([]));

    const resultado = await listarPessoasComSaldos(undefined, 'req-1', '2026-10');

    expect(resultado).toHaveLength(1);
    expect(resultado[0].saldoDevedorMes).toBe(40);
    expect(resultado[0].saldoDevedor).toBe(40);
    expect(resultado[0].itensInclusos).toHaveLength(1);
    expect(resultado[0].itensInclusos?.[0].description).toBe('Almoço Outubro');
  });
});