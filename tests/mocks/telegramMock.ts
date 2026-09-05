import { vi } from 'vitest';

/**
 * Cria um mock do client TelegramBot com os métodos usados pelos
 * handlers e commands.
 */
export function createTelegramBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    on: vi.fn(),
  };
}

export type TelegramBotMock = ReturnType<typeof createTelegramBotMock>;