import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buscarPessoaId, resolveThirdPartyId, listarOuCriarPessoas } from '../../../src/services/people/peopleService';

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