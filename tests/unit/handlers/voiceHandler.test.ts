import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { voiceHandler } from '../../../src/bot/handlers/voiceHandler';
import { MAX_AUDIO_DURATION_SECONDS } from '../../../src/config/constants';

// Mocks dos colaboradores do voiceHandler.
vi.mock('../../../src/services/gemini/audioParser', () => ({
  interpretarAudio: vi.fn(),
}));
vi.mock('../../../src/bot/handlers/novoGasto', () => ({
  registrarEResponderGasto: vi.fn(),
}));

import { interpretarAudio } from '../../../src/services/gemini/audioParser';
import { registrarEResponderGasto } from '../../../src/bot/handlers/novoGasto';

const mockInterpretarAudio = vi.mocked(interpretarAudio);
const mockRegistrarEResponder = vi.mocked(registrarEResponderGasto);

const URL_FIXA = 'https://api.telegram.org/file/bot-test/voice/1';

function criarBotMock() {
  const bot = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue(true),
    getFileLink: vi.fn().mockResolvedValue(URL_FIXA),
    on: vi.fn(),
  };
  return bot as unknown as TelegramBot & typeof bot;
}

function criarMensagemVoz(
  overrides: Partial<{ duration: number; fileId: string; mimeType: string; userId: number }> = {}
): Message {
  const { duration = 30, fileId = 'file-voice-1', mimeType = 'audio/ogg', userId = 12345 } = overrides;
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 999, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Teste' },
    voice: { file_id: fileId, duration, mime_type: mimeType, file_size: 50000 },
  } as unknown as Message;
}

/** Restaura o fetch real após cada teste que o mocka. */
const fetchReal = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = fetchReal;
});

describe('voiceHandler', () => {
  it('deve rejeitar usuário não autorizado sem baixar nada', async () => {
    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz({ userId: 99999 }), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '🚫 Acesso negado.');
    expect(bot.getFileLink).not.toHaveBeenCalled();
    expect(mockInterpretarAudio).not.toHaveBeenCalled();
  });

  it('deve avisar quando o áudio excede o limite de duração', async () => {
    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz({ duration: MAX_AUDIO_DURATION_SECONDS + 1 }), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('muito longo'));
    expect(bot.getFileLink).not.toHaveBeenCalled();
  });

  it('deve processar áudio de gasto: baixa, envia ao Gemini e registra com botões', async () => {
    const buffer = Buffer.from('audio-ogg-fake');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)),
    } as unknown as Response);

    mockInterpretarAudio.mockResolvedValue({
      intent: 'NOVO_GASTO',
      transcricao: 'Gastei 45 no almoço no pix',
      transaction: {
        description: 'Almoço',
        total_amount: 45,
        category_id: 1,
        payment_method: 'pix',
        occurred_at: '2026-09-05T12:00:00.000Z',
      },
    });

    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz(), bot);

    // Fluxo de download: getFileLink + fetch no link (com timeout de 30s).
    expect(bot.getFileLink).toHaveBeenCalledWith('file-voice-1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      URL_FIXA,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    // Áudio vai ao Gemini como buffer, com o mimeType do Telegram.
    expect(mockInterpretarAudio).toHaveBeenCalledWith(buffer, 'audio/ogg', expect.any(String));

    // Reaproveita o MESMO fluxo do texto (com botões interativos).
    expect(mockRegistrarEResponder).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ description: 'Almoço', total_amount: 45 }),
      '[áudio] Gastei 45 no almoço no pix',
      expect.any(String),
      bot
    );
    // Nenhuma mensagem avulsa: a confirmação vem de registrarEResponderGasto.
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('deve mostrar a transcrição e orientar quando a intenção não é gasto', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response);

    mockInterpretarAudio.mockResolvedValue({
      intent: 'CONSULTA',
      transcricao: 'quanto gastei esse mês',
      transaction: null,
    });

    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz(), bot);

    expect(mockRegistrarEResponder).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('quanto gastei esse mês');
  });

  it('deve responder erro amigável quando o download falha (HTTP)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz(), bot);

    expect(mockInterpretarAudio).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('Não consegui processar seu áudio'));
  });

  it('deve responder erro amigável quando o Gemini falha', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response);

    mockInterpretarAudio.mockRejectedValue(new Error('Gemini fora do ar'));

    const bot = criarBotMock();
    await voiceHandler(criarMensagemVoz(), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Não consegui processar seu áudio');
    expect(texto).not.toContain('Gemini fora do ar'); // não vaza detalhe interno
  });

  it('deve usar audio/ogg como mimeType padrão quando o Telegram omitir', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    } as unknown as Response);

    mockInterpretarAudio.mockResolvedValue({ intent: 'OUTROS', transcricao: 'oi', transaction: null });

    const msg = criarMensagemVoz() as unknown as Message & { voice: { mime_type?: string } };
    delete msg.voice.mime_type;

    const bot = criarBotMock();
    await voiceHandler(msg, bot);

    expect(mockInterpretarAudio).toHaveBeenCalledWith(expect.any(Buffer), 'audio/ogg', expect.any(String));
  });

  it('deve avisar quando a mensagem não tem voice nem audio', async () => {
    const bot = criarBotMock();
    const msg = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 999, type: 'private' },
      from: { id: 12345, is_bot: false, first_name: 'Teste' },
    } as unknown as Message;

    await voiceHandler(msg, bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, expect.stringContaining('voz ou áudio'));
  });
});