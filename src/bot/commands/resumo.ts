import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getResumoMensal, getGastosDiariosDoMes } from '../../services/transactions/transactionService';
import { formatarReal } from '../../utils/formatters';
import { gerarSparklineMensal } from '../../utils/sparklines';

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

export async function handleResumo(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const [r, gastosPorDia] = await Promise.all([
    getResumoMensal(requestId),
    getGastosDiariosDoMes(requestId),
  ]);

  // Fase 5: sparkline unicode da evolução diária de gastos no mês.
  const ultimoDia = gastosPorDia.length || 1;
  const sparkline = gerarSparklineMensal(gastosPorDia, ultimoDia);

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
      r.quantidade > 0 ? `📈 Evolução diária:\n${sparkline}` : '',
      '',
      '📂 *Por método de pagamento:*',
      ...linhasPorMetodo,
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
}
