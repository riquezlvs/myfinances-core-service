import { getTelegramBot } from '../clients/telegramClient';
import { log } from '../utils/logger';
import { GEMINI_MODEL } from '../config/constants';
import { messageHandler } from './handlers/messageHandler';
import { voiceHandler } from './handlers/voiceHandler';
import { callbackQueryHandler } from './handlers/callbackQueryHandler';
import { setupCommands } from './setupCommands';

/**
 * Monta o bot: registra todos os listeners e configura o menu nativo.
 * Mantido fino de propósito — toda regra de negócio vive em services/, e
 * o roteamento de comandos/intenção vive em handlers/.
 */
export async function iniciarBot(): Promise<void> {
  const bot = getTelegramBot();

  bot.on('message', (msg) => {
    // Mensagens de voz têm listener dedicado (bot.on('voice')); o
    // messageHandler cuida de texto e do caso "sem texto" genérico.
    if (msg.voice) return;
    void messageHandler(msg);
  });

  bot.on('voice', (msg) => {
    void voiceHandler(msg);
  });

  bot.on('callback_query', (query) => {
    void callbackQueryHandler(query);
  });

  bot.on('polling_error', (error) => {
    log('error', '⚠️ Erro de polling do Telegram', { erro: error.message });
  });

  await setupCommands();

  log('info', '🚀 Bot iniciado e escutando mensagens via long polling...', { modelo: GEMINI_MODEL });
}