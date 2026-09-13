import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('../../../src/services/people/peopleService', () => ({
  resolveThirdPartyId: vi.fn(),
}));

import {
  registrarTransacao,
  getGastosDiariosDoMes,
  consultarGastosGranulares,
} from '../../../src/services/transactions/transactionService';
import { resolveThirdPartyId } from '../../../src/services/people/peopleService';
import type { ParsedTransaction } from '../../../src/types/transaction';

const mockResolveThirdPartyId = vi.mocked(resolveThirdPartyId);

function builderResolvendo(data: unknown, error: unknown = null, singleData: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: singleData, error })),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

function baseDados(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    description: 'Jantar',
    total_amount: 100,
    category_id: 1,
    payment_method: 'pix',
    occurred_at: '2026-09-05T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockResolveThirdPartyId.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('registrarTransacao — third_party_share_amount (Fase 7.2)', () => {
  it('não deve setar third_party_share_amount quando não há terceiro', async () => {
    const insertBuilder = builderResolvendo(null, null, { display_id: 1 });
    mockFrom.mockImplementationOnce(() => insertBuilder);

    await registrarTransacao(baseDados(), 'raw', 'req-1');

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ third_party_id: null, third_party_share_amount: 0 })
    );
    expect(mockResolveThirdPartyId).not.toHaveBeenCalled();
  });

  it('deve calcular third_party_share_amount = total - minha parte (à vista)', async () => {
    mockResolveThirdPartyId.mockResolvedValue('pessoa-1');
    const insertBuilder = builderResolvendo(null, null, { display_id: 2 });
    mockFrom.mockImplementationOnce(() => insertBuilder);

    await registrarTransacao(baseDados({ third_party_name: 'Maria', my_share_amount: 40 }), 'raw', 'req-1');

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        third_party_id: 'pessoa-1',
        third_party_share_amount: 60,
        my_share_amount: 40,
      })
    );
  });

  it('sem my_share_amount mas com terceiro, assume que o terceiro deve o total', async () => {
    mockResolveThirdPartyId.mockResolvedValue('pessoa-1');
    const insertBuilder = builderResolvendo(null, null, { display_id: 3 });
    mockFrom.mockImplementationOnce(() => insertBuilder);

    await registrarTransacao(baseDados({ third_party_name: 'Maria' }), 'raw', 'req-1');

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ third_party_share_amount: 100 })
    );
  });

  it('deve dividir third_party_share_amount proporcionalmente entre as parcelas', async () => {
    mockResolveThirdPartyId.mockResolvedValue('pessoa-1');
    const insertBuilder = builderResolvendo([{ display_id: 10 }, { display_id: 11 }, { display_id: 12 }]);
    mockFrom.mockImplementationOnce(() => insertBuilder);

    await registrarTransacao(
      baseDados({
        total_amount: 300,
        my_share_amount: 150, // 50% é meu -> 50% (150) é do terceiro
        third_party_name: 'João',
        installment_total: 3,
      }),
      'raw',
      'req-1'
    );

    const linhasInseridas = insertBuilder.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(linhasInseridas).toHaveLength(3);

    const somaThirdParty = linhasInseridas.reduce((soma, l) => soma + Number(l.third_party_share_amount), 0);
    expect(somaThirdParty).toBeCloseTo(150, 2);

    for (const linha of linhasInseridas) {
      expect(linha.third_party_share_amount).toBeCloseTo(50, 2); // 100 (parcela) * 50%
    }
  });
});

describe('getGastosDiariosDoMes — agrupamento em UTC (Fase 7.1)', () => {
  it('deve agrupar um gasto perto da meia-noite pelo dia em UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T02:30:00.000Z'));

    mockFrom.mockImplementationOnce(() =>
      builderResolvendo([{ total_amount: 45, occurred_at: '2026-09-01T02:30:00.000Z' }])
    );

    const porDia = await getGastosDiariosDoMes('req-1');
    expect(porDia[0]).toBe(45);
  });

  it('deve usar os limites do mês em UTC para a consulta (gte/lt)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));

    const builder = builderResolvendo([]);
    mockFrom.mockImplementationOnce(() => builder);

    await getGastosDiariosDoMes('req-1');

    expect(builder.gte).toHaveBeenCalledWith('occurred_at', new Date(Date.UTC(2026, 8, 1)).toISOString());
    expect(builder.lt).toHaveBeenCalledWith('occurred_at', new Date(Date.UTC(2026, 9, 1)).toISOString());
  });

  it('deve preencher o array com o tamanho correto do mês (UTC, fevereiro não-bissexto)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T00:00:00.000Z'));

    mockFrom.mockImplementationOnce(() => builderResolvendo([]));

    const porDia = await getGastosDiariosDoMes('req-1');
    expect(porDia).toHaveLength(28);
describe('consultarGastosGranulares — Fase 8.4 (consulta granular)', () => {
  it('filtra por categoryId e mês: devolve total exato + detalhe, e aplica os filtros na query', async () => {
    const agg = builderResolvendo([{ total_amount: 50 }, { total_amount: 25 }]);
    const det = builderResolvendo([
      {
        display_id: 7,
        description: 'Uber',
        total_amount: 25,
        occurred_at: '2026-08-10T12:00:00.000Z',
        payment_method: 'credit_card',
        categories: { name: 'Transporte' },
      },
    ]);
    mockFrom.mockImplementationOnce(() => agg).mockImplementationOnce(() => det);

    const resultado = await consultarGastosGranulares({ categoryId: 2, month: '2026-08' }, 'req-84');

    expect(resultado.total).toBe(75);
    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0].categoria).toBe('Transporte');
    expect(resultado.items[0].total_amount).toBe(25);
    // Tanto a query agregada quanto a de detalhe recebem o filtro de categoria.
    expect(agg.eq).toHaveBeenCalledWith('category_id', 2);
    expect(det.eq).toHaveBeenCalledWith('category_id', 2);
    // E filtram pelo intervalo exato do mês (limites local -> ISO).
    expect(agg.gte).toHaveBeenCalledWith('occurred_at', new Date(2026, 7, 1).toISOString());
    expect(agg.lt).toHaveBeenCalledWith('occurred_at', new Date(2026, 8, 1).toISOString());
    expect(det.limit).toHaveBeenCalledWith(20);
  });

  it('usa o mês atual por padrão quando não se passa month', async () => {
    const agora = new Date();
    const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;

    const agg = builderResolvendo([]);
    const det = builderResolvendo([]);
    mockFrom.mockImplementationOnce(() => agg).mockImplementationOnce(() => det);

    const resultado = await consultarGastosGranulares({}, 'req-85');

    expect(resultado.total).toBe(0);
    expect(resultado.items).toEqual([]);
    expect(agg.gte).toHaveBeenCalledWith('occurred_at', new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString());
  });

  it('mês malformado: lança sem montar nenhuma query (rede de segurança)', async () => {
    await expect(
      consultarGastosGranulares({ month: 'agosto' }, 'req-86')
    ).rejects.toThrow('Mês inválido para consulta granular');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
  });
});