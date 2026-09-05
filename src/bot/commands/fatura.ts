import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getFaturaMensal } from '../../services/transactions/transactionService';
import {
  listarCartoes,
  calcularPeriodoFatura,
  getFaturaDoPeriodo,
  type ItemFaturaCartao,
} from '../../services/cards/cardService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';

interface ItemFatura {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  installment_number: number | null;
  installment_total: number | null;
}

function formatarItens(itens: ItemFatura[]): string[] {
  return itens.map((item) => {
    const parcelaTag =
      item.installment_number && item.installment_total
        ? ` (${item.installment_number}/${item.installment_total})`
        : '';
    return `#${item.display_id} · ${formatarDataCurta(item.occurred_at)} · ${item.description}${parcelaTag} — R$ ${formatarReal(
      Number(item.total_amount)
    )}`;
  });
}

export async function handleFatura(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  let itens: ItemFatura[];
  let titulo: string;

  try {
    // Fase 6: se houver cartão cadastrado, a fatura respeita o período
    // real de fechamento (não o mês civil). O primeiro cartão da lista é
    // o padrão e herda os gastos credit_card sem card_id.
    const cartoes = await listarCartoes(requestId);
    if (cartoes.length > 0) {
      const cartao = cartoes[0];
      const periodo = calcularPeriodoFatura(cartao.closing_day);
      itens = await getFaturaDoPeriodo(cartao.id, periodo, true, requestId);
      const fecha = `${String(periodo.fechamento.getDate()).padStart(2, '0')}/${String(
        periodo.fechamento.getMonth() + 1
      ).padStart(2, '0')}`;
      titulo = `💳 *Fatura ${cartao.name}* (fecha ${fecha})`;
    } else {
      // Sem cartões cadastrados: comportamento legado (mês civil).
      itens = (await getFaturaMensal(requestId)) as ItemFatura[];
      titulo = '💳 *Fatura do cartão (mês atual)*';
    }
  } catch (err) {
    log('error', 'Erro ao montar fatura', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui buscar a fatura. Tente novamente.');
    return;
  }

  if (itens.length === 0) {
    await bot.sendMessage(chatId, '✅ Nenhum lançamento no cartão de crédito neste período.');
    return;
  }

  const total = itens.reduce((soma, item) => soma + Number(item.total_amount), 0);

  await bot.sendMessage(
    chatId,
    [titulo, '', ...formatarItens(itens), '', `*Total: R$ ${formatarReal(total)}*`].join('\n'),
    { parse_mode: 'Markdown' }
  );
}