import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';

vi.mock('../../../src/services/transactions/transactionService', () => ({
  getGastosPorCategoria: vi.fn(),
}));
vi.mock('../../../src/services/budgets/budgetService', () => ({
  listarMetas: vi.fn(),
}));
vi.mock('../../../src/services/charts/chartService', () => ({
  gerarGraficoCategoriasPNG: vi.fn(),
}));

import { handleGrafico } from '../../../src/bot/commands/grafico';
import { getGastosPorCategoria } from '../../../src/services/transactions/transactionService';
import { listarMetas } from '../../../src/services/budgets/budgetService';
import { gerarGraficoCategoriasPNG } from '../../../src/services/charts/chartService';
import { RODAPE_UX } from '../../../src/config/constants';

const mockGetGastos = vi.mocked(getGastosPorCategoria);
const mockListarMetas = vi.mocked(listarMetas);
const mockGerarGrafico = vi.mocked(gerarGraficoCategoriasPNG);

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 2 }),
  } as unknown as TelegramBot & { sendPhoto: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGerarGrafico.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

describe('handleGrafico — gráfico PNG com paleta por status (8.5)', () => {
  it('sem gastos: mensagem com RODAPE_UX e sem foto', async () => {
    mockGetGastos.mockResolvedValue([]);
    const bot = criarBotMock();

    await handleGrafico(999, 'req-1', bot);

    expect(bot.sendPhoto).not.toHaveBeenCalled();
    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain(RODAPE_UX);
  });

  it('com dados: resolve o nivel a partir de listarMetas e envia a foto com caption RODAPE_UX', async () => {
    mockGetGastos.mockResolvedValue([
      { categoria: 'Alimentação', total: 900 },
      { categoria: 'Transporte', total: 300 },
    ]);
    mockListarMetas.mockResolvedValue([
      { categoria: 'Alimentação', gastoAtual: 950, limite: 600, percentual: 158.3, nivel: 'limite100' },
    ]);
    const bot = criarBotMock();

    await handleGrafico(999, 'req-1', bot);

    expect(bot.sendPhoto).toHaveBeenCalledTimes(1);
    const [chatId, , opts] = bot.sendPhoto.mock.calls[0];
    expect(chatId).toBe(999);
    expect((opts as { caption: string }).caption).toContain(RODAPE_UX);

    // A cor NUNCA vem da IA: o nivel se resolve em código por nome de categoria
    // (Alimentação -> limite100; Transporte sem meta -> undefined/verde).
    expect(mockGerarGrafico).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ categoria: 'Alimentação', nivel: 'limite100' }),
        expect.objectContaining({ categoria: 'Transporte', nivel: undefined }),
      ]),
      expect.any(String)
    );
  });

  it('best-effort: se listarMetas falha, o gráfico continua (barras sem status -> verde)', async () => {
    mockGetGastos.mockResolvedValue([{ categoria: 'Lazer', total: 100 }]);
    mockListarMetas.mockRejectedValue(new Error('boom'));
    const bot = criarBotMock();

    await handleGrafico(999, 'req-1', bot);

    expect(bot.sendPhoto).toHaveBeenCalledTimes(1);
    const [, , opts] = bot.sendPhoto.mock.calls[0];
    expect((opts as { caption: string }).caption).toContain(RODAPE_UX);
  });
});