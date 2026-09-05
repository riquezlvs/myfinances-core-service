import type { InlineKeyboardMarkup } from 'node-telegram-bot-api';

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
  codigo: 'pix' | 'credit_card' | 'debit_card';
  label: string;
  curto: string; // callback_data tem limite de 64 bytes; usamos códigos curtos
}

const METODOS: MetodoOpcao[] = [
  { codigo: 'pix', label: '💠 Pix', curto: 'pix' },
  { codigo: 'credit_card', label: '💳 Crédito', curto: 'cc' },
  { codigo: 'debit_card', label: '🏧 Débito', curto: 'dc' },
];

export function buildMethodKeyboard(displayId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      METODOS.map((m) => ({ text: m.label, callback_data: `setm:${displayId}:${m.curto}` })),
      [{ text: '↩️ Voltar', callback_data: `back:${displayId}` }],
    ],
  };
}

export function metodoCurtoParaCompleto(curto: string): 'pix' | 'credit_card' | 'debit_card' {
  const encontrado = METODOS.find((m) => m.curto === curto);
  if (!encontrado) throw new Error(`Código de método de pagamento desconhecido: ${curto}`);
  return encontrado.codigo;
}