import { Type } from '@google/genai';

/**
 * Schema dinâmico: a lista de categorias vem do cache (Supabase), não é
 * mais hardcoded — permite adicionar/renomear categorias sem redeploy.
 */
export function buildTransactionSchema(categoryMap: Record<number, string>) {
  return {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "Nome curto do item ou serviço comprado. Ex: 'Almoço no restaurante'.",
      },
      total_amount: {
        type: Type.NUMBER,
        description: 'Valor TOTAL gasto (antes de qualquer divisão ou parcelamento), sempre positivo.',
      },
      category_id: {
        type: Type.INTEGER,
        description: `Categoria da despesa. Escolha o ID mais aderente: ${Object.entries(categoryMap)
          .map(([id, name]) => `${id}=${name}`)
          .join(', ')}.`,
      },
      payment_method: {
        type: Type.STRING,
        enum: ['pix', 'credit_card', 'debit_card'],
        description: "Forma de pagamento citada. Se não for citada, assuma 'credit_card'.",
      },
      occurred_at: {
        type: Type.STRING,
        description:
          'Data e hora EXATA em que o gasto ocorreu, em ISO 8601 (ex: "2026-09-04T12:00:00-03:00"). ' +
          'Resolva expressões relativas ("ontem", "anteontem à noite", "sexta passada", "meio-dia") ' +
          'com base na data/hora atual informada no início do prompt. Se a mensagem não mencionar ' +
          'quando o gasto ocorreu, use exatamente a data/hora atual fornecida.',
      },
      my_share_amount: {
        type: Type.NUMBER,
        nullable: true,
        description:
          'Valor de responsabilidade EXCLUSIVA do usuário, após divisão. null se não houver divisão. ' +
          'Se a mensagem disser "dividida" sem informar valores exatos, calcule como 50% do total_amount.',
      },
      third_party_name: {
        type: Type.STRING,
        nullable: true,
        description: "Primeiro nome de quem dividiu a despesa. null se não houver terceiro.",
      },
      installment_total: {
        type: Type.INTEGER,
        nullable: true,
        description:
          'Número total de parcelas, se mencionado (ex: "em 3x", "parcelado em 5 vezes"). ' +
          'Retorne null se a compra foi à vista/integral.',
      },
    },
    required: ['description', 'total_amount', 'category_id', 'payment_method', 'occurred_at'],
  };
}

/** Schema fixo (não depende de dados dinâmicos) para o roteamento de intenção. */
export const intentSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['NOVO_GASTO', 'PAGAMENTO_DIVIDA', 'CONSULTA', 'OUTROS'],
      description:
        'NOVO_GASTO: o usuário relata uma despesa nova a ser registrada. ' +
        'PAGAMENTO_DIVIDA: alguém pagou/quitou (total ou parcialmente) uma dívida com o usuário. ' +
        'CONSULTA: o usuário quer ver informação existente (resumo, saldo, últimos gastos, fatura) ' +
        'em linguagem natural, sem usar "/". ' +
        'OUTROS: qualquer coisa fora das anteriores (saudação, dúvida, mensagem incompreensível).',
    },
  },
  required: ['intent'],
};