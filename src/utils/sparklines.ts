/**
 * Sparklines em texto puro (sem dependências): converte uma série de
 * valores em uma linha de caracteres unicode de blocos, ideal para
 * exibir a evolução diária de gastos dentro do /resumo do Telegram.
 */

const BLOCOS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Converte uma série de números em uma sparkline unicode.
 * - Série vazia → string vazia.
 * - Todos os valores iguais (incl. zeros) → blocos médios uniformes.
 * - Escala linear: menor valor → ▁, maior valor → █.
 */
export function gerarSparkline(valores: number[]): string {
  if (valores.length === 0) return '';

  const min = Math.min(...valores);
  const max = Math.max(...valores);

  if (max === min) {
    // Série plana: usa um bloco médio para todos (evita ▁ invisível).
    return BLOCOS[3].repeat(valores.length);
  }

  const amplitude = max - min;
  return valores
    .map((v) => {
      const indice = Math.round(((v - min) / amplitude) * (BLOCOS.length - 1));
      return BLOCOS[Math.min(Math.max(indice, 0), BLOCOS.length - 1)];
    })
    .join('');
}

/**
 * Sparkline com rótulo de dias: preenche os dias do mês (1..ultimoDia)
 * com zeros onde não houve gasto, para que a posição no gráfico
 * corresponda ao dia real do mês.
 */
export function gerarSparklineMensal(gastosPorDia: number[], ultimoDia: number): string {
  const serie = Array.from({ length: ultimoDia }, (_, i) => gastosPorDia[i] ?? 0);
  return gerarSparkline(serie);
}