import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';

const bot = getTelegramBot();

/**
 * Placeholder para o objetivo 7 (Áudio). Por enquanto apenas confirma o
 * recebimento — quando a transcrição (Speech-to-Text) for implementada,
 * o texto resultante deve ser repassado para o mesmo fluxo de
 * classificarIntencao() usado em messageHandler.ts.
 */
export async function voiceHandler(msg: Message): Promise<void> {
  const requestId = randomUUID();
  const chatId = msg.chat.id;

  log('info', '🎙️ Mensagem de voz recebida (transcrição ainda não implementada)', {
    requestId,
    chatId,
    userId: msg.from?.id,
    duracao_segundos: msg.voice?.duration,
  });

  if (msg.from?.id !== AUTHORIZED_USER_ID) {
    await bot.sendMessage(chatId, '🚫 Acesso negado.');
    return;
  }

  await bot.sendMessage(
    chatId,
    '🎙️ Recebi seu áudio! A transcrição automática de voz ainda não está pronta — ' +
      'por enquanto, me manda o gasto em texto 🙂'
  );
}