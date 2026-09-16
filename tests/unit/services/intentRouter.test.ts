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

  it('classifica NOVA_ENTRADA e popula dados estruturados de receita', async () => {
    mockGenerateContent.mockResolvedValue({
      text: payloadGemini(
        'NOVA_ENTRADA',
        { nomeConta: 'VR' },
        {
          description: 'Recarga mensal VR',
          total_amount: 800,
          category_id: 1,
          occurred_at: '2026-09-01T10:00:00.000Z',
          account_name: 'VR',
        }
      ),
    });

    const payload = await classificarIntencao('Caiu 800 de VR hoje', 'req-4');

    expect(payload.intent).toBe('NOVA_ENTRADA');
    expect(payload.transaction).not.toBeNull();
    expect(payload.transaction?.total_amount).toBe(800);
    expect(payload.transaction?.entry_type).toBe('income');
    expect(payload.transaction?.account_name).toBe('VR');
  });

  it('classifica PATRIMONIO e AJUSTAR_SALDO corretamente', async () => {
    mockGenerateContent.mockResolvedValue({
      text: payloadGemini('PATRIMONIO', { entidade: 'patrimonio' }),
    });

    const payloadPatrimonio = await classificarIntencao('qual meu patrimônio?', 'req-5');
    expect(payloadPatrimonio.intent).toBe('PATRIMONIO');

    mockGenerateContent.mockResolvedValue({
      text: payloadGemini('AJUSTAR_SALDO', { nomeConta: 'Nubank', saldoAjuste: 2500 }),
    });

    const payloadAjuste = await classificarIntencao('meu saldo no Nubank é 2500', 'req-6');
    expect(payloadAjuste.intent).toBe('AJUSTAR_SALDO');
    expect(payloadAjuste.params.nomeConta).toBe('Nubank');
    expect(payloadAjuste.params.saldoAjuste).toBe(2500);
  });
});