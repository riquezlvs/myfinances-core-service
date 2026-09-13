import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';
import {
  listarCartoes,
  definirCartao,
  definirCartaoPrincipal,
  removerCartao,
  calcularPeriodoFatura,
  getFaturaDoPeriodo,
  LABEL_CARD_TYPE,
  type Cartao,
} from '../../services/cards/cardService';
import type { CardType } from '../../types/transaction';
import { RODAPE_UX } from '../../config/constants';

/**
 * Fase 6 / 8.2 — /cartao: gerencia múltiplos cartões e vales.
 *
 * /cartao                        → lista cartões e vales (marca o principal)
 * /cartao add <nome> <dia> [tipo]→ cria/atualiza (tipo: credito|vr|va)
 * /cartao principal <nome>       → define o principal do seu tipo
 * /cartao remover <nome>         → remove um cartão/vale
 * /cartao fatura <nome>          → fatura do cartão no período de fechamento
 */

/** Aliases aceitos no comando para o tipo de cartão (8.2). */
const ALIASES_TIPO: Record<string, CardType> = {
  credito: 'credit',
  credit: 'credit',
  vr: 'meal_voucher',
  refeicao: 'meal_voucher',
  va: 'food_voucher',
  alimentacao: 'food_voucher',
};

function parseTipo(token: string | undefined): CardType {
  if (!token) return 'credit';
  const tipo = ALIASES_TIPO[token.toLowerCase()];
  if (!tipo) {
    throw new Error(`Tipo desconhecido: ${token}`);
  }
  return tipo;
}

function emojiTipo(tipo: CardType): string {
  return tipo === 'credit' ? '💳' : tipo === 'meal_voucher' ? '🍽️' : '🛒';
}
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
    if (sub === 'principal') {
      await principal(chatId, partes.slice(1).join(' '), requestId, bot);
      return;
    }
    await bot.sendMessage(
      chatId,
      'Use assim:\n/cartao — listar\n/cartao add <nome> <dia fechamento> [credito|vr|va]\n/cartao principal <nome>\n/cartao remover <nome>\n/cartao fatura <nome>'
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
      `📭 Nenhum cartão ou vale cadastrado.\n\nUse \`/cartao add nubank 20\` ou \`/cartao add alelo 1 vr\`.\n\n${RODAPE_UX}`
    );
    return;
  }

  const linhas = cartoes.map((c) => {
    const etiqueta = c.is_default ? ' 🏷️ *principal*' : '';
    if (c.card_type === 'credit') {
      const periodo = calcularPeriodoFatura(c.closing_day);
      const fecha = `${String(periodo.fechamento.getDate()).padStart(2, '0')}/${String(
        periodo.fechamento.getMonth() + 1
      ).padStart(2, '0')}`;
      return `💳 ${c.name} — fecha dia ${c.closing_day} (fatura atual: ${formatarDataCurta(
        periodo.inicio.toISOString()
      )} → ${fecha})${etiqueta}`;
    }
    return `${emojiTipo(c.card_type)} ${c.name} — ${LABEL_CARD_TYPE[c.card_type]}${etiqueta}`;
  });

  await bot.sendMessage(chatId, ['💳 *Seus cartões e vales:*', '', ...linhas, '', RODAPE_UX].join('\n'), {
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
  let nome = partes.slice(0, -1).join(' ');
  let tipo: CardType = 'credit';

  // 8.2 — último token pode ser o tipo (vr/va/credito); o penúltimo é o dia.
  const possivelTipo = parseTipo(partes[partes.length - 2] ?? undefined);
  const ultimoEhDia = /^\d{1,2}$/.test(diaStr ?? '');
  if (ultimoEhDia && partes.length >= 3 && typeof possivelTipo !== 'undefined') {
    tipo = possivelTipo;
    nome = partes.slice(0, -2).join(' ');
  }
  const diaFinal = partes[partes.length - (tipo === 'credit' && nome ? 2 : 1)] ?? diaStr;

  if (!nome || !/^\d{1,2}$/.test(diaStr ?? '')) {
    await bot.sendMessage(chatId, 'Use assim: /cartao add nubank 20  (ou: /cartao add alelo 1 vr)');
    return;
  }
  const dia = parseInt(diaStr, 10);
  if (dia < 1 || dia > 28) {
    await bot.sendMessage(chatId, '❌ O dia de fechamento deve estar entre 1 e 28.');
    return;
  }

  const cartao = await definirCartao(nome, dia, requestId, tipo);
  const Principal = cartao.is_default ? '\n🏷️ Principal do tipo (usado automaticamente nos gastos).' : '';
  await bot.sendMessage(
    chatId,
    `✅ ${emojiTipo(tipo)} ${LABEL_CARD_TYPE[tipo]} salvo!\n\n${emojiTipo(tipo)} ${cartao.name}\n📅 Dia de fechamento: ${cartao.closing_day}${Principal}\n\n${RODAPE_UX}`
  );
}

/** 8.2 — /cartao principal <nome>: define o principal do tipo do cartão. */
async function principal(
  chatId: number,
  nome: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  if (!nome) {
    await bot.sendMessage(chatId, 'Use assim: /cartao principal nubank');
    return;
  }
  const cartoes = await listarCartoes(requestId);
  const alvo = cartoes.find((c) => c.name.toLowerCase() === nome.toLowerCase());
  if (!alvo) {
    await bot.sendMessage(chatId, `❓ Não encontrei o cartão "${nome}".`);
    return;
  }
  const atualizado = await definirCartaoPrincipal(alvo.id, requestId);
  await bot.sendMessage(
    chatId,
    `🏷️ ${emojiTipo(atualizado.card_type)} *${atualizado.name}* agora é o principal (${LABEL_CARD_TYPE[atualizado.card_type]}).\n\n${RODAPE_UX}`
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
  await bot.sendMessage(chatId, `🗑️ Cartão "${removido}" removido.\n\n${RODAPE_UX}`);
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
      '',
      RODAPE_UX,
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
}