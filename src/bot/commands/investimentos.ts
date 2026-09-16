import type TelegramBot from 'node-telegram-bot-api';
import { withTiming } from '../../utils/logger';
import { listarContas } from '../../services/accounts/accountService';
import { calcularRendimentoCdi, obterTaxaCdiDiaria } from '../../services/investments/yieldService';
import { obterCarteiraComCotacoes } from '../../services/investments/assetPriceService';
import { formatarReal } from '../../utils/formatters';

export async function handleInvestimentos(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  await withTiming('comando /investimentos', { requestId, chatId }, async () => {
    const contas = await listarContas(requestId);
    const caixinhas = contas.filter((c) => c.type === 'fixed_income');
    const taxaDiDiaria = await obterTaxaCdiDiaria(requestId);
    const { assets, totalInvested, totalMarketValue, totalProfitLoss } = await obterCarteiraComCotacoes(requestId);

    const linhas: string[] = [];
    linhas.push('📈 *SEUS INVESTIMENTOS & RENDIMENTOS*\n');

    // 1. Caixinhas / Renda Fixa
    linhas.push('📦 *Caixinhas & Renda Fixa (% CDI):*');
    if (caixinhas.length === 0) {
      linhas.push('  _(Nenhuma caixinha cadastrada. Dica: cadastre sua Caixinha Nubank com taxa CDI!)_');
    } else {
      for (const c of caixinhas) {
        const saldo = Number(c.balance);
        const cdiRate = Number(c.cdi_rate) || 100;
        const dataInicio = c.start_date ? new Date(c.start_date) : new Date(Date.now() - 30 * 86400000);
        const rend = calcularRendimentoCdi(saldo, cdiRate, dataInicio, new Date(), taxaDiDiaria);

        linhas.push(`  • *${c.name}* (${cdiRate}% CDI)`);
        linhas.push(`    - Saldo Bruto: R$ ${formatarReal(saldo)}`);
        linhas.push(`    - Rendimento Bruto: +R$ ${formatarReal(rend.grossAmount)} (taxa do período: ${rend.effectiveRatePct}%)`);
        linhas.push(`    - Provisão IR (${rend.taxRatePct}%): -R$ ${formatarReal(rend.taxAmount)}`);
        linhas.push(`    - Saldo Líquido de Resgate: *R$ ${formatarReal(saldo + rend.netAmount)}*`);
      }
    }

    // 2. Renda Variável
    linhas.push('\n📊 *Renda Variável (Ações, FIIs, Cripto):*');
    if (assets.length === 0) {
      linhas.push('  _(Nenhum ativo cadastrado)_');
    } else {
      linhas.push(`  - Total Investido: R$ ${formatarReal(totalInvested)}`);
      linhas.push(`  - Valor a Mercado: R$ ${formatarReal(totalMarketValue)}`);
      const s = totalProfitLoss >= 0 ? '+' : '';
      linhas.push(`  - Resultado: *${s}R$ ${formatarReal(totalProfitLoss)}*`);
      linhas.push('');
      for (const a of assets) {
        const preco = a.current_price ?? a.average_price;
        const sinal = (a.profit_loss ?? 0) >= 0 ? '+' : '';
        linhas.push(`  • *${a.ticker}*: ${a.quantity} cotas | Preço: R$ ${formatarReal(preco)} | Total: R$ ${formatarReal(a.market_value ?? 0)} (${sinal}${a.profit_loss_pct}%)`);
      }
    }

    await bot.sendMessage(chatId, linhas.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Creditar Rendimentos CDI Agora', callback_data: 'patrimonio:atualizar_cdi' },
          ],
        ],
      },
    });
  });
}
