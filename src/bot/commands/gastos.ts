import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getUltimosGastos } from '../../services/transactions/transactionService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';

export async function handleGastos(
  chatId: number,
  limite: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const gastos = await getUltimosGastos(limite, requestId);
  if (gastos.length === 0) {
    await bot.sendMessage(chatId, 'Nenhum gasto registrado ainda.');
    return;
  }

  const linhas = gastos.map((g: any) => {
    const categoria = g.categories?.name ?? '—';
    return `#${g.display_id} · 📅 ${formatarDataCurta(g.occurred_at)} · ${g.description} · R$ ${formatarReal(
      Number(g.total_amount)
    )} · ${categoria} · ${g.payment_method}`;
  });

  await bot.sendMessage(
    chatId,
    [
      `🧾 Últimos ${gastos.length} gastos:`,
      '',
      ...linhas,
      '',
      'Use /apagar <id> para remover um específico.',
    ].join('\n')
  );
}
