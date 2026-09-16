import type TelegramBot from 'node-telegram-bot-api';
import { withTiming } from '../../utils/logger';
import { calcularSafeToSpend, listarContas } from '../../services/accounts/accountService';
import { formatarReal } from '../../utils/formatters';

export async function handleSaldo(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  await withTiming('comando /saldo', { requestId, chatId }, async () => {
    const safeSummary = await calcularSafeToSpend(undefined, requestId);
    const contas = await listarContas(requestId);
    const beneficios = contas.filter((c) => c.type === 'benefit');

    const linhas: string[] = [];
    linhas.push('💳 *VISÃO DE SALDO & SAFE-TO-SPEND*\n');
    linhas.push(`🏦 *Conta:* ${safeSummary.accountName}`);
    linhas.push(`💵 *Saldo Real em Conta:* R$ ${formatarReal(safeSummary.realBalance)}`);
    linhas.push(`🧾 *Faturas de Cartão Abertas:* R$ ${formatarReal(safeSummary.openCreditInvoices)}`);

    if (safeSummary.safeToSpend >= 0) {
      linhas.push(`🟢 *Saldo Livre para Gastar:* R$ ${formatarReal(safeSummary.safeToSpend)}`);
    } else {
      linhas.push(`🔴 *Saldo Livre Negativo:* -R$ ${formatarReal(Math.abs(safeSummary.safeToSpend))} (Atenção!)`);
    }

    if (beneficios.length > 0) {
      linhas.push('\n🍽 *Benefícios Pré-pagos:*');
      for (const b of beneficios) {
        linhas.push(`  • ${b.name}: R$ ${formatarReal(Number(b.balance))}`);
      }
    }

    linhas.push('\n_Dica: Use /ajustar\\_saldo <conta> <valor> para conciliar seu saldo atual._');

    await bot.sendMessage(chatId, linhas.join('\n'), {
      parse_mode: 'Markdown',
    });
  });
}
