// src/services/gemini/statementParser.ts
import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { withTimeout } from '../../utils/timeout';
import { GEMINI_MODEL, GEMINI_IMAGE_TIMEOUT_MS } from '../../config/constants';
import { buildStatementSchema } from './schemas';
import { buildStatementPrompt, SISTEMA_EXTRATO } from './prompts';
import { getCategoryMap } from '../categories/categoryCache';
import { listarCartoes } from '../cards/cardService';
import { validarExtrato, type StatementValidado } from './guards/statementGuard';

/**
 * Lê a imagem de um extrato ou fatura bancária (visão multimodal via Gemini 3.5 Flash),
 * extrai os itens estruturados com Zod e retorna a lista pronta para persistência.
 */
export async function interpretarExtrato(
  buffer: Buffer,
  mimeType: string,
  requestId: string,
  comentarioUsuario?: string
): Promise<StatementValidado> {
  return withTiming(
    'chamada ao Gemini (extrato multimodal)',
    { requestId, modelo: GEMINI_MODEL, bytes: buffer.length, mimeType, temComentario: !!comentarioUsuario },
    async () => {
      const [categoryMap, cartoes] = await Promise.all([
        getCategoryMap(requestId),
        listarCartoes(requestId).catch(() => []),
      ]);
      const agoraISO = new Date().toISOString();
      const nomesCartoes = cartoes.map((c) => c.name);

      const response = await withTimeout(
        getGeminiClient().models.generateContent({
          model: GEMINI_MODEL,
          contents: {
            role: 'user',
            parts: [
              { text: buildStatementPrompt(agoraISO, nomesCartoes, comentarioUsuario) },
              { inlineData: { mimeType, data: buffer.toString('base64') } },
            ],
          },
          config: {
            systemInstruction: SISTEMA_EXTRATO,
            responseMimeType: 'application/json',
            responseSchema: buildStatementSchema(categoryMap),
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        GEMINI_IMAGE_TIMEOUT_MS,
        'Tempo limite excedido ao chamar o Gemini para leitura do extrato.'
      );

      const jsonText = response.text;
      log('info', 'Resposta bruta de extrato recebida do Gemini', {
        requestId,
        tamanho_resposta: jsonText?.length ?? 0,
      });

      if (!jsonText) {
        throw new Error('Gemini retornou resposta vazia ao analisar a imagem do extrato.');
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonText);
      } catch (err) {
        log('error', 'Falha ao parsear JSON do Gemini (extrato)', { requestId, jsonText });
        throw new Error('Falha ao processar a resposta do extrato (formato inválido).');
      }

      return validarExtrato(parsedJson, categoryMap, requestId);
    }
  );
}
