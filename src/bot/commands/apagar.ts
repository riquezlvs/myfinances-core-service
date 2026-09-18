import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { apagarTransacaoPorId } from '../../services/transactions/transactionService';
import { RODAPE_UX } from '../../config/constants';
import { buildPosExclusaoKeyboard } from '../keyboards/transactionKeyboard';

export async function handleApagar(
  chatId: number,
  argumento: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const id = parseInt(argumento.trim(), 10);

  if (!Number.isFinite(id)) {
    await bot.sendMessage(
      chatId,
      '🗑 *Como apagar um lançamento:*\n\n' +
        'Uso: `/apagar <id>`\n\n' +
        '📌 *Exemplo:* `/apagar 42`\n\n' +
        '💡 _Dica: Você encontra o número #ID nos seus lançamentos recentes usando `/gastos` ou `/fatura`._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const resultado = await apagarTransacaoPorId(id, requestId);

  if (!resultado.apagou) {
    await bot.sendMessage(
      chatId,
      `❓ Não encontrei nenhum gasto com o ID #${id}.\n\nUse \`/gastos\` para consultar os lançamentos recentes.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const mensagem =
    resultado.displayIds.length > 1
      ? `✅ Gasto #${id} fazia parte de uma compra parcelada — todas as ${resultado.displayIds.length} parcelas foram removidas (#${resultado.displayIds.join(
          ', #'
        )}).`
      : `✅ Gasto #${id} apagado.`;

  await bot.sendMessage(chatId, `${mensagem}\n\n${RODAPE_UX}`, {
    reply_markup: buildPosExclusaoKeyboard(),
  });
}
