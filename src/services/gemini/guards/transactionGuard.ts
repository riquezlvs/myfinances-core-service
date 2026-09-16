// src/services/gemini/guards/transactionGuard.ts
//
// GUARD de transação — primeira barreira anti-alucinação entre o JSON que
// o Gemini retorna e o Supabase.
//
// Por que existe (Fase 8 — Blindagem):
//   * O JSON.parse(...) + "as ParsedTransaction" era um CAST, não uma
//     validação: um string no lugar de number, Infinity (1e309), chaves
//     obrigatórias ausentes ou um método de pagamento inventado chegavam
//     até o banco e estouravam com erros genéricos.
//   * Este guard valida com Zod (tipos, enums, ranges), aplica hard-limits
//     em CÓDIGO (independentes da IA), clampa a data numa janela razoável
//     e recolhe "avisos" para que a capa de bot possa avisar o usuário
//     (ex.: "ajustei a data") antes de persistir.
//
// Regra de ouro: NUNCA confiamos no valor alucinado; tudo o que possa
// corromper o ledger é rejeitado (throw) ou clampeado em código.
import { z } from 'zod';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_INSTALLMENTS,
  MAX_NAME_LENGTH,
  MAX_TRANSACTION_AMOUNT,
  OCCURRED_AT_MAX_DRIFT_DAYS,
} from '../../../config/constants';
import { log } from '../../../utils/logger';
import type { ParsedTransaction } from '../../../types/transaction';

const DRIFT_MAX_MS = OCCURRED_AT_MAX_DRIFT_DAYS * 24 * 60 * 60 * 1000;

/**
 * Schema estrito de TIPOS e FAIXAS. As regras de domínio que dependem de
 * dados dinâmicos (categorias) ou de comparações entre campos (my_share vs
 * total) são validadas manualmente depois do parse.
 *
 * NOTA: occurred_at é aceito como string genérico e clampeado de forma
 * tolerante (data inválida ou vazia => "agora"): decisão deliberada para
 * que uma alucinação de data seja CLAMPEADA em vez de derrubar o gasto.
 */
const transactionShapeSchema = z.object({
  description: z
    .string({ message: 'A descrição não é texto.' })
    .trim()
    .min(1, { message: 'Descrição vazia.' })
    .max(MAX_DESCRIPTION_LENGTH, { message: 'Descrição longa demais.' }),
  total_amount: z
    .number({ message: 'total_amount não é um número finito.' })
    .finite({ message: 'total_amount não é um número finito.' })
    .positive({ message: 'Valor extraído é inválido (deve ser positivo).' })
    .max(MAX_TRANSACTION_AMOUNT, { message: 'Valor extraído excede o limite permitido.' }),
  category_id: z.number({ message: 'Categoria inválida.' }).int({ message: 'Categoria inválida.' }),
  // 8.2: aceita métodos de benefício e PERMITE null (o usuário não citou o
  // método — a inferência determinística decide; o guard nunca inventa um).
  payment_method: z
    .enum(['pix', 'credit_card', 'debit_card', 'meal_voucher', 'food_voucher'], {
      message: 'Método de pagamento inválido.',
    })
    .nullable()
    .optional(),
  occurred_at: z.string({ message: 'Data inválida.' }),
  my_share_amount: z
    .number({ message: 'my_share_amount não é um número finito.' })
    .finite({ message: 'my_share_amount não é um número finito.' })
    .nonnegative({ message: 'my_share_amount não pode ser negativo.' })
    .max(MAX_TRANSACTION_AMOUNT, { message: 'my_share_amount excede o limite permitido.' })
    .nullable()
    .optional(),
  third_party_name: z
    .string({ message: 'O nome do terceiro não é texto.' })
    .trim()
    .min(1, { message: 'Nome do terceiro vazio.' })
    .max(MAX_NAME_LENGTH, { message: 'Nome do terceiro longo demais.' })
    .nullable()
    .optional(),
  // 8.7 — Split múltiple: array de nomes quando a despesa é dividida entre
  // várias pessoas. Máximo 5 nomes (hard-limit em código contra abuse).
  third_party_names: z
    .array(
      z
        .string({ message: 'Nome de terceiro inválido na lista.' })
        .trim()
        .min(2, { message: 'Nome de terceiro curto demais na lista.' })
        .max(MAX_NAME_LENGTH, { message: 'Nome de terceiro longo demais na lista.' })
    )
    .max(5, { message: 'Máximo de 5 pessoas na divisão.' })
    .nullable()
    .optional(),
  installment_total: z
    .number({ message: 'installment_total não é um número.' })
    .int({ message: 'installment_total deve ser inteiro.' })
    .min(1, { message: 'installment_total fora de range.' })
    .max(MAX_INSTALLMENTS, { message: `Máximo ${MAX_INSTALLMENTS} parcelas permitidas.` })
    .nullable()
    .optional(),
  entry_type: z.enum(['expense', 'income', 'yield', 'transfer']).nullable().optional(),
  account_name: z.string().trim().nullable().optional(),
});

/** Chaves que o schema conhece; qualquer outra é descartada (e logada). */
const CHAVES_CONHECIDAS = [
  'description',
  'total_amount',
  'category_id',
  'payment_method',
  'occurred_at',
  'my_share_amount',
  'third_party_name',
  'third_party_names',
  'installment_total',
  'entry_type',
  'account_name',
];

function chavesDesconhecidas(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw).filter((k) => !CHAVES_CONHECIDAS.includes(k));
}

/** Serializa os erros de Zod num texto breve e legível (mensagem + campo). */
export function formatarErroZod(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { issues?: { path?: (string | number)[]; message?: string }[]; message?: string };
    if (Array.isArray(e.issues)) {
      const msgs = e.issues
        .map((i) => {
          const caminho = Array.isArray(i.path) && i.path.length ? `${i.path.join('.')}: ` : '';
          return `${caminho}${i.message ?? 'erro desconhecido'}`;
        })
        .filter(Boolean);
      if (msgs.length) return msgs.join('; ');
    }
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

function clamparOccurredAt(occurredAtISO: string, agoraISO: string, requestId: string): string {
  const agoraMs = new Date(agoraISO).getTime();
  const occurredMs = new Date(occurredAtISO).getTime();

  if (Number.isNaN(occurredMs)) {
    log('warn', 'occurred_at inválido retornado pela IA; usando agora', {
      requestId,
      occurredAtISO,
    });
    return agoraISO;
  }

  const driftMs = occurredMs - agoraMs;
  // Datas passadas podem ser antigas: o usuário pode lançar um gasto histórico.
  // Mantemos o limite apenas para datas futuras, que indicam erro com mais frequência.
  if (driftMs <= 0 || driftMs <= DRIFT_MAX_MS) return occurredAtISO;

  const clampedMs = agoraMs + Math.sign(driftMs) * DRIFT_MAX_MS;
  const clampedISO = new Date(clampedMs).toISOString();
  log('warn', 'occurred_at fora da janela permitida — clampeado', {
    requestId,
    original: occurredAtISO,
    clampeado: clampedISO,
  });
  return clampedISO;
}

export interface TransacaoGuardResult {
  data: ParsedTransaction;
  /** Avisos para mostrar ao usuário (ex.: data ajustada). Vazio = sem avisos. */
  warnings: string[];
  /**
   * Chaves desconhecidas que o LLM tentou injetar (ex. "chat_id") —
   * descartadas, mas registradas para auditoria.
   */
  camposDescartados: string[];
}

/**
 * Valida e padroniza o JSON bruto do Gemini.
 * @throws Error com mensagem legível se o dado for inutilizável.
 */
export function validarTransacao(
  raw: unknown,
  categoryMap: Record<number, string>,
  agoraISO: string,
  requestId = 'sem-request-id'
): TransacaoGuardResult {
  // 1) Tipos, enums e hard-limits (não coerciona: um string "45" aqui é erro).
  const shape = transactionShapeSchema.safeParse(raw);
  if (!shape.success) {
    const motivo = formatarErroZod(shape.error);
    log('warn', 'Transação rejeitada pelo guard (Zod)', { requestId, motivo });
    throw new Error(`Dados de transação inválidos: ${motivo}`);
  }

  // 2) Chaves desconhecidas: o schema as descarta (strip por padrão na v4);
  //     aqui as detectamos a partir do raw para auditoria anti-injeção.
  const camposDescartados = chavesDesconhecidas(raw);
  if (camposDescartados.length > 0) {
    log('warn', 'Chaves desconhecidas descartadas do JSON da IA (possível injeção)', {
      requestId,
      chaves: camposDescartados.join(','),
    });
  }

  const candidata = shape.data;

  // 3) Regras de domínio com dados dinâmicos (categorias vêm do Supabase).
  if (!categoryMap[candidata.category_id]) {
    const id = candidata.category_id;
    log('warn', 'category_id alucinado rejeitado pelo guard', { requestId, category_id: id });
    throw new Error(`category_id inválido retornado pela IA: ${id}`);
  }

  // 4) Coerência interna: a parte própria não pode exceder o total.
  if (candidata.my_share_amount != null && candidata.my_share_amount > candidata.total_amount) {
    throw new Error('my_share_amount não pode ser maior que total_amount.');
  }

  // 5) Parcelas: 1x = à vista; valores fora de range já foram rejeitados por Zod.
  const installmentTotal =
    candidata.installment_total != null && candidata.installment_total < 2
      ? null
      : candidata.installment_total;

  // 6) Clamp da data (janela ±OCCURRED_AT_MAX_DRIFT_DAYS).
  const occurredAtRaw = candidata.occurred_at || agoraISO;
  const occurredAt = clamparOccurredAt(occurredAtRaw, agoraISO, requestId);
  const warnings: string[] = [];
  if (occurredAt !== occurredAtRaw) {
    warnings.push(
      '⚠️ Ajustei a data para uma dentro do range permitido (a que você indicou parecia inválida ou muito distante).'
    );
  } else if (new Date(occurredAt).getTime() < Date.now() - DRIFT_MAX_MS) {
    warnings.push('📅 Registrei a data antiga informada. Confira se ela está correta.');
  }

  return {
    data: {
      description: candidata.description,
      total_amount: candidata.total_amount,
      category_id: candidata.category_id,
      payment_method: candidata.payment_method ?? null,
      occurred_at: occurredAt,
      my_share_amount: candidata.my_share_amount ?? null,
      third_party_name: candidata.third_party_name ?? null,
      third_party_names: candidata.third_party_names ?? undefined,
      installment_total: installmentTotal,
      entry_type: candidata.entry_type ?? undefined,
      account_name: candidata.account_name ?? undefined,
    },
    warnings,
    camposDescartados,
  };
}