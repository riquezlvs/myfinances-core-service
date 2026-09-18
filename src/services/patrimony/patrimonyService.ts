import { withTiming } from '../../utils/logger';
import { listarContas } from '../accounts/accountService';
import { calcularRendimentoCdi, obterTaxaCdiDiaria } from '../investments/yieldService';
import { obterCarteiraComCotacoes } from '../investments/assetPriceService';
import { listarCartoes, calcularPeriodoFatura, getFaturaDoPeriodo } from '../cards/cardService';
import { formatarReal } from '../../utils/formatters';
import { gerarBarraTexto } from '../../utils/sparklines';
import type { PatrimonySummary } from '../../types/investment';
import type { Account } from '../../types/account';

/**
 * Consolida a visão completa do Patrimônio do usuário.
 */
export async function obterResumoPatrimonio(requestId: string = 'resumo-patrimonio'): Promise<PatrimonySummary> {
  return withTiming('consolidar patrimônio', { requestId }, async () => {
    const contas = await listarContas(requestId);
    const taxaDiDiaria = await obterTaxaCdiDiaria(requestId);

    // 1. Ativos Líquidos (Contas Correntes)
    const contasChecking = contas.filter((c) => c.type === 'checking');
    const totalLiquid = contasChecking.reduce((acc, c) => acc + Number(c.balance), 0);

    // 2. Benefícios (VR / VA)
    const contasBenefit = contas.filter((c) => c.type === 'benefit');
    const totalBenefit = contasBenefit.reduce((acc, c) => acc + Number(c.balance), 0);

    // 3. Renda Fixa / Caixinhas
    const contasFixed = contas.filter((c) => c.type === 'fixed_income');
    let totalFixedGross = 0;
    let totalFixedNet = 0;
    const fixedDetails = [];

    for (const c of contasFixed) {
      const saldo = Number(c.balance);
      const cdiRate = Number(c.cdi_rate) || 100;
      const dataInicio = c.start_date ? new Date(c.start_date) : new Date(Date.now() - 30 * 86400000);
      const rend = calcularRendimentoCdi(saldo, cdiRate, dataInicio, new Date(), taxaDiDiaria);

      const estimatedNet = Math.round((saldo + rend.netAmount) * 100) / 100;
      totalFixedGross += saldo;
      totalFixedNet += estimatedNet;

      fixedDetails.push({
        name: c.name,
        balance: saldo,
        cdiRate,
        estimatedNetBalance: estimatedNet,
        accumulatedYield: rend.grossAmount,
      });
    }

    // 4. Renda Variável
    const { assets, totalInvested, totalMarketValue, totalProfitLoss } = await obterCarteiraComCotacoes(requestId);

    // 5. Passivos (Faturas Abertas de Cartão)
    const cartoes = await listarCartoes(requestId);
    const cartoesCredito = cartoes.filter((c) => c.card_type === 'credit');
    const primeiroCreditoId = cartoesCredito[0]?.id;

    let totalFaturas = 0;
    const faturasDetalhes = [];

    for (const c of cartoesCredito) {
      const periodo = calcularPeriodoFatura(c.closing_day);
      const incluirSemCartao = c.id === primeiroCreditoId;
      const itens = await getFaturaDoPeriodo(c.id, periodo, incluirSemCartao, requestId);
      const subtotal = itens.reduce((s, i) => s + Number(i.total_amount), 0);
      totalFaturas += subtotal;
      faturasDetalhes.push({ name: c.name, amount: subtotal });
    }

    totalFaturas = Math.round(totalFaturas * 100) / 100;

    // Total Patrimônio Líquido:
    // (Líquido + VR + Caixinhas Líquidas + Renda Variável a Mercado) - Faturas Abertas
    const totalAtivos = totalLiquid + totalBenefit + totalFixedNet + totalMarketValue;
    const totalNetWorth = Math.round((totalAtivos - totalFaturas) * 100) / 100;

    return {
      totalNetWorth,
      liquidAssets: {
        total: Math.round(totalLiquid * 100) / 100,
        accounts: contasChecking.map((c) => ({ name: c.name, type: c.type, balance: Number(c.balance) })),
      },
      benefits: {
        total: Math.round(totalBenefit * 100) / 100,
        accounts: contasBenefit.map((c) => ({ name: c.name, balance: Number(c.balance) })),
      },
      fixedIncome: {
        totalGross: Math.round(totalFixedGross * 100) / 100,
        totalNet: Math.round(totalFixedNet * 100) / 100,
        accounts: fixedDetails,
      },
      variableIncome: {
        totalMarketValue,
        totalInvested,
        totalProfitLoss,
        assets,
      },
      openCreditInvoices: {
        total: totalFaturas,
        cards: faturasDetalhes,
      },
    };
  });
}

/**
 * Formata o resumo de patrimônio em Markdown rico para o Telegram.
 */
/**
 * Formata o resumo de patrimônio em Markdown rico para o Telegram.
 * Apresenta estrutura em blocos: Ativos vs Passivos = Patrimônio Líquido,
 * destaque de Liquidez Imediata Livre (Safe-to-Spend) e distribuição percentual
 * com barras visuais por classe de ativo.
 */
export function formatarMensagemPatrimonio(summary: PatrimonySummary): string {
  const totalLiquid = summary.liquidAssets.total;
  const totalBenefits = summary.benefits.total;
  const totalFixedNet = summary.fixedIncome.totalNet;
  const totalVariable = summary.variableIncome.totalMarketValue;
  const totalAtivos = totalLiquid + totalBenefits + totalFixedNet + totalVariable;
  const totalPassivos = summary.openCreditInvoices.total;

  // Safe-to-Spend imediato da conta corrente
  const liquidezLivre = totalLiquid - totalPassivos;
  const liquidezLivreFmt = liquidezLivre >= 0
    ? `🟢 *R$ ${formatarReal(liquidezLivre)}*`
    : `🔴 *-R$ ${formatarReal(Math.abs(liquidezLivre))} (Atenção!)*`;

  const pct = (val: number): string => {
    if (totalAtivos <= 0) return '0%';
    const p = Math.round((val / totalAtivos) * 100);
    return `${p}%`;
  };

  const linhas: string[] = [];

  linhas.push('🏛 *SEU PATRIMÔNIO CONSOLIDADO*');
  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  linhas.push(`💰 *Patrimônio Líquido:* R$ ${formatarReal(summary.totalNetWorth)}`);
  linhas.push(`_(Total Ativos: R$ ${formatarReal(totalAtivos)} − Faturas: R$ ${formatarReal(totalPassivos)})_\n`);

  linhas.push(`💧 *Liquidez Imediata Livre:* ${liquidezLivreFmt}`);
  linhas.push(`_(Disponível em conta corrente após pagar as faturas abertas)_\n`);

  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  linhas.push('📊 *DISTRIBUIÇÃO DE ATIVOS*');
  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Contas Correntes
  const barraLiquid = gerarBarraTexto(totalLiquid, totalAtivos, 8);
  linhas.push(`\n🏦 *Contas Correntes:* R$ ${formatarReal(totalLiquid)} (${pct(totalLiquid)})`);
  linhas.push(`\`[${barraLiquid}]\``);
  if (summary.liquidAssets.accounts.length === 0) {
    linhas.push(`  _(Nenhuma conta corrente cadastrada)_`);
  } else {
    for (const a of summary.liquidAssets.accounts) {
      linhas.push(`  • ${a.name}: R$ ${formatarReal(a.balance)}`);
    }
  }

  // 2. Benefícios (VR / VA)
  const barraBenefits = gerarBarraTexto(totalBenefits, totalAtivos, 8);
  linhas.push(`\n🍽 *Benefícios (VR / VA):* R$ ${formatarReal(totalBenefits)} (${pct(totalBenefits)})`);
  linhas.push(`\`[${barraBenefits}]\``);
  if (summary.benefits.accounts.length === 0) {
    linhas.push(`  _(Nenhum cartão de benefício cadastrado)_`);
  } else {
    for (const b of summary.benefits.accounts) {
      linhas.push(`  • ${b.name}: R$ ${formatarReal(b.balance)}`);
    }
  }

  // 3. Caixinhas / Renda Fixa
  const barraFixed = gerarBarraTexto(totalFixedNet, totalAtivos, 8);
  linhas.push(`\n📈 *Caixinhas & Renda Fixa:* R$ ${formatarReal(totalFixedNet)} (${pct(totalFixedNet)})`);
  linhas.push(`\`[${barraFixed}]\``);
  if (summary.fixedIncome.accounts.length === 0) {
    linhas.push(`  _(Nenhuma caixinha cadastrada)_`);
  } else {
    for (const f of summary.fixedIncome.accounts) {
      linhas.push(
        `  • ${f.name} (${f.cdiRate}% CDI): R$ ${formatarReal(f.balance)} ` +
        `_(rendeu bruto +R$ ${formatarReal(f.accumulatedYield)})_`
      );
    }
  }

  // 4. Renda Variável
  const barraVar = gerarBarraTexto(totalVariable, totalAtivos, 8);
  linhas.push(`\n📊 *Renda Variável:* R$ ${formatarReal(totalVariable)} (${pct(totalVariable)})`);
  linhas.push(`\`[${barraVar}]\``);
  if (summary.variableIncome.assets.length === 0) {
    linhas.push(`  _(Nenhum ativo cadastrado)_`);
  } else {
    const rentPct = summary.variableIncome.totalInvested > 0
      ? Math.round((summary.variableIncome.totalProfitLoss / summary.variableIncome.totalInvested) * 10000) / 100
      : 0;
    const sinal = summary.variableIncome.totalProfitLoss >= 0 ? '+' : '';
    linhas.push(`  _Rentabilidade Total: ${sinal}R$ ${formatarReal(summary.variableIncome.totalProfitLoss)} (${sinal}${rentPct}%)_`);

    for (const asset of summary.variableIncome.assets) {
      const precoAtual = asset.current_price ?? asset.average_price;
      const s = (asset.profit_loss ?? 0) >= 0 ? '+' : '';
      linhas.push(
        `  • *${asset.ticker}*: ${asset.quantity}x a R$ ${formatarReal(precoAtual)} = R$ ${formatarReal(asset.market_value ?? 0)} (${s}${asset.profit_loss_pct}%)`
      );
    }
  }

  // 5. Passivos (Faturas Abertas)
  linhas.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  linhas.push('💳 *PASSIVOS & OBRIGAÇÕES*');
  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (totalPassivos > 0) {
    linhas.push(`*Total de Faturas a Pagar:* R$ ${formatarReal(totalPassivos)}`);
    for (const c of summary.openCreditInvoices.cards) {
      linhas.push(`  • ${c.name}: R$ ${formatarReal(c.amount)}`);
    }
  } else {
    linhas.push(`✅ _Nenhuma fatura de cartão em aberto no momento._`);
  }

  return linhas.join('\n');
}
