// src/services/gemini/transactionParser.ts
import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import { GEMINI_MODEL, GEMINI_TIMEOUT_MS } from '../../config/constants';
import { buildTransactionSchema } from './schemas';
import { buildTransactionPrompt, SISTEMA_TRANSACAO } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import { validarTransacao } from './guards/transactionGuard';
import type { ParsedTransaction } from '../../types/transaction';

export interface TransacaoParseada {
  data: ParsedTransaction;
  /** Avisos do guard (ex.: data clampeada) para mostrar ao usuário. */
  warnings: string[];
}

/**
 * Fase 8 — O JSON bruto do Gemini passa SEMPRE pelo guard (Zod +
 * hard-limits + clamps) antes de tocar qualquer service. Compartilhado pelo
 * fluxo de texto (interpretarGasto) e pelo de áudio (interpretarAudio) para
 * que ambos tenham exatamente as mesmas regras de validação.
 */
export function validarEPadronizarGasto(
  parsed: unknown,
  categoryMap: Record<number, string>,
  agoraISO: string,
  requestId = 'sem-request-id'
): ParsedTransaction {
  return validarTransacao(parsed, categoryMap, agoraISO, requestId).data;
}

export async function interpretarGasto(
  texto: string,
  requestId: string
): Promise<TransacaoParseada> {
  return withTiming('chamada ao Gemini (extrair gasto)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const categoryMap = await getCategoryMap(requestId);
    const agoraISO = new Date().toISOString();

    const response = await withTimeout(
      getGeminiClient().models.generateContent({
        model: GEMINI_MODEL,
        contents: buildTransactionPrompt(texto, agoraISO),
        config: {
          systemInstruction: SISTEMA_TRANSACAO,
          responseMimeType: 'application/json',
          responseSchema: buildTransactionSchema(categoryMap),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      GEMINI_TIMEOUT_MS,
      'Tempo limite excedido ao chamar o Gemini (extração de gasto).'
    );

    const jsonText = response.text;
    log('info', 'Resposta bruta recebida do Gemini', { requestId, tamanho_resposta: jsonText?.length ?? 0 });

    if (!jsonText) throw new Error('Gemini retornou uma resposta vazia.');

    // IMPORTANTE: o JSON passa como unknown ao guard — sem "as ParsedTransaction".
    // Um string no lugar de number, Infinity ou uma chave extra são detectados aqui.
    const raw = JSON.parse(jsonText);
    return validarTransacao(raw, categoryMap, agoraISO, requestId);
  });
}