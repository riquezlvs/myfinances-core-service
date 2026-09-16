import { getTelegramBot } from '../clients/telegramClient';
import { log } from '../utils/logger';
import { GEMINI_MODEL } from '../config/constants';
import { messageHandler } from './handlers/messageHandler';
import { voiceHandler } from './handlers/voiceHandler';
import { photoHandler } from './handlers/photoHandler';
import { callbackQueryHandler } from './handlers/callbackQueryHandler';
import { setupCommands } from './setupCommands';
import { configureBot } from './setupBot';
import { iniciarCronRecorrencias } from '../services/recurring/recurringService';
import { iniciarCronLembreteMensal } from '../services/recurring/proactiveService';
import { mensagemDuplicada } from '../utils/dedupe';

/**
 * Monta o bot: registra todos os listeners, configura o menu nativo e
 * inicia os crons (recorrências diárias + lembrete mensal proativo).
 * Retorna a função de shutdown para encerramento limpo (SIGINT/SIGTERM).
 */
export async function iniciarBot(): Promise<{ shutdown: () => Promise<void> }> {
  const bot = getTelegramBot();

  // 1. Limpeza defensiva de webhook: se algum webhook estiver configurado na API do Telegram,
  // o Telegram bloqueia completamente o long polling (getUpdates) retornando erro 409 Conflict.
  try {
    const webhookInfo = await bot.getWebHookInfo();
    if (webhookInfo?.url) {
      log('warn', `⚠️ Webhook ativo detectado em "${webhookInfo.url}". Removendo para habilitar long polling...`);
      await bot.deleteWebHook();
      log('info', '✅ Webhook removido com sucesso!');
    } else {
      log('info', 'ℹ️ Nenhum webhook ativo no Telegram. Polling desimpedido.');
    }
  } catch (err) {
    log('warn', 'Aviso ao consultar/limpar webhook do Telegram', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Identifica o bot autenticado (username e ID) para auditoria nos logs.
  let botUsername = 'desconhecido';
  try {
    const me = await bot.getMe();
    botUsername = me.username ? `@${me.username}` : `id:${me.id}`;
    log('info', `🤖 Bot autenticado no Telegram: ${botUsername} ("${me.first_name}", ID: ${me.id})`);
  } catch (err) {
    log('warn', 'Aviso ao consultar identidade do bot via getMe', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Registra listeners de erro antes de qualquer tráfego.
  bot.on('polling_error', (error) => {
    log('error', '⚠️ Erro de polling do Telegram', { erro: error.message });
  });
  bot.on('webhook_error', (error) => {
    log('error', '⚠️ Erro de webhook do Telegram', { erro: error.message });
  });
  bot.on('error', (error) => {
    log('error', '⚠️ Erro geral do bot do Telegram', { erro: error.message });
  });

  // 4. Registra listeners de mensagens e callbacks.
  bot.on('message', (msg) => {
    // Fase 8: dedupe FIFO — reentregas do Telegram não podem disparar duas
    // chamadas ao Gemini nem dois lançamentos no Supabase. Chave baseada em
    // metadados da mensagem (chatId + message_id), nunca em conteúdo/IA.
    const chave =
      msg.chat?.id != null && msg.message_id != null ? `${msg.chat.id}:${msg.message_id}` : undefined;
    if (mensagemDuplicada(chave)) return;

    // Fase 4: voz e áudio vão para o voiceHandler (transcrição multimodal
    // via Gemini); fotos/extratos vão para o photoHandler;
    // o messageHandler cuida de texto e do caso "sem texto".
    if (msg.voice || msg.audio) {
      void voiceHandler(msg);
      return;
    }

    if (msg.photo && msg.photo.length > 0) {
      void photoHandler(msg);
      return;
    }

    void messageHandler(msg);
  });

  bot.on('callback_query', (query) => {
    void callbackQueryHandler(query);
  });

  // 5. Configura identidade (nome, descrição, foto) e menu de comandos.
  await configureBot(bot);
  await setupCommands();

  // 6. Inicia os crons internos (recorrências diárias + lembrete mensal proativo).
  const cronRecorrencias = iniciarCronRecorrencias();
  const cronLembrete = iniciarCronLembreteMensal();

  // 7. Inicia o long polling agora que todos os listeners e limpezas estão prontos.
  if (!bot.isPolling()) {
    await bot.startPolling();
  }

  log('info', '🚀 Bot iniciado e escutando mensagens via long polling...', {
    bot: botUsername,
    modelo: GEMINI_MODEL,
  });

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