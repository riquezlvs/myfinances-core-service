import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({ models: { generateContent: mockGenerateContent } }),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));

import { validarEPadronizarGasto, interpretarGasto } from '../../../src/services/gemini/transactionParser';
import { getCategoryMap } from '../../../src/services/categories/categoryCache';
import type { ParsedTransaction } from '../../../src/types/transaction';

const mockGetCategoryMap = vi.mocked(getCategoryMap);
const categoryMap = { 1: 'Alimentação', 2: 'Transporte' };
const AGORA_ISO = '2026-09-15T12:00:00.000Z';

function baseParsed(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    description: 'Almoço',
    total_amount: 45,
    category_id: 1,
    payment_method: 'pix',
    occurred_at: AGORA_ISO,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCategoryMap.mockResolvedValue(categoryMap);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('validarEPadronizarGasto', () => {
  it('deve manter occurred_at intacto quando dentro da janela de 30 dias', () => {
    const dentroDaJanela = '2026-08-25T12:00:00.000Z'; // ~21 dias antes
    const resultado = validarEPadronizarGasto(baseParsed({ occurred_at: dentroDaJanela }), categoryMap, AGORA_ISO);
    expect(resultado.occurred_at).toBe(dentroDaJanela);
  });

  it('deve clampar occurred_at futuro além de 30 dias para agora + 30 dias', () => {
    const muitoNoFuturo = '2027-01-01T12:00:00.000Z';
    const resultado = validarEPadronizarGasto(baseParsed({ occurred_at: muitoNoFuturo }), categoryMap, AGORA_ISO);

    const esperado = new Date(new Date(AGORA_ISO).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(resultado.occurred_at).toBe(esperado);
  });

  it('deve clampar occurred_at muito antigo além de 30 dias para agora - 30 dias', () => {
    const muitoNoPassado = '2020-01-01T12:00:00.000Z';
    const resultado = validarEPadronizarGasto(baseParsed({ occurred_at: muitoNoPassado }), categoryMap, AGORA_ISO);

    const esperado = new Date(new Date(AGORA_ISO).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(resultado.occurred_at).toBe(esperado);
  });

  it('deve usar agoraISO quando occurred_at vier vazio', () => {
    const resultado = validarEPadronizarGasto(
      baseParsed({ occurred_at: '' as unknown as string }),
      categoryMap,
      AGORA_ISO
    );
    expect(resultado.occurred_at).toBe(AGORA_ISO);
  });

  it('deve usar agoraISO quando occurred_at vier inválido (não parseável)', () => {
    const resultado = validarEPadronizarGasto(baseParsed({ occurred_at: 'data-invalida' }), categoryMap, AGORA_ISO);
    expect(resultado.occurred_at).toBe(AGORA_ISO);
  });

  it('deve lançar erro para total_amount <= 0', () => {
    expect(() => validarEPadronizarGasto(baseParsed({ total_amount: 0 }), categoryMap, AGORA_ISO)).toThrow(
      'Valor extraído é inválido'
    );
  });

  it('deve lançar erro para category_id desconhecido', () => {
    expect(() => validarEPadronizarGasto(baseParsed({ category_id: 999 }), categoryMap, AGORA_ISO)).toThrow(
      'category_id inválido'
    );
  });

  it('deve lançar erro quando my_share_amount > total_amount', () => {
    expect(() => validarEPadronizarGasto(baseParsed({ my_share_amount: 999 }), categoryMap, AGORA_ISO)).toThrow(
      'my_share_amount não pode ser maior'
    );
  });

  it('deve zerar installment_total quando vier menor que 2', () => {
    const resultado = validarEPadronizarGasto(baseParsed({ installment_total: 1 }), categoryMap, AGORA_ISO);
    expect(resultado.installment_total).toBeNull();
  });
});

describe('interpretarGasto — timeout do Gemini (Fase 7.4)', () => {
  it('deve rejeitar quando o Gemini demora mais que o timeout configurado', async () => {
    vi.useFakeTimers();
    mockGenerateContent.mockImplementation(() => new Promise(() => {}));

    const promessa = interpretarGasto('Gastei 45 no mercado', 'req-1');
    const expectativa = expect(promessa).rejects.toThrow('Tempo limite excedido');

    await vi.advanceTimersByTimeAsync(60_000);
    await expectativa;
  });

  it('deve retornar normalmente quando o Gemini responde antes do timeout', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        description: 'Almoço',
        total_amount: 45,
        category_id: 1,
        payment_method: 'pix',
        occurred_at: AGORA_ISO,
      }),
    });

    const resultado = await interpretarGasto('Gastei 45 no almoço', 'req-1');
    expect(resultado.data.description).toBe('Almoço');
    expect(resultado.warnings).toEqual([]);
  });
});