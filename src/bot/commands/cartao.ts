import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';
import {
  listarCartoes,
  definirCartao,
  removerCartao,
  calcularPeriodoFatura,
  getFaturaDoPeriodo,
} from '../../services/cards/cardService';

/**
 * Fase 6 — /cartao: gerencia múltiplos cartões com dia de fechamento.
 *
 * /cartao                     → lista os cartões com o período da fatura atual
 * /cartao add <nome> <dia>    → cria/atualiza um cartão
 * /cartao remover <nome>      → remove um cartão
 * /cartao fatura <nome>       → fatura do cartão no período real de fechamento
 */
export async function handleCartao(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);
  const sub = (partes[0] ?? '').toLowerCase();

  try {
    if (!sub || sub === 'listar') {
      await listar(chatId, requestId, bot);
      return;
    }
    if (sub === 'add') {
      await adicionar(chatId, partes.slice(1), requestId, bot);
      return;
    }
    if (sub === 'remover') {
      await remover(chatId, partes.slice(1).join(' '), requestId, bot);
      return;
    }
    if (sub === 'fatura') {
      await fatura(chatId, partes.slice(1).join(' '), requestId, bot);
      return;
    }
    await bot.sendMessage(
      chatId,
      'Use assim:\n/cartao — listar\n/cartao add <nome> <dia fechamento>\n/cartao remover <nome>\n/cartao fatura <nome>'
    );
  } catch (err) {
    log('error', 'Erro no comando /cartao', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui processar o comando. Tente novamente.');
  }
}

async function listar(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  const cartoes = await listarCartoes(requestId);
  if (cartoes.length === 0) {
    await bot.sendMessage(
      chatId,
      '📭 Nenhum cartão cadastrado.\n\nUse `/cartao add nubank 20` para criar.'
    );
    return;
  }

  const linhas = cartoes.map((c) => {
    const periodo = calcularPeriodoFatura(c.closing_day);
    const fecha = `${String(periodo.fechamento.getDate()).padStart(2, '0')}/${String(
      periodo.fechamento.getMonth() + 1
    ).padStart(2, '0')}`;
    return `💳 ${c.name} — fecha dia ${c.closing_day} (fatura atual: ${formatarDataCurta(
      periodo.inicio.toISOString()
    )} → ${fecha})`;
  });

  await bot.sendMessage(chatId, ['💳 *Seus cartões:*', '', ...linhas].join('\n'), {
    parse_mode: 'Markdown',
  });
}

async function adicionar(
  chatId: number,
  partes: string[],
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const diaStr = partes[partes.length - 1];
  const nome = partes.slice(0, -1).join(' ');

  if (!nome || !/^\d{1,2}$/.test(diaStr ?? '')) {
    await bot.sendMessage(chatId, 'Use assim: /cartao add nubank 20');
    return;
  }
  const dia = parseInt(diaStr, 10);
  if (dia < 1 || dia > 28) {
    await bot.sendMessage(chatId, '❌ O dia de fechamento deve estar entre 1 e 28.');
    return;
  }

  const cartao = await definirCartao(nome, dia, requestId);
  await bot.sendMessage(
    chatId,
    `✅ Cartão salvo!\n\n💳 ${cartao.name}\n📅 Fecha todo dia ${cartao.closing_day}`
  );
}

async function remover(
  chatId: number,
  nome: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  if (!nome) {
    await bot.sendMessage(chatId, 'Use assim: /cartao remover nubank');
    return;
  }
  const removido = await removerCartao(nome, requestId);
  if (!removido) {
    await bot.sendMessage(chatId, `❓ Não encontrei o cartão "${nome}".`);
    return;
  }
  await bot.sendMessage(chatId, `🗑️ Cartão "${removido}" removido.`);
}

async function fatura(
  chatId: number,
  nome: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  if (!nome) {
    await bot.sendMessage(chatId, 'Use assim: /cartao fatura nubank');
    return;
  }

  const cartoes = await listarCartoes(requestId);
  const cartao = cartoes.find((c) => c.name.toLowerCase() === nome.toLowerCase());
  if (!cartao) {
    await bot.sendMessage(chatId, `❓ Não encontrei o cartão "${nome}".`);
    return;
  }

  // O primeiro cartão da lista é o "padrão": herda gastos credit_card sem card_id.
  const ehPadrao = cartoes[0]?.id === cartao.id;
  const periodo = calcularPeriodoFatura(cartao.closing_day);
  const itens = await getFaturaDoPeriodo(cartao.id, periodo, ehPadrao, requestId);

  if (itens.length === 0) {
    await bot.sendMessage(chatId, `✅ Nenhum lançamento na fatura atual do ${cartao.name}.`);
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

  const fecha = `${String(periodo.fechamento.getDate()).padStart(2, '0')}/${String(
    periodo.fechamento.getMonth() + 1
  ).padStart(2, '0')}`;

  await bot.sendMessage(
    chatId,
    [
      `💳 *Fatura ${cartao.name}* (fecha ${fecha})`,
      '',
      ...linhas,
      '',
      `*Total: R$ ${formatarReal(total)}*`,
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
}