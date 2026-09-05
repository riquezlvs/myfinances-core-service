import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buscarRecorrenciasPendentes,
  materializarRecorrencia,
  executarCicloRecorrencias,
  iniciarCronRecorrencias,
} from '../../../src/services/recurring/recurringService';

// Mock do cliente Supabase (evita conexão real).
const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// Mock do node-cron: não queremos timers reais nos testes.
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

import cron from 'node-cron';
const mockSchedule = vi.mocked(cron.schedule);

/** Builder encadeado que resolve com { data, error } (e single() customizável). */
function builderResolvendo(data: unknown, error: unknown = null, singleData: unknown = null) {
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
    single: vi.fn(() => Promise.resolve({ data: singleData, error })),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

const recBase = {
  id: 'rec-1',
  description: 'Netflix',
  total_amount: 39.9,
  category_id: 5,
  payment_method: 'credit_card' as const,
  my_share_amount: null,
  third_party_id: null,
  day_of_month: 15,
  last_generated_month: null,
};

beforeEach(() => {
  mockFrom.mockReset();
  mockSchedule.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buscarRecorrenciasPendentes', () => {
  it('deve buscar apenas ativas com last_generated_month anterior ao mês atual', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    const rows = [{ ...recBase }];
    mockFrom.mockImplementationOnce(() => builderResolvendo(rows));

    const resultado = await buscarRecorrenciasPendentes('req-1');

    expect(resultado).toEqual(rows);
  });

  it('deve lançar erro quando a busca falha', async () => {
    mockFrom.mockImplementationOnce(() => builderResolvendo(null, { message: 'boom' }));

    await expect(buscarRecorrenciasPendentes('req-1')).rejects.toThrow(
      'Erro ao buscar recorrências: boom'
    );
  });
});

describe('materializarRecorrencia', () => {
  it('não gera nada quando o dia do mês ainda não chegou', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    const resultado = await materializarRecorrencia({ ...recBase, day_of_month: 20 }, 'req-1');

    expect(resultado).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('deve inserir a transação e marcar o mês como gerado no dia certo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    const insertBuilder = builderResolvendo(null, null, { display_id: 42 });
    const updateBuilder = builderResolvendo(null);
    mockFrom
      .mockImplementationOnce(() => insertBuilder) // insert em transactions
      .mockImplementationOnce(() => updateBuilder); // update last_generated_month

    const resultado = await materializarRecorrencia({ ...recBase }, 'req-1');

    expect(resultado).toBe(42);
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Netflix',
        total_amount: 39.9,
        category_id: 5,
        payment_method: 'credit_card',
        is_recurring: true,
      })
    );
    // Idempotência: marca o primeiro dia do mês atual.
    expect(updateBuilder.update).toHaveBeenCalledWith({ last_generated_month: '2026-09-01' });
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'rec-1');
  });

  it('deve clampar o dia em meses curtos (dia 30 em fevereiro gera no dia 28)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T10:00:00Z')); // fev/2026 tem 28 dias

    const insertBuilder = builderResolvendo(null, null, { display_id: 7 });
    const updateBuilder = builderResolvendo(null);
    mockFrom.mockImplementationOnce(() => insertBuilder).mockImplementationOnce(() => updateBuilder);

    const resultado = await materializarRecorrencia({ ...recBase, day_of_month: 30 }, 'req-1');

    expect(resultado).toBe(7);
    expect(insertBuilder.insert).toHaveBeenCalled();
  });

  it('deve propagar erro quando o insert falha', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    mockFrom.mockImplementationOnce(() => builderResolvendo(null, { message: 'insert falhou' }));

    await expect(materializarRecorrencia({ ...recBase }, 'req-1')).rejects.toThrow(
      'Erro ao inserir recorrência: insert falhou'
    );
  });
});

describe('executarCicloRecorrencias', () => {
  it('deve materializar apenas as recorrências cujo dia chegou', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    const buscarBuilder = builderResolvendo([
      { ...recBase, id: 'rec-hoje', day_of_month: 15 },
      { ...recBase, id: 'rec-futuro', day_of_month: 20 },
    ]);
    const insertBuilder = builderResolvendo(null, null, { display_id: 42 });
    const updateBuilder = builderResolvendo(null);

    mockFrom
      .mockImplementationOnce(() => buscarBuilder) // buscar pendentes
      .mockImplementationOnce(() => insertBuilder) // insert (rec-hoje)
      .mockImplementationOnce(() => updateBuilder); // update (rec-hoje)

    const gerados = await executarCicloRecorrencias('req-1');

    expect(gerados).toEqual([42]);
    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
  });

  it('deve retornar lista vazia quando nenhuma recorrência vence hoje', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));

    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([{ ...recBase, id: 'rec-futuro', day_of_month: 20 }])
    );

    const gerados = await executarCicloRecorrencias('req-1');
    expect(gerados).toEqual([]);
  });
});

describe('iniciarCronRecorrencias', () => {
  it('deve agendar o cron diário e engolir erros do ciclo', async () => {
    mockSchedule.mockReturnValue({ stop: vi.fn() } as any);

    iniciarCronRecorrencias();

    expect(mockSchedule).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));

    // O callback do cron não deve propagar exceções (senão derruba o processo).
    const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
    mockFrom.mockImplementation(() => builderResolvendo(null, { message: 'boom' }));
    await expect(callback()).resolves.toBeUndefined();
  });
});