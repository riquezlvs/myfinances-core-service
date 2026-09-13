import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../../clients/geminiClient';
import { withTiming, log } from '../../utils/logger';
import { GEMINI_MODEL } from '../../config/constants';
import { buildInsightPrompt, SISTEMA_INSIGHT } from './prompts';
import {
  getResumoMensal,
  getGastosPorCategoria,
  type ResumoMensal,
  type GastoPorCategoria,
} from '../transactions/transactionService';
import { formatarReal } from '../../utils/formatters';

export interface DadosDoMes {
  resumo: ResumoMensal;
  porCategoria: GastoPorCategoria[];
}

/** Projeção de fechamento do mês: quanto vai gastar se mantiver o ritmo. */
export interface ProjecaoFechamento {
  totalAtual: number;
  diasPassados: number;
  diasNoMes: number;
  projecao: number;
}

export async function agregarDadosDoMes(requestId: string): Promise<DadosDoMes> {
  const [resumo, porCategoria] = await Promise.all([
    getResumoMensal(requestId),
    getGastosPorCategoria(requestId),
  ]);
  return { resumo, porCategoria };
}

/**
 * 8.7 — Projeção determinística de fechamento do mês (código, nunca IA).
 * Fórmula: (totalGasto / diasPassados) * diasNoMes.
 * - Se ainda não passou nenhum dia (1º do mês), retorna 0.
 * - Segurança: nunca retorna Infinity/NaN (hard-limit).
 */
export function calcularProjecaoFechamento(
  totalAtual: number,
  referencia: Date = new Date()
): ProjecaoFechamento {
  const hoje = referencia;
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const diasPassados = hoje.getDate();

  if (diasPassados === 0 || !Number.isFinite(totalAtual) || totalAtual <= 0) {
    return { totalAtual: totalAtual || 0, diasPassados: diasPassados || 0, diasNoMes, projecao: 0 };
  }

  const projecao = Math.round((totalAtual / diasPassados) * diasNoMes * 100) / 100;

  // Hard-limit: nunca retorna Infinity ou valor absurdo (> R$ 10 milhões).
  const projecaoSegura = Number.isFinite(projecao) && projecao >= 0 && projecao <= 10_000_000
    ? projecao
    : 0;

  return { totalAtual, diasPassados, diasNoMes, projecao: projecaoSegura };
}

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

/** 8.7 — Serializa a projeção de fechamento para injetar no prompt. */
export function serializarProjecao(projecao: ProjecaoFechamento): string {
  const fmt = (n: number) => formatarReal(n);
  return (
    `- Projeção de fechamento do mês: R$ ${fmt(projecao.projecao)} ` +
    `(${projecao.diasPassados} dia(s) de ${projecao.diasNoMes}, total atual: R$ ${fmt(projecao.totalAtual)})`
  );
}

export async function gerarInsight(requestId: string): Promise<string> {
  return withTiming('chamada ao Gemini (insight mensal)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const dados = await agregarDadosDoMes(requestId);

    if (dados.resumo.quantidade === 0) {
      return '📭 Ainda não há lançamentos neste mês para eu analisar. Registre alguns gastos e tente de novo!';
    }

    // 8.7 — Calcula projeção de fechamento em código (custo zero).
    const projecao = calcularProjecaoFechamento(dados.resumo.meuGastoReal);
    const contextoProjecao = projecao.diasPassados > 1
      ? `\n\n${serializarProjecao(projecao)}\n⚠️ Importante: se a projeção indicar que você vai estourar alguma meta de categoria ou o orçamento global, avise o usuário de forma clara e proativa.`
      : '';

    const response = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: buildInsightPrompt(serializarAgregados(dados) + contextoProjecao),
      config: {
        systemInstruction: SISTEMA_INSIGHT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const texto = response.text?.trim();
    log('info', 'Insight gerado pelo Gemini', { requestId, tamanho: texto?.length ?? 0 });

    if (!texto) throw new Error('Gemini retornou uma resposta vazia para o insight.');
    return texto;
  });
}