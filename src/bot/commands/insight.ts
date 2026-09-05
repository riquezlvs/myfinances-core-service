import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { gerarInsight } from '../../services/gemini/insightService';

/**
 * Fase 5 — /insight: agrega os dados do mês e pede ao Gemini uma análise
 * em linguagem natural do padrão de gastos (observações + conselhos).
 */
export async function handleInsight(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  try {
    await bot.sendChatAction(chatId, 'typing');
    const texto = await gerarInsight(requestId);
    await bot.sendMessage(chatId, `🤖 *Insight do mês:*\n\n${texto}`, { parse_mode: 'Markdown' });
  } catch (err) {
    log('error', 'Erro ao gerar insight', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui gerar o insight agora. Tente novamente.');
  }
}