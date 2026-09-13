import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { CallbackQuery } from 'node-telegram-bot-api';

// Mocks dos serviços usados pelas ações de edição (rotas existentes).
vi.mock('../../../src/services/transactions/transactionService', () => ({
  apagarTransacaoComGrupo: vi.fn(),
  atualizarCategoria: vi.fn(),
  atualizarMetodo: vi.fn(),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));

// 8.6 — Mocks dos comandos reutilizados pela navegação rápida (nav:<destino>).
vi.mock('../../../src/bot/commands/grafico', () => ({ handleGrafico: vi.fn() }));
vi.mock('../../../src/bot/commands/resumo', () => ({ handleResumo: vi.fn() }));
vi.mock('../../../src/bot/commands/fatura', () => ({ handleFatura: vi.fn() }));
vi.mock('../../../src/bot/commands/dividas', () => ({ handleDividas: vi.fn() }));
vi.mock('../../../src/bot/commands/insight', () => ({ handleInsight: vi.fn() }));

import { callbackQueryHandler } from '../../../src/bot/handlers/callbackQueryHandler';
import { handleGrafico } from '../../../src/bot/commands/grafico';
import { handleResumo } from '../../../src/bot/commands/resumo';
import { handleFatura } from '../../../src/bot/commands/fatura';
import { handleDividas } from '../../../src/bot/commands/dividas';
import { handleInsight } from '../../../src/bot/commands/insight';
import { RODAPE_UX } from '../../../src/config/constants';

const mockHandleGrafico = vi.mocked(handleGrafico);
const mockHandleResumo = vi.mocked(handleResumo);
const mockHandleFatura = vi.mocked(handleFatura);
const mockHandleDividas = vi.mocked(handleDividas);
const mockHandleInsight = vi.mocked(handleInsight);

// tests/setup.ts define TELEGRAM_AUTHORIZED_USER_ID = '12345'.
const USUARIO_AUTORIZADO = 12345;

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 2 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
  } as unknown as TelegramBot & Record<string, ReturnType<typeof vi.fn>>;
}

function criarQuery(data: string, userId = USUARIO_AUTORIZADO): CallbackQuery {
  return {
    id: 'cbq-1',
    from: { id: userId, is_bot: false, first_name: 'Dono' },
    message: { message_id: 7, date: 0, chat: { id: 999, type: 'private' } },
    data,
  } as unknown as CallbackQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callbackQueryHandler — navegação rápida por botões inline (8.6)', () => {
  it('nav:grafico reutiliza a mesma lógica do comando /grafico e confirma o callback', async () => {
    const bot = criarBotMock();

    await callbackQueryHandler(criarQuery('nav:grafico'), bot);

    expect(mockHandleGrafico).toHaveBeenCalledTimes(1);
    expect(mockHandleGrafico).toHaveBeenCalledWith(999, expect.any(String), bot);
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq-1', { text: '✅ Pronto!' });
  });

  it('nav:resumo / nav:fatura / nav:dividas / nav:insight reutilizam seus comandos', async () => {
    const bot = criarBotMock();

    await callbackQueryHandler(criarQuery('nav:resumo'), bot);
    await callbackQueryHandler(criarQuery('nav:fatura'), bot);
    await callbackQueryHandler(criarQuery('nav:dividas'), bot);
    await callbackQueryHandler(criarQuery('nav:insight'), bot);

    expect(mockHandleResumo).toHaveBeenCalledTimes(1);
    expect(mockHandleFatura).toHaveBeenCalledTimes(1);
    expect(mockHandleDividas).toHaveBeenCalledTimes(1);
    expect(mockHandleInsight).toHaveBeenCalledTimes(1);
  });

  it('nav:novogasto orienta o usuário a mandar o novo gasto (com rodapé)', async () => {
    const bot = criarBotMock();

    await callbackQueryHandler(criarQuery('nav:novogasto'), bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('➕ Claro!');
    expect(texto).toContain(RODAPE_UX);
  });

  it('destino desconhecido: recusa sem executar nenhuma rota (lista fixa de destinos)', async () => {
    const bot = criarBotMock();

    await callbackQueryHandler(criarQuery('nav:delete_all_data'), bot);

    expect(mockHandleGrafico).not.toHaveBeenCalled();
    expect(mockHandleResumo).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq-1', { text: '❓ Ação não reconhecida.' });
  });

  it('gate de segurança: usuário NÃO autorizado recebe negação e nenhuma rota corre', async () => {
    const bot = criarBotMock();

    await callbackQueryHandler(criarQuery('nav:grafico', 99999), bot);

    expect(mockHandleGrafico).not.toHaveBeenCalled();
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq-1', { text: '🚫 Acesso negado.' });
  });
});