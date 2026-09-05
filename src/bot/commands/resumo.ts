import { getTelegramBot } from '../../clients/telegramClient';
import { getResumoMensal } from '../../services/transactions/transactionService';
import { formatarReal } from '../../utils/formatters';

const bot = getTelegramBot();

const EMOJI_METODO: Record<string, string> = {
  pix: '💠',
  credit_card: '💳',
  debit_card: '🏧',
};

const NOME_METODO: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

export async function handleResumo(chatId: number, requestId: string): Promise<void> {
  const r = await getResumoMensal(requestId);

  const linhasPorMetodo = r.porMetodo.length
    ? r.porMetodo.map(
        (m) =>
          `   ${EMOJI_METODO[m.metodo] ?? '💰'} ${NOME_METODO[m.metodo] ?? m.metodo.replace(/_/g, ' ')}: R$ ${formatarReal(m.total)}`
      )
    : ['   (nenhum lançamento no mês)'];

  await bot.sendMessage(
    chatId,
    [
      '📊 *Resumo do mês*',
      '',
      `💸 Meus gastos reais: R$ ${formatarReal(r.meuGastoReal)}`,
      `🔁 Recorrentes (minha parte): R$ ${formatarReal(r.gastosRecorrentes)}`,
      `🧾 Lançamentos no mês: ${r.quantidade}`,
      '',
      '📂 *Por método de pagamento:*',
      ...linhasPorMetodo,
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
}