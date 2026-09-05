import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { desfazerUltimaTransacao } from '../../services/transactions/transactionService';

export async function handleDesfazer(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const resultado = await desfazerUltimaTransacao(requestId);

  if (!resultado || resultado.displayIds.length === 0) {
    await bot.sendMessage(chatId, 'Não há nada para desfazer — nenhum gasto registrado ainda.');
    return;
  }

  const mensagem =
    resultado.displayIds.length > 1
      ? `✅ Compra parcelada desfeita (${resultado.displayIds.length} parcelas removidas: #${resultado.displayIds.join(
          ', #'
        )}).`
      : `✅ Gasto #${resultado.displayIds[0]} desfeito.`;

  await bot.sendMessage(chatId, mensagem);
}
