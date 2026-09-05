import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { GEMINI_MODEL } from '../../config/constants';
import { buildAudioSchema } from './schemas';
import { buildAudioPrompt } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import { validarEPadronizarGasto } from './transactionParser';
import type { Intent, ParsedTransaction } from '../../types/transaction';

/**
 * Resultado do processamento multimodal de um áudio: transcrição +
 * intenção + (opcional) transação extraída — tudo em uma única chamada
 * ao Gemini, reaproveitando o mesmo schema do fluxo de texto.
 */
export interface ExtracaoDeAudio {
  intent: Intent;
  transcricao: string;
  transaction: ParsedTransaction | null;
}

/**
 * Envia o buffer de áudio (OGG/OGA do Telegram) diretamente ao Gemini
 * usando a capacidade multimodal nativa do SDK (inlineData em base64).
 */
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

      const response = await getGeminiClient().models.generateContent({
        model: GEMINI_MODEL,
        contents: {
          role: 'user',
          parts: [
            { text: buildAudioPrompt(agoraISO) },
            { inlineData: { mimeType, data: buffer.toString('base64') } },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: buildAudioSchema(categoryMap),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const jsonText = response.text;
      log('info', 'Resposta bruta de áudio recebida do Gemini', {
        requestId,
        tamanho_resposta: jsonText?.length ?? 0,
      });

      if (!jsonText) throw new Error('Gemini retornou uma resposta vazia para o áudio.');

      const parsed = JSON.parse(jsonText) as ExtracaoDeAudio;

      if (parsed.intent === 'NOVO_GASTO') {
        if (!parsed.transaction) {
          throw new Error('Áudio classificado como gasto, mas sem dados da transação.');
        }
        parsed.transaction = validarEPadronizarGasto(parsed.transaction, categoryMap, agoraISO);
      } else {
        parsed.transaction = null;
      }

      return parsed;
    }
  );
}