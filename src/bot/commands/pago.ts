import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { processarPagamento } from '../../services/debts/debtService';
import { separarNomeValor } from '../../utils/textParsers';
import { formatarPagamento } from '../../utils/formatters';

export async function handlePagoCommand(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const { nome, valor } = separarNomeValor(argumentos);

  if (!nome) {
    await bot.sendMessage(chatId, 'Use assim: /pago Irmã  ou  /pago Irmã 25');
    return;
  }

  const resultado = await processarPagamento(nome, valor, requestId);
  await bot.sendMessage(chatId, formatarPagamento(resultado));
}
