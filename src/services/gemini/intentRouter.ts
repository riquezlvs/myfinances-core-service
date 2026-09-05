import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { GEMINI_MODEL } from '../../config/constants';
import { intentSchema } from './schemas';
import { buildIntentPrompt } from './prompts';
import type { Intent } from '../../types/transaction';

/**
 * Roteamento de intenção via IA (substitui a regex do monólito original).
 * Em caso de qualquer falha de parsing, faz fallback seguro para 'OUTROS'
 * — nunca deixa o handler principal quebrar por causa da classificação.
 */
export async function classificarIntencao(texto: string, requestId: string): Promise<Intent> {
  return withTiming('classificar intenção (Gemini)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const genAI = getGeminiClient();
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildIntentPrompt(texto),
      config: {
        responseMimeType: 'application/json',
        responseSchema: intentSchema,
        // classificação é uma tarefa simples — thinking baixo é suficiente e mais barato
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      log('warn', 'Gemini retornou vazio na classificação de intenção; assumindo OUTROS', { requestId });
      return 'OUTROS';
    }

    try {
      const parsed = JSON.parse(jsonText) as { intent: Intent };
      const intencoesValidas: Intent[] = ['NOVO_GASTO', 'PAGAMENTO_DIVIDA', 'CONSULTA', 'OUTROS'];
      if (!intencoesValidas.includes(parsed.intent)) {
        log('warn', 'Intenção fora do enum esperado; assumindo OUTROS', { requestId, recebido: parsed.intent });
        return 'OUTROS';
      }
      return parsed.intent;
    } catch (err) {
      log('warn', 'Falha ao parsear JSON de intenção; assumindo OUTROS', {
        requestId,
        jsonText,
        erro: err instanceof Error ? err.message : String(err),
      });
      return 'OUTROS';
    }
  });
}