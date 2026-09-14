// src/services/gemini/guards/statementGuard.ts
import { z } from 'zod';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_INSTALLMENTS,
  MAX_TRANSACTION_AMOUNT,
} from '../../../config/constants';
import { log } from '../../../utils/logger';
import type { ExtracaoExtratoItem } from '../../../types/transaction';

const statementItemShapeSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .max(MAX_DESCRIPTION_LENGTH),
  amount: z
    .number()
    .finite()
    .positive()
    .max(MAX_TRANSACTION_AMOUNT),
  category_id: z.number().int(),
  date: z.string().trim().min(1),
  installment_current: z.number().int().min(1).max(MAX_INSTALLMENTS).nullable().optional(),
  installment_total: z.number().int().min(1).max(MAX_INSTALLMENTS).nullable().optional(),
  is_payment_or_credit: z.boolean().optional(),
});

const statementShapeSchema = z.object({
  card_name_hint: z.string().trim().max(100).nullable().optional(),
  statement_date: z.string().trim().nullable().optional(),
  items: z.array(z.unknown()),
});

export interface StatementValidado {
  card_name_hint: string | null;
  statement_date: string | null;
  items: ExtracaoExtratoItem[];
  avisos: string[];
}

/**
 * Valida, filtra e normaliza a resposta de OCR do Gemini para uma fatura/extrato bancário.
 * Itens inválidos ou que representem pagamento/crédito são auditados e descartados.
 */
export function validarExtrato(
  raw: unknown,
  categoryMap: Record<number, string>,
  requestId: string
): StatementValidado {
  const parseResult = statementShapeSchema.safeParse(raw);
  if (!parseResult.success) {
    const primeiroErro = parseResult.error.issues[0]?.message ?? 'Estrutura do extrato inválida.';
    log('warn', 'Payload de extrato rejeitado pelo guard', { requestId, erro: primeiroErro });
    throw new Error(`Falha ao ler extrato: ${primeiroErro}`);
  }

  const { card_name_hint, statement_date, items: rawItems } = parseResult.data;
  const avisos: string[] = [];
  const itemsValidos: ExtracaoExtratoItem[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const rawItem = rawItems[i];
    const itemResult = statementItemShapeSchema.safeParse(rawItem);
    if (!itemResult.success) {
      log('warn', `Item ${i + 1} do extrato descartado por validação`, {
        requestId,
        motivo: itemResult.error.issues[0]?.message,
      });
      continue;
    }

    const item = itemResult.data;

    // Se for estorno ou pagamento de fatura, não cadastramos como gasto comum
    if (item.is_payment_or_credit) {
      avisos.push(`Linha de crédito/pagamento ignorada: "${item.description}" (R$ ${item.amount.toFixed(2)})`);
      continue;
    }

    // Validação da categoria
    let categoryId = item.category_id;
    if (!categoryMap[categoryId]) {
      // Fallback para primeira categoria disponível ou 1
      const categorias = Object.keys(categoryMap).map(Number);
      categoryId = categorias[0] ?? 1;
    }

    // Normalização de datas (YYYY-MM-DD)
    let dateStr = item.date;
    const dataParsed = new Date(dateStr);
    if (isNaN(dataParsed.getTime())) {
      dateStr = new Date().toISOString().split('T')[0]!;
    } else {
      dateStr = dataParsed.toISOString().split('T')[0]!;
    }

    // Normalização de parcelas
    let installment_current = item.installment_current ?? null;
    let installment_total = item.installment_total ?? null;
    if (installment_current && !installment_total) {
      installment_total = installment_current;
    }
    if (installment_total && !installment_current) {
      installment_current = 1;
    }
    if (installment_current && installment_total && installment_current > installment_total) {
      installment_total = installment_current;
    }

    itemsValidos.push({
      description: item.description,
      amount: Math.round(item.amount * 100) / 100,
      category_id: categoryId,
      date: dateStr,
      installment_current,
      installment_total,
      is_payment_or_credit: false,
    });
  }

  log('info', 'Extrato validado e filtrado com sucesso', {
    requestId,
    qtd_total: rawItems.length,
    qtd_validos: itemsValidos.length,
    card_hint: card_name_hint,
  });

  return {
    card_name_hint: card_name_hint ?? null,
    statement_date: statement_date ?? null,
    items: itemsValidos,
    avisos,
  };
}
