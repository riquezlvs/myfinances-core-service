import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({ models: { generateContent: mockGenerateContent } }),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn().mockResolvedValue({ 1: 'Alimentação', 2: 'Transporte' }),
}));
vi.mock('../../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn().mockResolvedValue([
    { id: 'c1', name: 'Nubank Roxinho', card_type: 'credit', is_default: true },
  ]),
}));

import { interpretarExtrato } from '../../../src/services/gemini/statementParser';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('interpretarExtrato', () => {
  it('deve extrair lançamentos estruturados do extrato via imagem', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        card_name_hint: 'Nubank',
        statement_date: '2026-09',
        items: [
          {
            description: 'Cafeteria',
            amount: 18.5,
            category_id: 1,
            date: '2026-09-02',
            installment_current: null,
            installment_total: null,
            is_payment_or_credit: false,
          },
        ],
      }),
    });

    const resultado = await interpretarExtrato(Buffer.from('imagem-mock'), 'image/jpeg', 'req-1');

    expect(resultado.card_name_hint).toBe('Nubank');
    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0]!.description).toBe('Cafeteria');
    expect(resultado.items[0]!.amount).toBe(18.5);
  });

  it('deve lançar erro se o Gemini estourar o timeout', async () => {
    vi.useFakeTimers();
    mockGenerateContent.mockImplementation(() => new Promise(() => {}));

    const promessa = interpretarExtrato(Buffer.from('imagem-mock'), 'image/jpeg', 'req-1');
    const expectativa = expect(promessa).rejects.toThrow('Tempo limite excedido');

    await vi.advanceTimersByTimeAsync(90_000);
    await expectativa;
  });
});
