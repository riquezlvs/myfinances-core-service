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
    await bot.sendMessage(
      chatId,
      '🤝 *Como dar baixa em um pagamento:*\n\n' +
        'Uso: `/pago <nome> [valor]`\n\n' +
        '📌 *Exemplos:*\n' +
        '• `/pago Irmã` → Quita todo o valor que a pessoa devia.\n' +
        '• `/pago Irmã 25` → Dá baixa parcial de R$ 25,00.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const resultado = await processarPagamento(nome, valor, requestId);
  await bot.sendMessage(chatId, formatarPagamento(resultado));
}
