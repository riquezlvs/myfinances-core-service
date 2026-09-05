import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { messageHandler } from '../../src/bot/handlers/messageHandler';
import type { Intent, ParsedTransaction } from '../../src/types/transaction';

// Mocks dos serviços externos usados pelo messageHandler.
vi.mock('../../src/services/gemini/intentRouter', () => ({
  classificarIntencao: vi.fn(),
}));
vi.mock('../../src/services/gemini/transactionParser', () => ({
  interpretarGasto: vi.fn(),
}));
vi.mock('../../src/services/transactions/transactionService', () => ({
  registrarTransacao: vi.fn(),
  apagarTransacaoComGrupo: vi.fn(),
  atualizarCategoria: vi.fn(),
  atualizarMetodo: vi.fn(),
}));
vi.mock('../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));
vi.mock('../../src/services/budgets/budgetService', () => ({
  verificarMeta: vi.fn().mockResolvedValue(null),
}));

import { classificarIntencao } from '../../src/services/gemini/intentRouter';
import { interpretarGasto } from '../../src/services/gemini/transactionParser';
import { registrarTransacao } from '../../src/services/transactions/transactionService';
import { getCategoryMap } from '../../src/services/categories/categoryCache';

const mockClassificarIntencao = vi.mocked(classificarIntencao);
const mockInterpretarGasto = vi.mocked(interpretarGasto);
const mockRegistrarTransacao = vi.mocked(registrarTransacao);
const mockGetCategoryMap = vi.mocked(getCategoryMap);

function criarBotMock() {
  const bot = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    on: vi.fn(),
  };
  return bot as unknown as TelegramBot & typeof bot;
}

function criarMensagem(texto: string, userId = 12345): Message {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 999, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Teste' },
    text: texto,
  } as unknown as Message;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('messageHandler — fluxo de novo gasto', () => {
  it('deve registrar um gasto avulso e responder com sucesso', async () => {
    mockClassificarIntencao.mockResolvedValue('NOVO_GASTO' as Intent);
    mockInterpretarGasto.mockResolvedValue({
      description: 'Almoço no restaurante',
      total_amount: 45,
      category_id: 1,
      payment_method: 'pix',
      occurred_at: '2026-09-05T12:00:00.000Z',
    } as ParsedTransaction);
    mockRegistrarTransacao.mockResolvedValue({ displayIds: [101] });
    mockGetCategoryMap.mockResolvedValue({ 1: 'Alimentação' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45 no almoço no pix'), bot);

    expect(mockClassificarIntencao).toHaveBeenCalled();
    expect(mockInterpretarGasto).toHaveBeenCalledWith('Gastei 45 no almoço no pix', expect.any(String));
    expect(mockRegistrarTransacao).toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);

    const [chatIdMensagem, texto] = bot.sendMessage.mock.calls[0];
    expect(chatIdMensagem).toBe(999);
    expect(texto).toContain('Almoço no restaurante');
    expect(texto).toContain('R$ 45,00');
    expect(texto).toContain('Alimentação');
    expect(texto).toContain('#101');
  });

  it('deve registrar compra parcelada e listar todos os IDs', async () => {
    mockClassificarIntencao.mockResolvedValue('NOVO_GASTO' as Intent);
    mockInterpretarGasto.mockResolvedValue({
      description: 'Tênis novo',
      total_amount: 300,
      category_id: 7,
      payment_method: 'credit_card',
      occurred_at: '2026-09-05T12:00:00.000Z',
      installment_total: 3,
    } as ParsedTransaction);
    mockRegistrarTransacao.mockResolvedValue({ displayIds: [201, 202, 203] });
    mockGetCategoryMap.mockResolvedValue({ 7: 'Compras' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Tênis novo 300 em 3x'), bot);

    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Parcelado em 3x');
    expect(texto).toContain('#201, #202, #203');
  });

  it('deve responder com acesso negado para usuário não autorizado', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45', 99999), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '🚫 Acesso negado.');
    expect(mockClassificarIntencao).not.toHaveBeenCalled();
  });

  it('deve responder com erro genérico quando o fluxo falha', async () => {
    mockClassificarIntencao.mockRejectedValue(new Error('Gemini fora do ar'));

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45'), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Não consegui processar sua mensagem');
    expect(texto).not.toContain('Gemini fora do ar'); // não vaza detalhe interno
  });
});

describe('messageHandler — roteamento de comandos diretos', () => {
  it('deve responder ao /start', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/start'), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Bem-vindo ao seu bot financeiro');
    expect(mockClassificarIntencao).not.toHaveBeenCalled();
  });

  it('deve responder que comando não reconhecido para "/xyz"', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/xyz'), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '❓ Comando não reconhecido. Use /start para ver os comandos disponíveis.');
  });
});