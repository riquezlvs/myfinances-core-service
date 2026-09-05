import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verificarMeta,
  definirMeta,
  listarMetas,
  removerMeta,
} from '../../../src/services/budgets/budgetService';

const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn().mockResolvedValue({ 1: 'Alimentação', 2: 'Transporte' }),
}));

import { getCategoryMap } from '../../../src/services/categories/categoryCache';
const mockGetCategoryMap = vi.mocked(getCategoryMap);

/** Builder encadeado configurável. */
function builder(opts: { data?: unknown; error?: unknown; maybeSingle?: unknown } = {}) {
  const b: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: opts.maybeSingle ?? null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: opts.data ?? null, error: null })),
  };
  b.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null }).then(onFulfilled);
  return b;
}

beforeEach(() => {
  mockFrom.mockReset();
  vi.clearAllMocks();
  mockGetCategoryMap.mockResolvedValue({ 1: 'Alimentação', 2: 'Transporte' });
});

describe('verificarMeta', () => {
  it('deve retornar null quando a categoria não tem meta', async () => {
    mockFrom.mockImplementationOnce(() => builder({ maybeSingle: null }));

    const status = await verificarMeta(1, 'req-1');
    expect(status).toBeNull();
  });

  it('deve classificar como ok abaixo de 80%', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builder({ maybeSingle: { monthly_limit: 600, categories: { name: 'Alimentação' } } })
      )
      .mockImplementationOnce(() => builder({ data: [{ total_amount: 300 }] })); // 50%

    const status = await verificarMeta(1, 'req-1');
    expect(status?.nivel).toBe('ok');
    expect(status?.percentual).toBeCloseTo(50);
  });

  it('deve classificar como aviso80 entre 80% e 99%', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builder({ maybeSingle: { monthly_limit: 600, categories: { name: 'Alimentação' } } })
      )
      .mockImplementationOnce(() => builder({ data: [{ total_amount: 500 }] })); // 83%

    const status = await verificarMeta(1, 'req-1');
    expect(status?.nivel).toBe('aviso80');
  });

  it('deve classificar como limite100 ao atingir o limite', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builder({ maybeSingle: { monthly_limit: 600, categories: { name: 'Alimentação' } } })
      )
      .mockImplementationOnce(() => builder({ data: [{ total_amount: 650 }] })); // 108%

    const status = await verificarMeta(1, 'req-1');
    expect(status?.nivel).toBe('limite100');
    expect(status?.gastoAtual).toBe(650);
  });

  it('deve retornar null (best-effort) quando a consulta falha', async () => {
    mockFrom.mockImplementationOnce(() => builder({ error: { message: 'boom' } }));

    const status = await verificarMeta(1, 'req-1');
    expect(status).toBeNull();
  });
});

describe('definirMeta', () => {
  it('deve fazer upsert da meta pelo nome da categoria (case-insensitive)', async () => {
    const b = builder();
    mockFrom.mockImplementationOnce(() => b);

    const resultado = await definirMeta('ALIMENTACAO', 600, 'req-1');

    expect(resultado).toEqual({ categoria: 'Alimentação', limite: 600 });
    expect(b.upsert).toHaveBeenCalledWith(
      { category_id: 1, monthly_limit: 600 },
      { onConflict: 'category_id' }
    );
  });

  it('deve retornar null para categoria desconhecida', async () => {
    const resultado = await definirMeta('inexistente', 600, 'req-1');
    expect(resultado).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('listarMetas', () => {
  it('deve listar metas com consumo do mês e ordenar por % usada', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builder({
          data: [
            { monthly_limit: 600, categories: { name: 'Alimentação' } },
            { monthly_limit: 200, categories: { name: 'Transporte' } },
          ],
        })
      )
      .mockImplementationOnce(() =>
        builder({ data: [{ category_id: 1, total_amount: 550 }, { category_id: 2, total_amount: 50 }] })
      );

    const metas = await listarMetas('req-1');

    expect(metas).toHaveLength(2);
    // Alimentação: 550/600 ≈ 92% (aviso80) vem primeiro.
    expect(metas[0].categoria).toBe('Alimentação');
    expect(metas[0].nivel).toBe('aviso80');
    expect(metas[1].categoria).toBe('Transporte');
    expect(metas[1].nivel).toBe('ok');
  });
});

describe('removerMeta', () => {
  it('deve remover a meta pelo nome da categoria', async () => {
    const b = builder();
    mockFrom.mockImplementationOnce(() => b);

    const removida = await removerMeta('alimentacao', 'req-1');

    expect(removida).toBe('Alimentação');
    expect(b.delete).toHaveBeenCalled();
    expect(b.eq).toHaveBeenCalledWith('category_id', 1);
  });

  it('deve retornar null para categoria desconhecida', async () => {
    const removida = await removerMeta('xyz', 'req-1');
    expect(removida).toBeNull();
  });
});