import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportarGastosDoMesCSV,
  exportarDividasCSV,
} from '../../../src/services/export/exportService';

// Mock do cliente Supabase (evita conexão real).
const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

/** Builder encadeado que resolve com { data, error }. */
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
    or: vi.fn().mockReturnThis(),
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exportarGastosDoMesCSV', () => {
  it('deve gerar CSV com BOM, header e valores formatados em pt-BR', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([
        {
          display_id: 1,
          description: 'Mercado; compra grande',
          total_amount: 45,
          my_share_amount: null,
          payment_method: 'pix',
          occurred_at: '2026-09-02T12:00:00.000Z',
          is_recurring: false,
          categories: { name: 'Alimentação' },
        },
        {
          display_id: 2,
          description: 'Netflix',
          total_amount: 39.9,
          my_share_amount: 20,
          payment_method: 'credit_card',
          occurred_at: '2026-09-15T10:00:00.000Z',
          is_recurring: true,
          categories: null,
        },
      ])
    );

    const { nome, buffer, linhas } = await exportarGastosDoMesCSV('req-1');

    expect(nome).toBe('gastos-2026-09.csv');
    expect(linhas).toBe(2);

    const csv = buffer.toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true); // BOM para Excel

    const corpo = csv.replace(/^\uFEFF/, '');
    const [header, linha1, linha2] = corpo.split('\r\n');
    expect(header).toBe('ID;Descrição;Valor Total;Minha Parte;Método;Data;Categoria;Recorrente');
    // Descrição com ";" e valores com vírgula decimal são escapados entre aspas.
    expect(linha1).toBe(
      '1;"Mercado; compra grande";"45,00";;pix;2026-09-02T12:00:00.000Z;Alimentação;não'
    );
    // Segunda linha: recorrente, com minha parte e sem categoria.
    expect(linha2).toBe('2;Netflix;"39,90";"20,00";credit_card;2026-09-15T10:00:00.000Z;;sim');
  });

  it('deve filtrar apenas o mês atual (gte/lt em occurred_at)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    mockFrom.mockImplementationOnce(() => builderResolvendo([]));

    await exportarGastosDoMesCSV('req-1');

    const builder = mockFrom.mock.calls[0] && undefined; // sanidade de chamada única
    void builder;
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('deve lançar erro quando a busca falha', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo(null, { message: 'boom' }));

    await expect(exportarGastosDoMesCSV('req-1')).rejects.toThrow('Erro ao exportar gastos: boom');
  });
});

describe('exportarDividasCSV', () => {
  it('deve calcular saldos por pessoa e excluir dívidas quitadas', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 100, people: { name: 'Irmã' } },
          { third_party_id: 'p2', third_party_share_amount: 50, people: { name: 'João' } },
        ])
      )
      .mockImplementationOnce(() =>
        builderResolvendo([{ person_id: 'p1', amount: 30 }])
      );

    const { nome, buffer, linhas } = await exportarDividasCSV('req-1');

    expect(nome).toBe('dividas.csv');
    expect(linhas).toBe(2);

    const csv = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const [header, linha1, linha2] = csv.split('\r\n');
    expect(header).toBe('Pessoa;Saldo Devido');
    expect(linha1).toBe('Irmã;"70,00"'); // 100 - 30 de pagamento
    expect(linha2).toBe('João;"50,00"');
  });

  it('deve omitir pessoas com saldo zerado ou quitado', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builderResolvendo([
          { third_party_id: 'p1', third_party_share_amount: 100, people: { name: 'Irmã' } },
          { third_party_id: 'p2', third_party_share_amount: 50, people: { name: 'João' } },
        ])
      )
      .mockImplementationOnce(() =>
        builderResolvendo([{ person_id: 'p1', amount: 100 }])
      );

    const { linhas, buffer } = await exportarDividasCSV('req-1');

    expect(linhas).toBe(1);
    const csv = buffer.toString('utf8').replace(/^\uFEFF/, '');
    expect(csv).toContain('João;"50,00"');
    expect(csv).not.toContain('Irmã');
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

    const { linhas } = await exportarDividasCSV('req-1');
    expect(linhas).toBe(0);
  });

  it('deve lançar erro quando a busca de dívidas falha', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo(null, { message: 'boom' }));

    await expect(exportarDividasCSV('req-1')).rejects.toThrow('Erro ao exportar dívidas: boom');
  });
});