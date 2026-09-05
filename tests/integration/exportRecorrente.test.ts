import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { messageHandler } from '../../src/bot/handlers/messageHandler';

// Mocks dos serviços usados pelos comandos da Fase 3.
const mockFrom = vi.fn();
vi.mock('../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));
vi.mock('../../src/services/export/exportService', () => ({
  exportarGastosDoMesCSV: vi.fn(),
  exportarDividasCSV: vi.fn(),
}));
vi.mock('../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));

import {
  exportarGastosDoMesCSV,
  exportarDividasCSV,
} from '../../src/services/export/exportService';
import { getCategoryMap } from '../../src/services/categories/categoryCache';

const mockExportarGastos = vi.mocked(exportarGastosDoMesCSV);
const mockExportarDividas = vi.mocked(exportarDividasCSV);
const mockGetCategoryMap = vi.mocked(getCategoryMap);

/** Builder encadeado que resolve com { data, error } (single/maybeSingle customizáveis). */
function builderCom(
  data: unknown,
  error: unknown = null,
  opts: { single?: unknown; maybeSingle?: unknown } = {}
) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: opts.maybeSingle ?? null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: opts.single ?? null, error: null })),
  };
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onFulfilled);
  return builder;
}

function criarBotMock() {
  const bot = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 2 }),
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
  mockFrom.mockReset();
});

describe('messageHandler — comando /exportar', () => {
  it('deve enviar o CSV de gastos do mês via sendDocument', async () => {
    const buffer = Buffer.from('ID;Descrição\r\n1;Mercado');
    mockExportarGastos.mockResolvedValue({
      nome: 'gastos-2026-09.csv',
      buffer,
      linhas: 1,
    });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/exportar'), bot);

    expect(mockExportarGastos).toHaveBeenCalledWith(expect.any(String));
    expect(bot.sendDocument).toHaveBeenCalledTimes(1);
    const [chatId, doc, options, fileOptions] = bot.sendDocument.mock.calls[0];
    expect(chatId).toBe(999);
    expect(doc).toBe(buffer);
    expect((options as any).caption).toContain('Gastos de');
    expect(fileOptions).toEqual({
      filename: 'gastos-2026-09.csv',
      contentType: 'text/csv',
    });
  });

  it('deve avisar quando não há gastos no mês', async () => {
    mockExportarGastos.mockResolvedValue({
      nome: 'gastos-2026-09.csv',
      buffer: Buffer.from(''),
      linhas: 0,
    });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/exportar'), bot);

    expect(bot.sendDocument).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('Nenhum gasto'));
  });

  it('deve exportar dívidas com /exportar dividas', async () => {
    mockExportarDividas.mockResolvedValue({
      nome: 'dividas.csv',
      buffer: Buffer.from('Pessoa;Saldo Devido\r\nIrmã;70,00'),
      linhas: 1,
    });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/exportar dividas'), bot);

    expect(mockExportarDividas).toHaveBeenCalledWith(expect.any(String));
    expect(mockExportarGastos).not.toHaveBeenCalled();
    const fileOptions = bot.sendDocument.mock.calls[0][3];
    expect(fileOptions).toEqual({ filename: 'dividas.csv', contentType: 'text/csv' });
  });

  it('deve mostrar uso para argumento desconhecido', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/exportar xyz'), bot);

    expect(mockExportarGastos).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('Use assim'));
  });

  it('deve responder com erro genérico quando a exportação falha', async () => {
    mockExportarGastos.mockRejectedValue(new Error('supabase fora do ar'));

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/exportar'), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '❌ Não consegui gerar o CSV. Tente novamente.');
  });
});

describe('messageHandler — comando /recorrente', () => {
  it('deve listar as recorrências cadastradas', async () => {
    mockFrom.mockImplementationOnce(() =>
      builderCom([
        {
          id: 'r1',
          description: 'Netflix',
          total_amount: 39.9,
          category_id: 5,
          payment_method: 'credit_card',
          my_share_amount: null,
          day_of_month: 15,
          is_active: true,
          last_generated_month: null,
        },
      ])
    );
    mockGetCategoryMap.mockResolvedValue({ 5: 'Assinaturas' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente'), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Despesas recorrentes');
    expect(texto).toContain('Netflix');
    expect(texto).toContain('Dia 15');
    expect(texto).toContain('Assinaturas');
  });

  it('deve adicionar uma recorrência com /recorrente add', async () => {
    mockGetCategoryMap.mockResolvedValue({ 5: 'Assinaturas' });
    const insertBuilder = builderCom(null);
    mockFrom.mockImplementationOnce(() => insertBuilder);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente add Netflix 39,90 15 Assinaturas'), bot);

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Netflix',
        total_amount: 39.9,
        category_id: 5,
        day_of_month: 15,
        is_active: true,
      })
    );
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Recorrência adicionada');
  });

  it('deve mostrar uso quando faltam argumentos no add', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente add'), bot);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('Use assim'));
  });

  it('deve desativar uma recorrência com /recorrente remover <id>', async () => {
    const removerBuilder = builderCom(null, null, { maybeSingle: { description: 'Netflix' } });
    mockFrom.mockImplementationOnce(() => removerBuilder);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente remover r1'), bot);

    expect(removerBuilder.update).toHaveBeenCalledWith({ is_active: false });
    expect(removerBuilder.eq).toHaveBeenCalledWith('id', 'r1');
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('desativada');
  });

  it('deve avisar quando o id não é encontrado', async () => {
    const removerBuilder = builderCom(null, null, { maybeSingle: null });
    mockFrom.mockImplementationOnce(() => removerBuilder);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente remover inexistente'), bot);

    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Não encontrei');
  });

  it('deve mostrar uso para subcomando desconhecido', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/recorrente foo'), bot);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('Use assim'));
  });
});