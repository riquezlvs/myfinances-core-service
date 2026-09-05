import { getTelegramBot } from '../../clients/telegramClient';
import { getFaturaMensal } from '../../services/transactions/transactionService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';

const bot = getTelegramBot();

export async function handleFatura(chatId: number, requestId: string): Promise<void> {
  const itens = await getFaturaMensal(requestId);

  if (itens.length === 0) {
    await bot.sendMessage(chatId, '✅ Nenhum lançamento no cartão de crédito este mês.');
    return;
  }

  const linhas = itens.map((item) => {
    const parcelaTag =
      item.installment_number && item.installment_total
        ? ` (${item.installment_number}/${item.installment_total})`
        : '';
    return `#${item.display_id} · ${formatarDataCurta(item.occurred_at)} · ${item.description}${parcelaTag} — R$ ${formatarReal(
      Number(item.total_amount)
    )}`;
  });

  const total = itens.reduce((soma, item) => soma + Number(item.total_amount), 0);

  await bot.sendMessage(
    chatId,
    ['💳 *Fatura do cartão (mês atual)*', '', ...linhas, '', `*Total: R$ ${formatarReal(total)}*`].join('\n'),
    { parse_mode: 'Markdown' }
  );
}