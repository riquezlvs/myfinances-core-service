import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listarMetasPoupanca,
  definirMetaPoupanca,
  adicionarAporte,
  calcularPlanoPoupanca,
} from '../../../src/services/savings/savingsService';

const mockFrom = vi.fn();

vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
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
  };
  // single() retorna o resultado final, não o builder
  builder.single = vi.fn(() => Promise.resolve({ data, error }));
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe('calcularPlanoPoupanca', () => {
  it('deve calcular aporte mensal com prazo futuro', () => {
    const agora = new Date('2026-09-15');
    const plano = calcularPlanoPoupanca(5000, 1000, '2026-12-31', agora);
    expect(plano.restante).toBe(4000);
    expect(plano.mesesRestantes).toBeGreaterThan(0);
    expect(plano.valorMensal).toBeGreaterThan(0);
  });

  it('deve retornar aporte null quando não há prazo', () => {
    const plano = calcularPlanoPoupanca(5000, 1000, null);
    expect(plano.restante).toBe(4000);
    expect(plano.mesesRestantes).toBeNull();
    expect(plano.valorMensal).toBeNull();
  });

  it('deve travar em 1 mês quando prazo já passou', () => {
    const agora = new Date('2026-09-15');
    const plano = calcularPlanoPoupanca(5000, 1000, '2026-08-01', agora);
    expect(plano.mesesRestantes).toBe(1);
  });

  it('deve retornar restante 0 quando já atingiu o alvo', () => {
    const plano = calcularPlanoPoupanca(5000, 6000, '2026-12-31');
    expect(plano.restante).toBe(0);
    expect(plano.valorMensal).toBe(0);
  });
});

describe('listarMetasPoupanca', () => {
  it('deve retornar metas com plano calculado', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'g1', name: 'Viagem', target_amount: 5000, saved_amount: 1000, deadline_date: '2026-12-31' },
      { id: 'g2', name: 'Carro', target_amount: 30000, saved_amount: 5000, deadline_date: null },
    ]));

    const metas = await listarMetasPoupanca('req-1');

    expect(metas).toHaveLength(2);
    expect(metas[0].nome).toBe('Viagem');
    expect(metas[0].alvo).toBe(5000);
    expect(metas[0].poupado).toBe(1000);
    expect(metas[0].restante).toBe(4000);
    expect(metas[0].valorMensal).toBeGreaterThan(0);
    expect(metas[1].valorMensal).toBeNull();
  });

  it('deve retornar lista vazia quando não há metas', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([]));
    const metas = await listarMetasPoupanca('req-1');
    expect(metas).toEqual([]);
  });
});

describe('definirMetaPoupanca', () => {
  it('deve criar meta com prazo', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo({
      id: 'g1',
      name: 'Viagem',
      target_amount: 5000,
      saved_amount: 0,
      deadline_date: '2026-12-31',
    }));

    const meta = await definirMetaPoupanca('Viagem', 5000, '2026-12-31', 'req-1');

    expect(meta.nome).toBe('Viagem');
    expect(meta.alvo).toBe(5000);
    expect(meta.poupado).toBe(0);
    expect(meta.prazo).toBe('2026-12-31');
  });

  it('deve criar meta sem prazo', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo({
      id: 'g1',
      name: 'Reserva',
      target_amount: 10000,
      saved_amount: 0,
      deadline_date: null,
    }));

    const meta = await definirMetaPoupanca('Reserva', 10000, null, 'req-1');

    expect(meta.prazo).toBeNull();
    expect(meta.valorMensal).toBeNull();
  });

  it('deve lançar erro com nome vazio', async () => {
    await expect(definirMetaPoupanca('', 5000, null, 'req-1')).rejects.toThrow('Nome da meta');
  });

  it('deve lançar erro com alvo inválido', async () => {
    await expect(definirMetaPoupanca('Viagem', -100, null, 'req-1')).rejects.toThrow('Valor-alvo');
  });
});

describe('adicionarAporte', () => {
  it('deve adicionar aporte e retornar meta atualizada', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'g1', name: 'Viagem', target_amount: 5000, saved_amount: 1000, deadline_date: '2026-12-31' },
    ]));
    mockFrom.mockImplementationOnce(() => builderResolvendo(null));

    const resultado = await adicionarAporte('Viagem', 500, 'req-1');

    expect(resultado).not.toBeNull();
    expect(resultado?.meta.poupado).toBe(1500);
    expect(resultado?.valorAplicado).toBe(500);
  });

  it('deve travar aporte no restante quando valor excede', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([
      { id: 'g1', name: 'Viagem', target_amount: 5000, saved_amount: 4800, deadline_date: '2026-12-31' },
    ]));
    mockFrom.mockImplementationOnce(() => builderResolvendo(null));

    const resultado = await adicionarAporte('Viagem', 500, 'req-1');

    expect(resultado?.valorAplicado).toBe(200);
    expect(resultado?.avisoValorAjustado).toContain('Faltava apenas');
  });

  it('deve retornar null quando meta não existe', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo([]));
    const resultado = await adicionarAporte('Inexistente', 500, 'req-1');
    expect(resultado).toBeNull();
  });

  it('deve lançar erro com valor inválido', async () => {
    await expect(adicionarAporte('Viagem', -100, 'req-1')).rejects.toThrow('Valor do aporte');
  });
});