import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { GEMINI_MODEL } from '../../config/constants';
import { buildTransactionSchema } from './schemas';
import { buildTransactionPrompt } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import type { ParsedTransaction } from '../../types/transaction';

/**
 * Validações e padronizações do gasto extraído pela IA — compartilhadas
 * entre o fluxo de texto (interpretarGasto) e o fluxo de áudio
 * (interpretarAudio), para que ambos tenham exatamente as mesmas regras.
 */
export function validarEPadronizarGasto(
  parsed: ParsedTransaction,
  categoryMap: Record<number, string>,
  agoraISO: string
): ParsedTransaction {
  if (parsed.total_amount <= 0) {
    throw new Error('Valor extraído é inválido (menor ou igual a zero).');
  }
  if (!categoryMap[parsed.category_id]) {
    throw new Error(`category_id inválido retornado pela IA: ${parsed.category_id}`);
  }
  if (parsed.my_share_amount != null && parsed.my_share_amount > parsed.total_amount) {
    throw new Error('my_share_amount não pode ser maior que total_amount.');
  }
  if (parsed.installment_total != null && parsed.installment_total < 2) {
    parsed.installment_total = null; // 1x = tratado como à vista
  }
  if (!parsed.occurred_at) {
    parsed.occurred_at = agoraISO; // salvaguarda caso a IA omita o campo
  }
  return parsed;
}

export async function interpretarGasto(texto: string, requestId: string): Promise<ParsedTransaction> {
  return withTiming('chamada ao Gemini (extrair gasto)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const categoryMap = await getCategoryMap(requestId);
    const agoraISO = new Date().toISOString();

    const response = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: buildTransactionPrompt(texto, agoraISO),
      config: {
        responseMimeType: 'application/json',
        responseSchema: buildTransactionSchema(categoryMap),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const jsonText = response.text;
    log('info', 'Resposta bruta recebida do Gemini', { requestId, tamanho_resposta: jsonText?.length ?? 0 });

    if (!jsonText) throw new Error('Gemini retornou uma resposta vazia.');

    const parsed = JSON.parse(jsonText) as ParsedTransaction;
    return validarEPadronizarGasto(parsed, categoryMap, agoraISO);
  });
}
