// src/services/gemini/intentRouter.ts
import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import { GEMINI_MODEL, GEMINI_TIMEOUT_MS } from '../../config/constants';
import { buildPayloadSchema } from './schemas';
import { buildPayloadPrompt, SISTEMA_INTENT } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import { validarPayload, emptyIntentPayload } from './guards/intentGuard';
import { validarTransacao } from './guards/transactionGuard';
import type { IntentPayload } from '../../types/transaction';

/**
 * Roteamento de intenção via IA — Fase 8 (payload único).
 *
 * UMA chamada por mensagem retorna TODA a estrutura: intent + params +
 * transaction. Em caso de qualquer falha de parsing/validação, faz fallback
 * seguro para OUTROS — nunca deixa o handler principal quebrar.
 *
 * Segurança: o LLM NUNCA executa nada; só retorna JSON que passa pelos
 * guards (Zod + allowlist). Não existem intents destrutivas neste enum:
 * "apagar/remover" se degrada para CONFIRMACAO_REQUERIDA.
 */
export async function classificarIntencao(texto: string, requestId: string): Promise<IntentPayload> {
  return withTiming('classificar intenção + extrair dados (Gemini)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const categoryMap = await getCategoryMap(requestId);
    const agoraISO = new Date().toISOString();

    const response = await withTimeout(
      getGeminiClient().models.generateContent({
        model: GEMINI_MODEL,
        contents: buildPayloadPrompt(texto, agoraISO, categoryMap),
        config: {
          systemInstruction: SISTEMA_INTENT,
          responseMimeType: 'application/json',
          responseSchema: buildPayloadSchema(categoryMap),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      GEMINI_TIMEOUT_MS,
      'Tempo limite excedido ao chamar o Gemini (classificação de intenção).'
    );

    const jsonText = response.text;
    if (!jsonText) {
      log('warn', 'Gemini retornou vazio na classificação de intenção; assumindo OUTROS', { requestId });
      return emptyIntentPayload();
    }

    // 8.1 — Auditabilidade: registra o JSON BRUTO do Gemini (truncado para
    // não estourar o log) vinculado ao requestId da mensagem.
    log('info', 'JSON bruto recebido do Gemini (payload único)', {
      requestId,
      bytes: jsonText.length,
      json: jsonText.length > 2000 ? `${jsonText.slice(0, 2000)}…[truncado no log]` : jsonText,
    });

    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch (err) {
      log('warn', 'Falha ao parsear JSON de intenção; assumindo OUTROS', {
        requestId,
        jsonText,
        erro: err instanceof Error ? err.message : String(err),
      });
      return emptyIntentPayload();
    }

    const validado = validarPayload(raw, requestId);
    if (!validado) {
      log('warn', 'Payload de intenção inválido; assumindo OUTROS', { requestId });
      return emptyIntentPayload();
    }

    // NOVO_GASTO: a transação passa pelo transactionGuard
    // (Zod + hard-limits + clamp de data) antes de tocar os services.
    if (validado.intent === 'NOVO_GASTO') {
      if (!validado.transaction) {
        log('warn', 'Gasto classificado sem transaction; tratando como OUTROS', { requestId });
        return emptyIntentPayload();
      }
      try {
        const tx = validarTransacao(validado.transaction, categoryMap, agoraISO, requestId);
        return {
          intent: 'NOVO_GASTO',
          params: validado.params,
          transaction: tx.data,
          avisos: tx.warnings,
        };
      } catch (err) {
        log('warn', 'Transação do payload rejeitada pelo guard; tratando como OUTROS', {
          requestId,
          erro: err instanceof Error ? err.message : String(err),
        });
        return { intent: 'OUTROS', params: {}, transaction: null, avisos: [] };
      }
    }

    if (validado.intent === 'NOVA_ENTRADA') {
      if (!validado.transaction) {
        log('warn', 'Entrada classificada sem transaction; tratando como OUTROS', { requestId });
        return emptyIntentPayload();
      }
      try {
        const tx = validarTransacao(validado.transaction, categoryMap, agoraISO, requestId);
        return {
          intent: 'NOVA_ENTRADA',
          params: validado.params,
          transaction: {
            ...tx.data,
            entry_type: 'income',
            account_name: (validado.transaction as any).account_name ?? validado.params.nomeConta ?? null,
          },
          avisos: tx.warnings,
        };
      } catch (err) {
        log('warn', 'Transação de entrada rejeitada pelo guard; tratando como OUTROS', {
          requestId,
          erro: err instanceof Error ? err.message : String(err),
        });
        return { intent: 'OUTROS', params: {}, transaction: null, avisos: [] };
      }
    }

    return {
      intent: validado.intent,
      params: validado.params,
      transaction: null,
      avisos: [],
    };
  });
}