import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getFaturaMensal } from '../../services/transactions/transactionService';
import {
  listarCartoes,
  calcularPeriodoFatura,
  getFaturaDoPeriodo,
  type PeriodoFatura,
} from '../../services/cards/cardService';
import {
  buscarRecorrenciasAtivasCredito,
  type RecurringTransactionRow,
} from '../../services/recurring/recurringService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';
import { RODAPE_UX } from '../../config/constants';

interface ItemFatura {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  installment_number: number | null;
  installment_total: number | null;
}

export interface RecorrenciaPrevista {
  id: string;
  description: string;
  total_amount: number;
  dataPrevista: Date;
}

function formatarItens(itens: ItemFatura[]): string[] {
  return itens.map((item) => {
    const jaTemParcela = /\(\d+\/\d+\)\s*$/.test(item.description);
    const parcelaTag =
      !jaTemParcela && item.installment_number && item.installment_total
        ? ` (${item.installment_number}/${item.installment_total})`
        : '';
    return `#${item.display_id} · ${formatarDataCurta(item.occurred_at)} · ${item.description}${parcelaTag} — R$ ${formatarReal(
      Number(item.total_amount)
    )}`;
  });
}

function formatarRecorrenciasPrevistas(recorrencias: RecorrenciaPrevista[]): string[] {
  return recorrencias.map((rec) => {
    return `⏳ ${formatarDataCurta(rec.dataPrevista.toISOString())} · ${rec.description} (recorrente) — R$ ${formatarReal(
      Number(rec.total_amount)
    )}`;
  });
}

/**
 * Determina quais recorrências ativas de cartão de crédito caem dentro do período da fatura
 * e ainda não foram materializadas (ou seja, ainda não ocorreram ou ainda não foram geradas).
 */
export function filtrarRecorrenciasPrevistas(
  recorrencias: RecurringTransactionRow[],
  periodo: PeriodoFatura,
  agora = new Date()
): RecorrenciaPrevista[] {
  const previstas: RecorrenciaPrevista[] = [];
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  for (const rec of recorrencias) {
    // Verifica os meses envolvidos no ciclo da fatura (mês de início e mês de fechamento)
    const anoInicio = periodo.inicio.getFullYear();
    const mesInicio = periodo.inicio.getMonth();
    const anoFim = periodo.fim.getFullYear();
    const mesFim = periodo.fim.getMonth();

    const mesesParaChecar = [
      { ano: anoInicio, mes: mesInicio },
      ...(anoInicio !== anoFim || mesInicio !== mesFim ? [{ ano: anoFim, mes: mesFim }] : []),
    ];

    for (const { ano, mes } of mesesParaChecar) {
      const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      const diaEfetivo = Math.min(rec.day_of_month, ultimoDia);
      const dataPrevista = new Date(ano, mes, diaEfetivo);

      // A data prevista deve estar dentro do período da fatura [inicio, fim)
      if (dataPrevista >= periodo.inicio && dataPrevista < periodo.fim) {
        // Se a data prevista for estritamente futura em relação a 'hoje', ainda não foi materializada
        if (dataPrevista > hoje) {
          previstas.push({
            id: rec.id,
            description: rec.description,
            total_amount: Number(rec.total_amount),
            dataPrevista,
          });
        }
      }
    }
  }

  return previstas.sort((a, b) => a.dataPrevista.getTime() - b.dataPrevista.getTime());
}

export async function handleFatura(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  let itens: ItemFatura[];
  let titulo: string;
  let periodo: PeriodoFatura;
  let recorrenciasPrevistas: RecorrenciaPrevista[] = [];

  try {
    const cartoes = await listarCartoes(requestId);
    if (cartoes.length > 0) {
      const cartao = cartoes[0];
      periodo = calcularPeriodoFatura(cartao.closing_day);
      itens = await getFaturaDoPeriodo(cartao.id, periodo, true, requestId);
      const fecha = `${String(periodo.fechamento.getDate()).padStart(2, '0')}/${String(
        periodo.fechamento.getMonth() + 1
      ).padStart(2, '0')}`;
      titulo = `💳 *Fatura ${cartao.name}* (fecha ${fecha})`;
    } else {
      const hoje = new Date();
      periodo = {
        inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
        fim: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1),
        fechamento: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0),
      };
      itens = (await getFaturaMensal(requestId)) as ItemFatura[];
      titulo = '💳 *Fatura do cartão (mês atual)*';
    }

    const recorrenciasCredito = await buscarRecorrenciasAtivasCredito(requestId);
    recorrenciasPrevistas = filtrarRecorrenciasPrevistas(recorrenciasCredito, periodo);
  } catch (err) {
    log('error', 'Erro ao montar fatura', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui buscar a fatura. Tente novamente.');
    return;
  }

  if (itens.length === 0 && recorrenciasPrevistas.length === 0) {
    await bot.sendMessage(chatId, '✅ Nenhum lançamento ou recorrência no cartão de crédito neste período.');
    return;
  }

  const totalLancado = itens.reduce((soma, item) => soma + Number(item.total_amount), 0);
  const totalPrevistoRecorrencias = recorrenciasPrevistas.reduce(
    (soma, rec) => soma + Number(rec.total_amount),
    0
  );

  const blocos: string[] = [titulo, ''];

  if (itens.length > 0) {
    blocos.push('*Lançamentos realizados:*');
    blocos.push(...formatarItens(itens));
    blocos.push('');
  }

  if (recorrenciasPrevistas.length > 0) {
    blocos.push('*Recorrências previstas até o fechamento:*');
    blocos.push(...formatarRecorrenciasPrevistas(recorrenciasPrevistas));
    blocos.push('');
  }

  if (recorrenciasPrevistas.length > 0 && itens.length > 0) {
    blocos.push(`*Lançado:* R$ ${formatarReal(totalLancado)}`);
    blocos.push(`*Previsto (recorrências):* R$ ${formatarReal(totalPrevistoRecorrencias)}`);
    blocos.push(`*Total estimado:* R$ ${formatarReal(totalLancado + totalPrevistoRecorrencias)}`);
  } else if (recorrenciasPrevistas.length > 0) {
    blocos.push(`*Total previsto (recorrências): R$ ${formatarReal(totalPrevistoRecorrencias)}*`);
  } else {
    blocos.push(`*Total: R$ ${formatarReal(totalLancado)}*`);
  }

  blocos.push('');
  blocos.push(RODAPE_UX);

  await bot.sendMessage(chatId, blocos.join('\n'), { parse_mode: 'Markdown' });
}