import { getTelegramBot } from '../../clients/telegramClient';
import { apagarTransacaoPorId } from '../../services/transactions/transactionService';

const bot = getTelegramBot();

export async function handleApagar(chatId: number, argumento: string, requestId: string): Promise<void> {
  const id = parseInt(argumento.trim(), 10);

  if (!Number.isFinite(id)) {
    await bot.sendMessage(chatId, 'Use assim: /apagar 42  (o número aparece em /gastos ou /fatura)');
    return;
  }

  const resultado = await apagarTransacaoPorId(id, requestId);

  if (!resultado.apagou) {
    await bot.sendMessage(chatId, `❓ Não encontrei nenhum gasto com o ID #${id}.`);
    return;
  }

  const mensagem =
    resultado.displayIds.length > 1
      ? `✅ Gasto #${id} fazia parte de uma compra parcelada — todas as ${resultado.displayIds.length} parcelas foram removidas (#${resultado.displayIds.join(
          ', #'
        )}).`
      : `✅ Gasto #${id} apagado.`;

  await bot.sendMessage(chatId, mensagem);
}