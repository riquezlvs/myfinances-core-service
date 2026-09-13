import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({ models: { generateContent: mockGenerateContent } }),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn().mockResolvedValue({ 1: 'Alimentação' }),
}));

import { interpretarAudio } from '../../../src/services/gemini/audioParser';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('interpretarAudio', () => {
  it('deve validar e padronizar a transação quando a intenção é NOVO_GASTO', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        intent: 'NOVO_GASTO',
        transcricao: 'Gastei 30 no mercado',
        transaction: {
          description: 'Mercado',
          total_amount: 30,
          category_id: 1,
          payment_method: 'pix',
          occurred_at: '2026-09-05T12:00:00.000Z',
        },
      }),
    });

    const resultado = await interpretarAudio(Buffer.from('audio'), 'audio/ogg', 'req-1');

    expect(resultado.intent).toBe('NOVO_GASTO');
    expect(resultado.transaction?.description).toBe('Mercado');
  });

  it('deve lançar erro quando o Gemini demora mais que o timeout de áudio', async () => {
    vi.useFakeTimers();
    mockGenerateContent.mockImplementation(() => new Promise(() => {}));

    const promessa = interpretarAudio(Buffer.from('audio'), 'audio/ogg', 'req-1');
    const expectativa = expect(promessa).rejects.toThrow('Tempo limite excedido');

    await vi.advanceTimersByTimeAsync(90_000);
    await expectativa;
  });

  it('deve retornar transaction null quando a intenção não é NOVO_GASTO', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'OUTROS', transcricao: 'oi', transaction: null }),
    });

    const resultado = await interpretarAudio(Buffer.from('audio'), 'audio/ogg', 'req-1');
    expect(resultado.transaction).toBeNull();
  });
});