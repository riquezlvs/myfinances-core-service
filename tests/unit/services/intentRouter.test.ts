import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({ models: { generateContent: mockGenerateContent } }),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));

import { classificarIntencao } from '../../../src/services/gemini/intentRouter';
import { getCategoryMap } from '../../../src/services/categories/categoryCache';

const mockGetCategoryMap = vi.mocked(getCategoryMap);
const categoryMap = { 1: 'Alimentação', 2: 'Transporte' };

/** Simula a resposta JSON única do Gemini (payload único Fase 8). */
function payloadGemini(intent: string, params: unknown, transaction: unknown = null): string {
  return JSON.stringify({ intent, params, transaction });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCategoryMap.mockResolvedValue(categoryMap);
});

describe('classificarIntencao — extração de params granulares (8.4)', () => {
  it('extrai category, month e type de una pergunta de consulta', async () => {
    mockGenerateContent.mockResolvedValue({
      text: payloadGemini('CONSULTA', {
        entidade: 'gastos',
        category: 'Transporte',
        month: '2026-08',
        type: 'gasto',
      }),
    });

    const payload = await classificarIntencao('quanto gastei com transporte em agosto?', 'req-1');

    expect(payload.intent).toBe('CONSULTA');
    expect(payload.params.category).toBe('Transporte');
    expect(payload.params.month).toBe('2026-08');
    expect(payload.params.type).toBe('gasto');
    expect(payload.transaction).toBeNull();
  });

  it('descarta params desconhecidos (ex: chat_id) e conserva os granulares', async () => {
    mockGenerateContent.mockResolvedValue({
      text: payloadGemini('CONSULTA', {
        category: 'Alimentação',
        month: '2026-09',
        chat_id: 999999, // injección: no pertenece a ninguna intent
      }),
    });

    const payload = await classificarIntencao('quanto gastei de alimentação este mes?', 'req-2');

    expect(payload.intent).toBe('CONSULTA');
    expect(payload.params.category).toBe('Alimentação');
    expect(payload.params.month).toBe('2026-09');
    expect(payload.params.chat_id).toBeUndefined();
  });

  it('um month malformado é descartado SOZINHO: conserva a category (parse tolerante por-chave)', async () => {
    mockGenerateContent.mockResolvedValue({
      text: payloadGemini('CONSULTA', { category: 'Transporte', month: 'agosto' }),
    });

    const payload = await classificarIntencao('gastos de transporte em agosto', 'req-3');

    expect(payload.intent).toBe('CONSULTA');
    expect(payload.params.category).toBe('Transporte');
    expect(payload.params.month).toBeUndefined();
  });
});