import { getTelegramBot } from '../clients/telegramClient';
import { log } from '../utils/logger';
import { GEMINI_MODEL } from '../config/constants';
import { messageHandler } from './handlers/messageHandler';
import { voiceHandler } from './handlers/voiceHandler';
import { callbackQueryHandler } from './handlers/callbackQueryHandler';
import { setupCommands } from './setupCommands';
import { iniciarCronRecorrencias } from '../services/recurring/recurringService';
import { iniciarCronLembreteMensal } from '../services/recurring/proactiveService';

/**
 * Monta o bot: registra todos os listeners, configura o menu nativo e
 * inicia os crons (recorrências diárias + lembrete mensal proativo).
 * Retorna a função de shutdown para encerramento limpo (SIGINT/SIGTERM).
 */
export async function iniciarBot(): Promise<{ shutdown: () => Promise<void> }> {
  const bot = getTelegramBot();

  bot.on('message', (msg) => {
    // Fase 4: voz e áudio vão para o voiceHandler (transcrição multimodal
    // via Gemini); o messageHandler cuida de texto e do caso "sem texto".
    if (msg.voice || msg.audio) {
      void voiceHandler(msg);
      return;
    }
    void messageHandler(msg);
  });

  bot.on('callback_query', (query) => {
    void callbackQueryHandler(query);
  });

  bot.on('polling_error', (error) => {
    log('error', '⚠️ Erro de polling do Telegram', { erro: error.message });
  });

  await setupCommands();

  // Fase 3: cron diário que materializa as despesas recorrentes do dia.
  const cronRecorrencias = iniciarCronRecorrencias();
  // Fase 6: cron proativo de lembrete mensal (fatura + dívidas).
  const cronLembrete = iniciarCronLembreteMensal();

  log('info', '🚀 Bot iniciado e escutando mensagens via long polling...', { modelo: GEMINI_MODEL });

  /**
   * Fase 6 — Graceful shutdown: para os crons, encerra o polling do
   * Telegram e libera o processo sem órfãos. Idempotente.
   */
  let desligado = false;
  const shutdown = async (): Promise<void> => {
    if (desligado) return;
    desligado = true;

    log('info', '🛑 Encerrando bot de forma limpa...');
    try {
      cronRecorrencias.stop();
      cronLembrete.stop();
      // node-telegram-bot-api: stopPolling() não recebe argumentos.
      await bot.stopPolling();
      log('info', '✅ Bot encerrado com sucesso.');
    } catch (err) {
      log('error', '⚠️ Erro durante o shutdown (seguindo adiante)', {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return { shutdown };
}