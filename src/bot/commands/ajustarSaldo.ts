import type TelegramBot from 'node-telegram-bot-api';
import { withTiming } from '../../utils/logger';
import { ajustarSaldo, listarContas } from '../../services/accounts/accountService';
import { formatarReal } from '../../utils/formatters';

export async function handleAjustarSaldo(
  chatId: number,
  args: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  await withTiming('comando /ajustar_saldo', { requestId, args }, async () => {
    const partes = args.trim().split(/\s+/);
    if (partes.length < 2) {
      const contas = await listarContas(requestId);
      const lista = contas.map((c) => `• *${c.name}* (Atual: R$ ${formatarReal(Number(c.balance))})`).join('\n');
      await bot.sendMessage(
        chatId,
        `⚖️ *Como ajustar ou definir saldos:*\n\n` +
          `Uso: \`/ajustar_saldo <nome_da_conta> <valor>\`\n\n` +
          `📌 *Exemplos:*\n` +
          `• \`/ajustar_saldo Nubank 2500\`\n` +
          `• \`/ajustar_saldo VR 750,50\`\n\n` +
          `🏦 *Suas contas cadastradas:*\n${lista || '_Nenhuma conta encontrada_'}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const valorStr = partes.pop()!.replace(',', '.');
    const valor = parseFloat(valorStr);
    const nomeConta = partes.join(' ');

    if (isNaN(valor)) {
      await bot.sendMessage(
        chatId,
        '⚠️ *Valor inválido.* Informe um número válido.\n\n📌 Exemplo: `/ajustar_saldo Nubank 2500`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      const conta = await ajustarSaldo(nomeConta, valor, requestId);
      await bot.sendMessage(
        chatId,
        `✅ Saldo da conta *${conta.name}* ajustado com sucesso para *R$ ${formatarReal(Number(conta.balance))}*.`
      );
    } catch (err: any) {
      await bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  });
}
