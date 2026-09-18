// src/services/gemini/guards/intentGuard.ts
//
// GUARD de intenção — valida com Zod o payload ÚNICO retornado pelo Gemini
// (intent + params + transaction). Complementa o responseSchema do model:
// o enum do schema é uma orientação forte, mas NUNCA uma garantia, e o
// allowlist em código é a defesa final contra intenções injetadas
// (ex.: "delete_all_data") e contra chaves de params inexistentes
// (ex.: um "chat_id" que não pertence a nenhuna intent).
import { z } from 'zod';
import { log } from '../../../utils/logger';
import type { Intent, IntentParams, IntentPayload, ParsedTransaction } from '../../../types/transaction';

/** Enum canônico de intenções que o bot sabe executar. */
export const INTENT_VALUES: readonly Intent[] = [
  'NOVO_GASTO',
  'NOVA_ENTRADA',
  'PAGAMENTO_DIVIDA',
  'CONSULTA',
  'EXPORTAR',
  'META',
  'CARTAO',
  'RECORRENTE',
  'GRAFICO',
  'INSIGHT',
  'POUPANCA',
  'PATRIMONIO',
  'INVESTIMENTOS',
  'AJUSTAR_SALDO',
  'TRANSFERENCIA',
  'SIMULAR_PARCELAS',
  'CONFIRMACAO_REQUERIDA',
  'OUTROS',
];

const intentSchema = z
  .object({
    intent: z.enum(INTENT_VALUES as unknown as [string, ...string[]], {
      message: 'Intenção fora do enum permitido.',
    }),
  })
  .required();

/** Params conhecidos — qualquer outra chave é descartada (possível injeção). */
const CHAVES_PARAMS = [
  'entidade',
  'month',
  'limite',
  'category',
  'type',
  'tipoExport',
  'accionMeta',
  'categoriaMeta',
  'limiteMeta',
  'accionCartao',
  'nomeCartao',
  'closingDay',
  'accionRecorrente',
  'accionPoupanca',
  'nomePoupanca',
  'valorPoupanca',
  'prazoPoupanca',
  'pedidoDescricao',
  'nomeConta',
  'saldoAjuste',
  'cdiRate',
  'tipoConta',
  'ticker',
  'quantidadeAtivo',
  'precoMedioAtivo',
  'contaOrigem',
  'contaDestino',
  'valorSimulacao',
  'parcelasSimulacao',
];

const paramsSchema = z
  .object({
    entidade: z.enum(['resumo', 'fatura', 'dividas', 'gastos', 'entradas', 'patrimonio', 'saldo', 'investimentos']).optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês com formato inválido (esperado YYYY-MM).' })
      .optional(),
    limite: z.number().int().min(1).max(50).optional(),
    // 8.4 — CONSULTA granular: a IA só sugere o NOME da categoria; a
    // resolução para category_id acontece em código (catálogo do Supabase).
    category: z.string().trim().min(1).max(60).optional(),
    type: z.enum(['gasto', 'entrada', 'tudo']).optional(),
    tipoExport: z.enum(['gastos', 'dividas']).optional(),
    accionMeta: z.enum(['listar', 'definir', 'remover']).optional(),
    categoriaMeta: z.string().trim().min(1).max(60).optional(),
    limiteMeta: z.number().finite().positive().max(1_000_000).optional(),
    accionCartao: z.enum(['listar', 'add', 'remover', 'fatura', 'principal']).optional(),
    nomeCartao: z.string().trim().min(1).max(60).optional(),
    closingDay: z.number().int().min(1).max(28).optional(),
    accionRecorrente: z.enum(['listar', 'add', 'remover']).optional(),
    // 8.7 — Poupança de longo prazo: nome/alvo/prazo validados em código.
    accionPoupanca: z.enum(['listar', 'definir', 'adicionar']).optional(),
    nomePoupanca: z.string().trim().min(1).max(60).optional(),
    valorPoupanca: z.number().finite().positive().max(1_000_000).optional(),
    prazoPoupanca: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Prazo com formato inválido (esperado AAAA-MM).' })
      .optional(),
    pedidoDescricao: z.string().trim().min(1).max(300).optional(),

    // Fase 11: Contas, Entradas e Investimentos
    nomeConta: z.string().trim().min(1).max(60).optional(),
    saldoAjuste: z.number().finite().optional(),
    cdiRate: z.number().finite().positive().max(1000).optional(),
    tipoConta: z.enum(['checking', 'benefit', 'fixed_income', 'investment_broker']).optional(),
    ticker: z.string().trim().min(1).max(20).optional(),
    quantidadeAtivo: z.number().finite().positive().optional(),
    precoMedioAtivo: z.number().finite().positive().optional(),
    contaOrigem: z.string().trim().min(1).max(60).optional(),
    contaDestino: z.string().trim().min(1).max(60).optional(),

    // Simulador de compras parceladas
    valorSimulacao: z.number().finite().positive().max(10_000_000).optional(),
    parcelasSimulacao: z.number().int().min(2).max(48).optional(),
  })
  .strip();

/**
 * 8.4 — Parsing TOLERANTE por-chave dos params: um campo inválido (ex.:
 * month != YYYY-MM) descarta SOMENTE esse campo, conservando os demais (ex.:
 * category). Cada chave conhecida é validada isoladamente contra o shape;
 * chaves desconhecidas já foram listadas em `camposDescartados`. Assim, um
 * JSON parcialmente alucinado pelo LLM continua sendo útil e seguro.
 */
function extraerParamsValidos(rawParams: unknown, requestId: string): IntentParams {
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) return {};

  const params: Record<string, unknown> = {};

  for (const [chave, campo] of Object.entries(paramsSchema.shape)) {
    if (!Object.prototype.hasOwnProperty.call(rawParams, chave)) continue;
    const valor = (rawParams as Record<string, unknown>)[chave];

    const r = campo.safeParse(valor);
    if (r.success) {
      if (r.data !== undefined) params[chave] = r.data;
    } else {
      const motivo =
        (r.error as { issues?: Array<{ message?: string }> } | undefined)?.issues?.[0]?.message ??
        'valor inválido';
      log('warn', `Param "${chave}" inválido descartado (possível alucinação)`, {
        requestId,
        motivo,
        valor: typeof valor === 'string' ? valor.slice(0, 80) : typeof valor,
      });
    }
  }

  return params as IntentParams;
}

/**
 * Valida e normaliza o payload bruto do Gemini.
 * @returns IntentPayload saneado ou null se o dado não for utilizável.
 */
export function validarPayload(
  raw: unknown,
  requestId: string,
  contexto = 'intenção'
): {
  intent: Intent;
  params: IntentParams;
  transaction: ParsedTransaction | null;
  camposDescartados: string[];
} | null {
  const shape = intentSchema.safeParse(raw);

  if (!shape.success) {
    log('warn', `Payload inválido para ${contexto}; assumindo OUTROS`, {
      requestId,
      motivo: shape.error.issues?.[0]?.message ?? 'parse inválido',
    });
    return null;
  }

  const intent = shape.data.intent as Intent;

  // Params: só chaves conhecidas; sinal de injeção: descarta e audita.
  const rawParams = (raw && typeof raw === 'object' && (raw as { params?: unknown }).params) || {};
  const camposDescartados =
    typeof rawParams === 'object' && !Array.isArray(rawParams)
      ? Object.keys(rawParams).filter((k) => !CHAVES_PARAMS.includes(k))
      : [];

  // 8.4 — Parsing tolerante por-chave: um param inválido não derrubba o resto.
  const params = extraerParamsValidos(rawParams, requestId);

  if (camposDescartados.length > 0) {
    log('warn', 'Chaves de params desconhecidas descartadas (possível injeção)', {
      requestId,
      chaves: camposDescartados.join(','),
    });
  }

  // transaction: não se valida aqui (depende de categoryMap); o fluxo de
  // NOVO_GASTO delega ao transactionGuard. Aqui só se detecta a presença.
  const transaction = (raw as { transaction?: unknown }).transaction;

  return {
    intent,
    params,
    transaction: (transaction && typeof transaction === 'object') ? (transaction as ParsedTransaction) : null,
    camposDescartados,
  };
}

/**
 * Valida apenas o campo intent (usado pelo audioParser com parte do payload).
 */
export function validarIntencao(intent: unknown, requestId: string, contexto = 'intenção'): Intent | null {
  const shape = intentSchema.safeParse({ intent });
  if (!shape.success) {
    log('warn', `Intenção inválida para ${contexto}; assumindo OUTROS`, {
      requestId,
      motivo: shape.error.issues?.[0]?.message ?? 'parse inválido',
    });
    return null;
  }
  return shape.data.intent as Intent;
}

export function emptyIntentPayload(): IntentPayload {
  return { intent: 'OUTROS', params: {}, transaction: null, avisos: [] };
}