import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { GEMINI_MODEL } from '../../config/constants';
import { buildInsightPrompt } from './prompts';
import {
  getResumoMensal,
  getGastosPorCategoria,
  type ResumoMensal,
  type GastoPorCategoria,
} from '../transactions/transactionService';
import { formatarReal } from '../../utils/formatters';

/**
 * Fase 5 — Insights por IA: agrega os dados do mês corrente (totais,
 * categorias, métodos, recorrentes), monta um prompt analítico e pede
 * ao Gemini uma leitura em linguagem natural do padrão de gastos.
 */

export interface DadosDoMes {
  resumo: ResumoMensal;
  porCategoria: GastoPorCategoria[];
}

/** Agrega todos os dados necessários para o insight (uma única fonte de verdade). */
export async function agregarDadosDoMes(requestId: string): Promise<DadosDoMes> {
  const [resumo, porCategoria] = await Promise.all([
    getResumoMensal(requestId),
    getGastosPorCategoria(requestId),
  ]);
  return { resumo, porCategoria };
}

/** Serializa os agregados em texto compacto para o prompt. */
export function serializarAgregados({ resumo, porCategoria }: DadosDoMes): string {
  const linhas = [
    `- Meu gasto real (minha parte): R$ ${formatarReal(resumo.meuGastoReal)}`,
    `- Gastos recorrentes (minha parte): R$ ${formatarReal(resumo.gastosRecorrentes)}`,
    `- Quantidade de lançamentos: ${resumo.quantidade}`,
    '- Por método de pagamento: ' +
      (resumo.porMetodo.length
        ? resumo.porMetodo.map((m) => `${m.metodo}=R$ ${formatarReal(m.total)}`).join(', ')
        : 'nenhum'),
    '- Por categoria: ' +
      (porCategoria.length
        ? porCategoria.map((c) => `${c.categoria}=R$ ${formatarReal(c.total)}`).join(', ')
        : 'nenhuma'),
  ];
  return linhas.join('\n');
}

/** Chama o Gemini e retorna o texto analítico pronto para envio. */
export async function gerarInsight(requestId: string): Promise<string> {
  return withTiming('chamada ao Gemini (insight mensal)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const dados = await agregarDadosDoMes(requestId);

    if (dados.resumo.quantidade === 0) {
      return '📭 Ainda não há lançamentos neste mês para eu analisar. Registre alguns gastos e tente de novo!';
    }

    const response = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: buildInsightPrompt(serializarAgregados(dados)),
      config: {
        // Texto livre: sem responseSchema — a resposta é prosa analítica.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const texto = response.text?.trim();
    log('info', 'Insight gerado pelo Gemini', { requestId, tamanho: texto?.length ?? 0 });

    if (!texto) throw new Error('Gemini retornou uma resposta vazia para o insight.');
    return texto;
  });
}