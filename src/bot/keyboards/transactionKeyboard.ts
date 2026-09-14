import type { InlineKeyboardMarkup } from 'node-telegram-bot-api';
import type { PaymentMethod } from '../../types/transaction';

/**
 * Teclado da mensagem de sucesso. Categoria/Método só aparecem em
 * transações não parceladas — editar "1 parcela de 3" seria ambíguo
 * (só aquela? todas?), então evitamos essa decisão implícita.
 */
export function buildSuccessKeyboard(displayId: number, ehParcelado: boolean): InlineKeyboardMarkup {
  const botoes = [[{ text: '❌ Desfazer', callback_data: `und:${displayId}` }]];

  if (!ehParcelado) {
    botoes.push([
      { text: '✏️ Mudar Categoria', callback_data: `catm:${displayId}` },
      { text: '💳 Alterar Método', callback_data: `metm:${displayId}` },
    ]);
  }

  return { inline_keyboard: botoes };
}

export function buildCategoryKeyboard(displayId: number, categoryMap: Record<number, string>): InlineKeyboardMarkup {
  const entradas = Object.entries(categoryMap);
  const linhas: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < entradas.length; i += 2) {
    linhas.push(
      entradas.slice(i, i + 2).map(([id, nome]) => ({
        text: nome,
        callback_data: `setc:${displayId}:${id}`,
      }))
    );
  }

  linhas.push([{ text: '↩️ Voltar', callback_data: `back:${displayId}` }]);
  return { inline_keyboard: linhas };
}

interface MetodoOpcao {
  codigo: PaymentMethod;
  label: string;
  curto: string; // callback_data tem limite de 64 bytes; usamos códigos curtos
}

const METODOS: MetodoOpcao[] = [
  { codigo: 'pix', label: '💠 Pix', curto: 'pix' },
  { codigo: 'credit_card', label: '💳 Crédito', curto: 'cc' },
  { codigo: 'debit_card', label: '🏧 Débito', curto: 'dc' },
  { codigo: 'meal_voucher', label: '🍽️ Vale-refeição', curto: 'vr' },
  { codigo: 'food_voucher', label: '🥦 Vale-alimentação', curto: 'va' },
];

export function buildMethodKeyboard(displayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      METODOS.map((m) => ({ text: m.label, callback_data: `setm:${displayId}:${m.curto}` })),
      [{ text: '↩️ Voltar', callback_data: `back:${displayId}` }],
    ],
  };
}

export function metodoCurtoParaCompleto(curto: string): PaymentMethod {
  const encontrado = METODOS.find((m) => m.curto === curto);
  if (!encontrado) throw new Error(`Código de método de pagamento desconhecido: ${curto}`);
  return encontrado.codigo;
}

/**
 * 8.6 — Ações rápidas de navegação reutilizadas por vários teclados.
 * O prefixo `nav:` é resolvido pelo callbackQueryHandler, sempre depois do
 * gate de autorização (AUTHORIZED_USER_ID) — a IA não participa na decisão
 * do teclado.
 */
export const BOTON_GRAFICO = { text: '📊 Ver Gráfico', callback_data: 'nav:grafico' };
export const BOTON_RESUMO = { text: '📊 Meu Resumo', callback_data: 'nav:resumo' };
export const BOTON_FATURAS = { text: '💳 Faturas', callback_data: 'nav:fatura' };
export const BOTON_DIVIDAS = { text: '💰 Dívidas', callback_data: 'nav:dividas' };
export const BOTON_INSIGHT = { text: '📈 Ver Insight', callback_data: 'nav:insight' };
export const BOTON_ADICIONAR = { text: '➕ Adicionar Outro', callback_data: 'nav:novogasto' };

/**
 * 8.6 — Teclado da confirmação do gasto: mantém as ações de edição
 * (desfazer/categoria/método) e adiciona a navegação rápida. Se a meta da
 * categoria ESTOUROU (nível limite100), adiciona também a opção contextual
 * de ver o gráfico ou o insight — botões de decisão.
 */
export function buildGastoKeyboard(
  displayId: number,
  ehParcelado: boolean,
  alertaEstouro = false
): InlineKeyboardMarkup {
  const filas = buildSuccessKeyboard(displayId, ehParcelado).inline_keyboard;
  if (alertaEstouro) {
    filas.push([{ ...BOTON_GRAFICO }, { ...BOTON_INSIGHT }]);
  }
  filas.push([{ ...BOTON_RESUMO }, { ...BOTON_ADICIONAR }]);
  return { inline_keyboard: filas };
}

/** 8.6 — Teclado de navegação do resumo mensual: gráfico / faturas / dívidas. */
export function buildResumoKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ ...BOTON_GRAFICO }, { ...BOTON_FATURAS }, { ...BOTON_DIVIDAS }]],
  };
}

/** Teclado pós-exclusão de transação: oferece retorno rápido ao resumo e às faturas. */
export function buildPosExclusaoKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ ...BOTON_RESUMO }, { ...BOTON_FATURAS }]],
  };
}

/** 8.6 — Teclado contextual para avisos de orçamento estourado (gráfico/insight). */
export function buildAlertaMetaKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ ...BOTON_GRAFICO }, { ...BOTON_INSIGHT }]],
  };
}

/** 8.7 — Botão de metas de orçamento, usado na resposta da poupança. */
export const BOTON_METAS = { text: '💰 Ver Metas', callback_data: 'nav:meta' };

/** 8.7 — Teclado da poupança: atalho para as metas de orçamento do mês. */
export function buildPoupancaKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ ...BOTON_METAS }]],
  };
}

/** 9 — Teclado do modo viagem: atalhos para cotações e registro rápido. */
export function buildViagemKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🔄 Atualizar Cotações', callback_data: 'nav:viagem' }],
      [{ text: '📊 Ver Gráfico', callback_data: 'nav:grafico' }],
    ],
  };
}

import { salvarLoteIds } from '../../utils/batchStore';

/** Teclado de confirmação de importação de extrato em lote com botões de ação rápida. */
export function buildExtratoKeyboard(displayIdsOuToken: number[] | string): InlineKeyboardMarkup {
  const token = typeof displayIdsOuToken === 'string' ? displayIdsOuToken : salvarLoteIds(displayIdsOuToken);
  return {
    inline_keyboard: [
      [
        { text: '✏️ Mudar Categoria', callback_data: `catl:${token}` },
        { text: '💳 Alterar Cartão', callback_data: `crdl:${token}` },
      ],
      [{ text: '❌ Desfazer Importação', callback_data: `undl:${token}` }],
      [{ ...BOTON_FATURAS }, { ...BOTON_RESUMO }],
    ],
  };
}

/** Teclado para escolher categoria para o lote de extrato. */
export function buildCategoryBatchKeyboard(
  callbackSuffix: string,
  categoryMap: Record<number, string>
): InlineKeyboardMarkup {
  const entradas = Object.entries(categoryMap);
  const linhas: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < entradas.length; i += 2) {
    linhas.push(
      entradas.slice(i, i + 2).map(([id, nome]) => ({
        text: nome,
        callback_data: `setcl:${id}:${callbackSuffix}`,
      }))
    );
  }

  linhas.push([{ text: '↩️ Voltar', callback_data: `backl:${callbackSuffix}` }]);
  return { inline_keyboard: linhas };
}

/** Teclado para escolher cartão para o lote de extrato. */
export function buildCardBatchKeyboard(
  callbackSuffix: string,
  cartoes: Array<{ id: string; name: string }>
): InlineKeyboardMarkup {
  const linhas: { text: string; callback_data: string }[][] = cartoes.map((c) => [
    { text: `💳 ${c.name}`, callback_data: `setcrdl:${c.id}:${callbackSuffix}` },
  ]);

  linhas.push([{ text: '↩️ Voltar', callback_data: `backl:${callbackSuffix}` }]);
  return { inline_keyboard: linhas };
}