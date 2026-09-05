import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getSaldoTerceiros } from '../../services/debts/debtService';
import { formatarReal } from '../../utils/formatters';

export async function handleDividas(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const saldos = await getSaldoTerceiros(requestId);
  if (saldos.length === 0) {
    await bot.sendMessage(chatId, '✅ Ninguém te deve nada no momento.');
    return;
  }
  const linhas = saldos.map((s) => `👤 ${s.nome}: R$ ${formatarReal(s.valor)}`);
  await bot.sendMessage(chatId, ['💰 *Quem te deve:*', '', ...linhas].join('\n'), { parse_mode: 'Markdown' });
}
