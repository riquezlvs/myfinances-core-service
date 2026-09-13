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
        enum: ['pix', 'credit_card', 'debit_card', 'meal_voucher', 'food_voucher'],
        nullable: true,
        description:
          'Forma de pagamento CITADA pelo usuário. meal_voucher = vale-refeição; food_voucher = vale-alimentação. ' +
          'Se o usuário não citar a forma de pagamento, retorne null — o sistema infere (vale/crédito) pela categoria.',
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
      third_party_names: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        nullable: true,
        description:
          '8.7 — Nomes de TODAS as pessoas quando a despesa é dividida entre várias ' +
          '(ex: "dividido em 3 com Maria e João" → ["Maria", "João"]). null se não houver divisão múltipla.',
      },
      installment_total: {
        type: Type.INTEGER,
        nullable: true,
        description:
          'Número total de parcelas, se mencionado (ex: "em 3x", "parcelado em 5 vezes"). ' +
          'Retorne null se a compra foi à vista/integral.',
      },
    },
    required: ['description', 'total_amount', 'category_id', 'occurred_at'],
  };
}

/**
 * Schema multimodal para mensagens de voz/áudio: o Gemini transcreve o
 * áudio, classifica a intenção e (se for gasto) extrai a transação —
 * reaproveitando exatamente o mesmo schema de transação do fluxo de texto.
 */
export function buildAudioSchema(categoryMap: Record<number, string>) {
  return {
    type: Type.OBJECT,
    properties: {
      intent: {
        type: Type.STRING,
        enum: ['NOVO_GASTO', 'PAGAMENTO_DIVIDA', 'CONSULTA', 'OUTROS'],
        description:
          'NOVO_GASTO: o áudio relata uma despesa nova a ser registrada. ' +
          'PAGAMENTO_DIVIDA: alguém pagou uma dívida com o usuário. ' +
          'CONSULTA: o usuário pergunta por informação existente. ' +
          'OUTROS: qualquer coisa fora das anteriores.',
      },
      transcricao: {
        type: Type.STRING,
        description: 'Transcrição literal do áudio, no idioma falado.',
      },
      transaction: {
        ...buildTransactionSchema(categoryMap),
        nullable: true,
        description:
          'Dados estruturados do gasto descrito no áudio. null se a intenção não for NOVO_GASTO.',
      },
    },
    required: ['intent', 'transcricao', 'transaction'],
  };
}

/** Schema fixo (não depende de dados dinámicos) para o roteamento de intenção. */
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
        'OUTROS: qualquer coisa fora das anteriores (saudação, dúvida, mensagem incomprehensible).',
    },
  },
  required: ['intent'],
};

/**
 * Fase 8 — Schema do payload ÚNICO (1 chamada por mensagem):
 * intent + params (opcional) + transaction (null excepto NOVO_GASTO).
 * A classificação de intenção e a extração da transação vivem em UMA
 * resposta JSON, substituendo a concatenação intentRouter + transactionParser.
 */
export function buildPayloadSchema(categoryMap: Record<number, string>) {
  return {
    type: Type.OBJECT,
    properties: {
      intent: {
        type: Type.STRING,
        enum: [
          'NOVO_GASTO',
          'PAGAMENTO_DIVIDA',
          'CONSULTA',
          'EXPORTAR',
          'META',
          'CARTAO',
          'RECORRENTE',
          'GRAFICO',
          'INSIGHT',
          'POUPANCA',
          'CONFIRMACAO_REQUERIDA',
          'OUTROS',
        ],
        description:
          'NOVO_GASTO: o usuário relata uma despesa nova (preencha "transaction"). ' +
          'PAGAMENTO_DIVIDA: alguém pagou/quitou uma dívida com o usuário. ' +
          'CONSULTA: o usuário quer ver informação existente (resumo, fatura, dívidas, últimos gastos); preencha params.entidade. ' +
          'Consultas granulares: se a pergunta cita uma CATEGORIA (ex: "quanto gastei com transporte?"), preencha params.category com o nome EXATO do catálogo; ' +
          'se cita um MÊS (ex: "em agosto", "o mês passado"), resolva com a data de referência e preencha params.month (YYYY-MM); params.type = "gasto" quando a consulta é sobre gastos. ' +
          'EXPORTAR: o usuário pede um CSV (params.tipoExport = "gastos"|"dividas", params.month opcional). ' +
          'META: define/lista/remove metas (params.accionMeta, params.categoriaMeta, params.limiteMeta). ' +
          'CARTAO: gerencia cartões (params.accionCartao, params.nomeCartao, params.closingDay). ' +
          'RECORRENTE: lista/agrega/remove despesas fixas (params.accionRecorrente). ' +
          'GRAFICO: pede a imagem de gastos por categoria. ' +
          'INSIGHT: pede análise IA dos gastos. ' +
          'POUPANCA: metas de poupança de longo prazo (params.accionPoupanca = listar|definir|adicionar; params.nomePoupanca, params.valorPoupanca e params.prazoPoupanca YYYY-MM quando citados). ' +
          'CONFIRMACAO_REQUERIDA: pedido que implica APAGAR/REMOVER dados — nunca execute; descreva o pedido em params.pedidoDescricao. ' +
          'OUTROS: qualquer outra coisa.',
      },
      params: {
        type: Type.OBJECT,
        description: 'Parâmetros opcionais da intenção (veja cada descrição).',
        properties: {
          entidade: {
            type: Type.STRING,
            enum: ['resumo', 'fatura', 'dividas', 'gastos'],
          },
          month: {
            type: Type.STRING,
            description: 'Mês no formato YYYY-MM (ex "2026-09"). Só se o usuário especifica um período distinto do atual.',
          },
          limite: {
            type: Type.INTEGER,
            description: 'Quantidade de registros (consultas de gastos).',
          },
          category: {
            type: Type.STRING,
            description:
              'CONSULTA granular: nome EXATO da categoria citada na pergunta (ex: "Transporte", "Alimentação"), igual ao catálogo. Só em consultas granulares.',
          },
          type: {
            type: Type.STRING,
            enum: ['gasto'],
            description:
              'CONSULTA granular: natureza do lançamento consultado. Sempre "gasto" (o ledger é expense-only).',
          },
          tipoExport: {
            type: Type.STRING,
            enum: ['gastos', 'dividas'],
          },
          accionMeta: {
            type: Type.STRING,
            enum: ['listar', 'definir', 'remover'],
          },
          categoriaMeta: {
            type: Type.STRING,
            description: 'Nome da categoria (igual ao catálogo) para META.',
          },
          limiteMeta: {
            type: Type.NUMBER,
            description: 'Limite mensal em reais para META.',
          },
          accionCartao: {
            type: Type.STRING,
            enum: ['listar', 'add', 'remover', 'fatura', 'principal'],
          },
          nomeCartao: {
            type: Type.STRING,
          },
          closingDay: {
            type: Type.INTEGER,
            description: 'Dia de fechamento do cartão (1-28).',
          },
          accionRecorrente: {
            type: Type.STRING,
            enum: ['listar', 'add', 'remover'],
          },
          accionPoupanca: {
            type: Type.STRING,
            enum: ['listar', 'definir', 'adicionar'],
          },
          nomePoupanca: {
            type: Type.STRING,
            description: '8.7 — POUPANCA: nome da meta (ex: "viagem").',
          },
          valorPoupanca: {
            type: Type.NUMBER,
            description: '8.7 — POUPANCA: alvo da meta (definir) ou valor do aporte (adicionar), em reais.',
          },
          prazoPoupanca: {
            type: Type.STRING,
            description: '8.7 — POUPANCA: prazo da meta em AAAA-MM (só se o usuário citar).',
          },
          pedidoDescricao: {
            type: Type.STRING,
            description: 'Somente CONFIRMACAO_REQUERIDA: o que o usuário pediu para apagar/remover.',
          },
        },
      },
      transaction: {
        ...buildTransactionSchema(categoryMap),
        nullable: true,
        description:
          'Dados estruturados do gasto. null para qualquer intenção distinta de NOVO_GASTO.',
      },
    },
    required: ['intent'],
  };
}