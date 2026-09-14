import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import { handleApagar } from '../../../src/bot/commands/apagar';
import { apagarTransacaoPorId } from '../../../src/services/transactions/transactionService';

vi.mock('../../../src/clients/telegramClient', () => ({
  getTelegramBot: () => ({ sendMessage: vi.fn() }),
}));

vi.mock('../../../src/services/transactions/transactionService', () => ({
  apagarTransacaoPorId: vi.fn(),
}));

const mockApagarTransacaoPorId = vi.mocked(apagarTransacaoPorId);

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as TelegramBot & { sendMessage: ReturnType<typeof vi.fn> };
}

describe('apagar — handleApagar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exibe botão de voltar e resumo ao apagar uma transação existente', async () => {
    const bot = criarBotMock();
    mockApagarTransacaoPorId.mockResolvedValue({ apagou: true, displayIds: [42] });

    await handleApagar(12345, '42', 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, texto, options] = bot.sendMessage.mock.calls[0]!;

    expect(chatId).toBe(12345);
    expect(texto).toContain('✅ Gasto #42 apagado.');
    expect(options?.reply_markup).toBeDefined();
    expect(options?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: '📊 Meu Resumo', callback_data: 'nav:resumo' },
        { text: '💳 Faturas', callback_data: 'nav:fatura' },
      ],
    ]);
  });

  it('informa quando o gasto não foi encontrado', async () => {
    const bot = criarBotMock();
    mockApagarTransacaoPorId.mockResolvedValue({ apagou: false, displayIds: [] });

    await handleApagar(12345, '999', 'req-2', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const [, texto] = bot.sendMessage.mock.calls[0]!;
    expect(texto).toContain('Não encontrei nenhum gasto com o ID #999.');
  });
});
