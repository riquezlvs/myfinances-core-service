// src/services/gemini/audioParser.ts
import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import { GEMINI_MODEL, GEMINI_AUDIO_TIMEOUT_MS } from '../../config/constants';
import { buildAudioSchema } from './schemas';
import { buildAudioPrompt, SISTEMA_AUDIO } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import { validarTransacao } from './guards/transactionGuard';
import type { Intent, ParsedTransaction } from '../../types/transaction';

/** Allowlist de intenções admitidas via voz — qualquer outra é degradada a OUTROS. */
const INTENCOES_VALIDAS: Intent[] = ['NOVO_GASTO', 'PAGAMENTO_DIVIDA', 'CONSULTA', 'OUTROS'];

export interface ExtracaoDeAudio {
  intent: Intent;
  transcricao: string;
  transaction: ParsedTransaction | null;
  /** Avisos do guard (ex.: data clampeada) para mostrar na confirmação. */
  avisos: string[];
}

export async function interpretarAudio(
  buffer: Buffer,
  mimeType: string,
  requestId: string
): Promise<ExtracaoDeAudio> {
  return withTiming(
    'chamada ao Gemini (áudio multimodal)',
    { requestId, modelo: GEMINI_MODEL, bytes: buffer.length, mimeType },
    async () => {
      const categoryMap = await getCategoryMap(requestId);
      const agoraISO = new Date().toISOString();

      const response = await withTimeout(
        getGeminiClient().models.generateContent({
          model: GEMINI_MODEL,
          contents: {
            role: 'user',
            parts: [
              { text: buildAudioPrompt(agoraISO) },
              { inlineData: { mimeType, data: buffer.toString('base64') } },
            ],
          },
          config: {
            systemInstruction: SISTEMA_AUDIO,
            responseMimeType: 'application/json',
            responseSchema: buildAudioSchema(categoryMap),
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        GEMINI_AUDIO_TIMEOUT_MS,
        'Tempo limite excedido ao chamar o Gemini (transcrição de áudio).'
      );

      const jsonText = response.text;
      log('info', 'Resposta bruta de áudio recebida do Gemini', {
        requestId,
        tamanho_resposta: jsonText?.length ?? 0,
      });

      if (!jsonText) throw new Error('Gemini retornou uma resposta vazia para o áudio.');

      const parsed = JSON.parse(jsonText) as Partial<ExtracaoDeAudio>;
      const transcricao = typeof parsed.transcricao === 'string' ? parsed.transcricao : '';

      // Allowlist anti-alucinação: uma intenção inventada (ou um intent de
      // ação destrutiva injetado no áudio) é degradada a OUTROS — nunca executada.
      if (!INTENCOES_VALIDAS.includes(parsed.intent as Intent)) {
        log('warn', 'Intenção de áudio fora do enum; degradando para OUTROS', {
          requestId,
          recebido: parsed.intent,
        });
        return { intent: 'OUTROS', transcricao, transaction: null, avisos: [] };
      }

      if (parsed.intent === 'NOVO_GASTO') {
        if (!parsed.transaction) {
          throw new Error('Áudio classificado como gasto, sem dados da transação.');
        }
        const resultado = validarTransacao(parsed.transaction, categoryMap, agoraISO, requestId);
        return {
          intent: 'NOVO_GASTO',
          transcricao,
          transaction: resultado.data,
          avisos: resultado.warnings,
        };
      }

      return { intent: parsed.intent as Intent, transcricao, transaction: null, avisos: [] };
    }
  );
}