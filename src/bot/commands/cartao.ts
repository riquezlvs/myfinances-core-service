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
    throw new Error(
      `Tipo "${token}" não reconhecido. Use: credito (credit), vr (refeicao) ou va (alimentacao).\n\nEx: /cartao add Santander 1 credito`
    );
  }
  return tipo;
}

function emojiTipo(tipo: CardType): string {
  return tipo === 'credit' ? '💳' : tipo === 'meal_voucher' ? '🍽️' : '🛒';
}

/** Comandos do /cartão — usada na ajuda e nas mensagens de fallback. */
const COMANDOS_CARTAO = [
  '📋 *Comandos do /cartão:*',
  '/cartao — listar cartões e vales',
  '/cartao add <nome> [dia] [credito|vr|va] — adicionar/atualizar',
  '/cartao principal <nome> — definir como principal',
  '/cartao fatura <nome> — ver fatura do período',
  '/cartao remover <nome> — remover cartão/vale',
  '',
  '💡 Exemplos:',
  '/cartao add Santander 30 credito',
  '/cartao add Ticket 15 vr',
].join('\n');

export async function handleCartao(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);
  const sub = (partes[0] ?? '').toLowerCase();

  try {
    if (!sub) {
      // /cartao sem argumentos → ajuda rápida + lista de cartões.
      await bot.sendMessage(chatId, COMANDOS_CARTAO, { parse_mode: 'Markdown' });
      await listar(chatId, requestId, bot);
      return;
    }
    if (sub === 'listar') {
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
    // Sub-comando não reconhecido → ajuda clara
    await bot.sendMessage(chatId, COMANDOS_CARTAO, { parse_mode: 'Markdown' });
  } catch (err) {
    log('error', 'Erro no comando /cartao', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(
      chatId,
      `❌ ${err instanceof Error ? err.message : 'Não consegui processar o comando. Tente novamente.'}`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function listar(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  const cartoes = await listarCartoes(requestId);
  if (cartoes.length === 0) {
    await bot.sendMessage(
      chatId,
      [
        '📭 Nenhum cartão ou vale cadastrado ainda.',
        '',
        'Adicione seu primeiro cartão ou vale:',
        '💳 Crédito: `/cartao add Santander 30 credito`',
        '🍽️ Vale-refeição: `/cartao add Alelo 1 vr`',
        '🛒 Vale-alimentação: `/cartao add Sodexo 1 va`',
        '',
        '💡 O dia e o tipo são opcionais (padrão: dia=1, tipo=credito).',
        '',
        RODAPE_UX,
      ].join('\n'),
      { parse_mode: 'Markdown' }
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

/**
 * Faz o parsing inteligente dos argumentos do /cartao add.
 *
 * Formatos aceitos (todos com defaults amigáveis):
 *   /cartao add NOME              → nome, closing_day=1, tipo=credit
 *   /cartao add NOME DIA          → nome, closing_day=DIA, tipo=credit
 *   /cartao add NOME TIPO         → nome, closing_day=1, tipo=TIPO
 *   /cartao add NOME DIA TIPO     → nome, closing_day=DIA, tipo=TIPO
 */
export function parseArgumentosAdd(partes: string[]): {
  nome: string;
  closing_day: number;
  tipo: CardType;
} {
  if (partes.length === 0) {
    throw new Error(
      'Faltou o nome do cartão. Use: /cartao add <nome> [dia] [credito|vr|va]\n\nEx: /cartao add Santander 1 credito'
    );
  }

  const ehTipo = (t: string): boolean => t.toLowerCase() in ALIASES_TIPO;
  const ehNumero = (t: string): boolean => /^\d+$/.test(t);

  if (partes.length === 1) {
    return { nome: partes[0], closing_day: 1, tipo: 'credit' };
  }

  if (partes.length === 2) {
    const [um, dois] = partes;
    if (ehTipo(dois)) {
      return { nome: um, closing_day: 1, tipo: ALIASES_TIPO[dois.toLowerCase()] };
    }
    if (ehNumero(dois)) {
      return { nome: um, closing_day: Math.min(28, Math.max(1, Number(dois))), tipo: 'credit' };
    }
    throw new Error(
      `⚠️ Não entendi "${dois}". Use dia (número) ou tipo (credito|vr|va).\n\n` +
      `Para o segundo parâmetro, informe o *dia de fechamento* (1 a 28) ou o *tipo* (\`credito\`, \`vr\` ou \`va\`).\n\n` +
      `📌 Exemplos:\n` +
      `• Ex: /cartao add ${um} 1 credito\n` +
      `• /cartao add ${um} 1 vr`
    );
  }

  // 3+ argumentos: NOME(S) + DIA + TIPO
  const ultimo = partes[partes.length - 1];
  const penultimo = partes[partes.length - 2];
  const nome = partes.slice(0, -2).join(' ');

  if (ehTipo(ultimo) && ehNumero(penultimo)) {
    return {
      nome,
      closing_day: Math.min(28, Math.max(1, Number(penultimo))),
      tipo: ALIASES_TIPO[ultimo.toLowerCase()],
    };
  }

  if (ehTipo(ultimo)) {
    return {
      nome: partes.slice(0, -1).join(' '),
      closing_day: 1,
      tipo: ALIASES_TIPO[ultimo.toLowerCase()],
    };
  }

  throw new Error(
    `⚠️ *Formato incorreto para cadastrar cartão.*\n\n` +
    `Uso: \`/cartao add <nome> [dia_fechamento] [credito|vr|va]\`\n\n` +
    `📌 *Exemplos:*\n` +
    `• \`/cartao add Nubank 10 credito\`\n` +
    `• \`/cartao add VR Benefício 1 vr\``
  );
}

async function adicionar(
  chatId: number,
  partes: string[],
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const { nome, closing_day, tipo } = parseArgumentosAdd(partes);
  const cartao = await definirCartao(nome, closing_day, requestId, tipo);
  const principal = cartao.is_default
    ? '\n🏷️ Principal do tipo (usado automaticamente nos gastos).'
    : '';
  await bot.sendMessage(
    chatId,
    `✅ ${emojiTipo(tipo)} ${LABEL_CARD_TYPE[tipo]} salvo!\n\n${emojiTipo(tipo)} ${cartao.name}\n📅 Dia de fechamento: ${cartao.closing_day}${principal}\n\n${RODAPE_UX}`
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