import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import { handleFatura, filtrarRecorrenciasPrevistas } from '../../../src/bot/commands/fatura';
import { listarCartoes, getFaturaDoPeriodo } from '../../../src/services/cards/cardService';
import { getFaturaMensal } from '../../../src/services/transactions/transactionService';
import { buscarRecorrenciasAtivasCredito } from '../../../src/services/recurring/recurringService';

vi.mock('../../../src/clients/telegramClient', () => ({
  getTelegramBot: () => ({ sendMessage: vi.fn() }),
}));

vi.mock('../../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn(),
  calcularPeriodoFatura: vi.fn().mockReturnValue({
    inicio: new Date(2026, 8, 11), // 11/09/2026
    fim: new Date(2026, 9, 11), // 11/10/2026
    fechamento: new Date(2026, 9, 10), // 10/10/2026
  }),
  getFaturaDoPeriodo: vi.fn(),
}));

vi.mock('../../../src/services/transactions/transactionService', () => ({
  getFaturaMensal: vi.fn(),
}));

vi.mock('../../../src/services/recurring/recurringService', () => ({
  buscarRecorrenciasAtivasCredito: vi.fn(),
}));

const mockListarCartoes = vi.mocked(listarCartoes);
const mockGetFaturaDoPeriodo = vi.mocked(getFaturaDoPeriodo);
const mockGetFaturaMensal = vi.mocked(getFaturaMensal);
const mockBuscarRecorrenciasCredito = vi.mocked(buscarRecorrenciasAtivasCredito);

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as TelegramBot & { sendMessage: ReturnType<typeof vi.fn> };
}

describe('fatura — filtrarRecorrenciasPrevistas', () => {
  const periodo = {
    inicio: new Date(2026, 8, 11), // 11 de setembro
    fim: new Date(2026, 9, 11), // 11 de outubro
    fechamento: new Date(2026, 9, 10),
  };

  it('retorna apenas recorrências que ainda vão vencer antes do fechamento', () => {
    const agora = new Date(2026, 8, 15); // 15 de setembro
    const recorrencias = [
      {
        id: 'rec-1',
        description: 'Netflix',
        total_amount: 39.9,
        category_id: 1,
        payment_method: 'credit_card' as const,
        my_share_amount: null,
        third_party_id: null,
        day_of_month: 20, // 20/09 -> futuro na fatura
        last_generated_month: null,
      },
      {
        id: 'rec-2',
        description: 'Spotify',
        total_amount: 21.9,
        category_id: 1,
        payment_method: 'credit_card' as const,
        my_share_amount: null,
        third_party_id: null,
        day_of_month: 5, // 05/10 -> futuro na fatura
        last_generated_month: null,
      },
      {
        id: 'rec-3',
        description: 'Academia',
        total_amount: 100,
        category_id: 2,
        payment_method: 'credit_card' as const,
        my_share_amount: null,
        third_party_id: null,
        day_of_month: 12, // 12/09 -> já passou em relação a 15/09
        last_generated_month: '2026-09-01',
      },
      {
        id: 'rec-4',
        description: 'Seguro',
        total_amount: 200,
        category_id: 3,
        payment_method: 'credit_card' as const,
        my_share_amount: null,
        third_party_id: null,
        day_of_month: 15, // Hoje -> já foi ou está sendo materializada hoje
        last_generated_month: null,
      },
    ];

    const resultado = filtrarRecorrenciasPrevistas(recorrencias, periodo, agora);

    expect(resultado).toHaveLength(2);
    expect(resultado[0].description).toBe('Netflix');
    expect(resultado[0].total_amount).toBe(39.9);
    expect(resultado[1].description).toBe('Spotify');
    expect(resultado[1].total_amount).toBe(21.9);
  });
});

describe('fatura — handleFatura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exibe lançamentos realizados e recorrências previstas com totais separados', async () => {
    const bot = criarBotMock();
    mockListarCartoes.mockResolvedValue([
      { id: 'c-1', name: 'Nubank', closing_day: 10, card_type: 'credit', is_default: true },
    ]);
    mockGetFaturaDoPeriodo.mockResolvedValue([
      {
        display_id: 101,
        description: 'Supermercado',
        total_amount: 150,
        occurred_at: '2026-09-12T10:00:00Z',
        installment_number: null,
        installment_total: null,
      },
    ]);
    mockBuscarRecorrenciasCredito.mockResolvedValue([
      {
        id: 'rec-1',
        description: 'Netflix',
        total_amount: 55.9,
        category_id: 1,
        payment_method: 'credit_card',
        my_share_amount: null,
        third_party_id: null,
        day_of_month: 25,
        last_generated_month: null,
      },
    ]);

    await handleFatura(12345, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1] as string;

    expect(texto).toContain('💳 *Fatura Nubank*');
    expect(texto).toContain('#101 · 12/09 · Supermercado — R$ 150,00');
    expect(texto).toContain('*Recorrências previstas até o fechamento:*');
    expect(texto).toContain('Netflix (recorrente) — R$ 55,90');
    expect(texto).toContain('*Lançado:* R$ 150,00');
    expect(texto).toContain('*Previsto (recorrências):* R$ 55,90');
    expect(texto).toContain('*Total estimado:* R$ 205,90');
  });

  it('não duplica indicador de parcelas quando a descrição já contém (X/Y)', async () => {
    const bot = criarBotMock();
    mockListarCartoes.mockResolvedValue([
      { id: 'c-1', name: 'Nubank', closing_day: 10, card_type: 'credit', is_default: true },
    ]);
    mockGetFaturaDoPeriodo.mockResolvedValue([
      {
        display_id: 102,
        description: 'Notebook (1/3)',
        total_amount: 500,
        occurred_at: '2026-09-12T10:00:00Z',
        installment_number: 1,
        installment_total: 3,
      },
    ]);
    mockBuscarRecorrenciasCredito.mockResolvedValue([]);

    await handleFatura(12345, 'req-2', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1] as string;

    expect(texto).toContain('#102 · 12/09 · Notebook (1/3) — R$ 500,00');
    expect(texto).not.toContain('(1/3) (1/3)');
  });

  it('exibe mensagem amigável quando não há lançamentos nem recorrências', async () => {
    const bot = criarBotMock();
    mockListarCartoes.mockResolvedValue([]);
    mockGetFaturaMensal.mockResolvedValue([]);
    mockBuscarRecorrenciasCredito.mockResolvedValue([]);

    await handleFatura(12345, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('Nenhum lançamento ou recorrência no cartão de crédito neste período.');
  });
});
