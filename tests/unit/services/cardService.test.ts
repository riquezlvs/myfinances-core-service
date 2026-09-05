import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcularPeriodoFatura,
  listarCartoes,
  definirCartao,
  getFaturaDoPeriodo,
  removerCartao,
} from '../../../src/services/cards/cardService';

const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

function builder(opts: { data?: unknown; error?: unknown; single?: unknown; maybeSingle?: unknown } = {}) {
  const b: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: opts.maybeSingle ?? null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: opts.single ?? null, error: null })),
  };
  b.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null }).then(onFulfilled);
  return b;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe('calcularPeriodoFatura (função pura)', () => {
  it('quando hoje <= closing_day: fatura começou no fechamento anterior', () => {
    // Hoje: 10/09/2026, fechamento dia 20 → fatura: 21/08 → 20/09.
    const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 10));

    expect(periodo.inicio.getDate()).toBe(21);
    expect(periodo.inicio.getMonth()).toBe(7); // agosto
    expect(periodo.fim.getDate()).toBe(21);
    expect(periodo.fim.getMonth()).toBe(8); // setembro (fim é exclusivo)
    expect(periodo.fechamento.getDate()).toBe(20);
    expect(periodo.fechamento.getMonth()).toBe(8);
  });

  it('quando hoje > closing_day: fatura fecha no mês seguinte', () => {
    // Hoje: 25/09/2026, fechamento dia 20 → fatura: 21/09 → 20/10.
    const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 25));

    expect(periodo.inicio.getDate()).toBe(21);
    expect(periodo.inicio.getMonth()).toBe(8);
    expect(periodo.fim.getMonth()).toBe(9); // outubro
    expect(periodo.fim.getDate()).toBe(21);
    expect(periodo.fechamento.getMonth()).toBe(9);
    expect(periodo.fechamento.getDate()).toBe(20);
  });

  it('no próprio dia do fechamento, a fatura fecha hoje', () => {
    const periodo = calcularPeriodoFatura(15, new Date(2026, 8, 15));
    expect(periodo.fechamento.getDate()).toBe(15);
    expect(periodo.fechamento.getMonth()).toBe(8);
  });

  it('fechamento dia 1: período vai de dia 2 do mês atual ao dia 1 do próximo', () => {
    // Hoje 10/09, fechamento dia 1 → fatura atual: 02/09 → 01/10.
    const periodo = calcularPeriodoFatura(1, new Date(2026, 8, 10));
    expect(periodo.inicio.getDate()).toBe(2);
    expect(periodo.inicio.getMonth()).toBe(8);
    expect(periodo.fim.getDate()).toBe(2);
    expect(periodo.fim.getMonth()).toBe(9);
    expect(periodo.fechamento.getDate()).toBe(1);
    expect(periodo.fechamento.getMonth()).toBe(9);
  });
});

describe('listarCartoes / definirCartao / removerCartao', () => {
  it('deve listar cartões ordenados por fechamento', async () => {
    mockFrom.mockImplementationOnce(() =>
      builder({
        data: [
          { id: 'c1', name: 'nubank', closing_day: 20 },
          { id: 'c2', name: 'inter', closing_day: 5 },
        ],
      })
    );

    const cartoes = await listarCartoes('req-1');
    expect(cartoes).toHaveLength(2);
    expect(cartoes[0].name).toBe('nubank');
  });

  it('deve fazer upsert do cartão e retornar o registro', async () => {
    const b = builder({ single: { id: 'c1', name: 'nubank', closing_day: 20 } });
    mockFrom.mockImplementationOnce(() => b);

    const cartao = await definirCartao('nubank', 20, 'req-1');

    expect(cartao.name).toBe('nubank');
    expect(b.upsert).toHaveBeenCalledWith({ name: 'nubank', closing_day: 20 }, { onConflict: 'name' });
  });

  it('deve remover cartão pelo nome', async () => {
    const b = builder({ maybeSingle: { name: 'nubank' } });
    mockFrom.mockImplementationOnce(() => b);

    const removido = await removerCartao('nubank', 'req-1');
    expect(removido).toBe('nubank');
    expect(b.eq).toHaveBeenCalledWith('name', 'nubank');
  });

  it('deve retornar null ao remover cartão inexistente', async () => {
    mockFrom.mockImplementationOnce(() => builder({ maybeSingle: null }));

    const removido = await removerCartao('fantasma', 'req-1');
    expect(removido).toBeNull();
  });
});

describe('getFaturaDoPeriodo', () => {
  const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 10));

  it('cartão padrão inclui gastos credit_card sem card_id (or)', async () => {
    const b = builder({ data: [{ display_id: 1, total_amount: 100 }] });
    mockFrom.mockImplementationOnce(() => b);

    const itens = await getFaturaDoPeriodo('c1', periodo, true, 'req-1');

    expect(itens).toHaveLength(1);
    expect(b.or).toHaveBeenCalledWith('card_id.eq.c1,card_id.is.null');
    // Período respeitado: gte no início, lt no fim.
    expect(b.gte).toHaveBeenCalledWith('occurred_at', periodo.inicio.toISOString());
    expect(b.lt).toHaveBeenCalledWith('occurred_at', periodo.fim.toISOString());
  });

  it('cartão não-padrão filtra apenas pelo próprio card_id', async () => {
    const b = builder({ data: [] });
    mockFrom.mockImplementationOnce(() => b);

    await getFaturaDoPeriodo('c2', periodo, false, 'req-1');

    expect(b.or).not.toHaveBeenCalled();
    expect(b.eq).toHaveBeenCalledWith('card_id', 'c2');
  });

  it('deve propagar erro do Supabase', async () => {
    mockFrom.mockImplementationOnce(() => builder({ error: { message: 'boom' } }));

    await expect(getFaturaDoPeriodo('c1', periodo, true, 'req-1')).rejects.toThrow(
      'Erro ao buscar fatura do cartão: boom'
    );
  });
});