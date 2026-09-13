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

/**
 * 8.5 — Barra proporcional em texto puro para mensagens (10 células por
 * padrão). O cálculo usa Math.floor para que a barra nunca mostre mais
 * proporção que a real, e se limita a [0, tamanho]: um gasto a 125% do
 * limite mostra uma barra cheia, não desbordada — o percentual textual
 * apresenta o excesso. Um maxRef menor ou igual a zero retorna a barra
 * totalmente vazia, evitando a divisão por zero.
 */
export function gerarBarraTexto(valor: number, maxRef: number, tamanho = 10): string {
  const maxAbs = Math.max(maxRef, 0);
  const n = Math.max(Math.floor(tamanho), 0);
  if (maxAbs <= 0 || n === 0) return '░'.repeat(n);
  const preenchido = Math.min(Math.floor((valor / maxAbs) * n), n);
  return '█'.repeat(preenchido) + '░'.repeat(n - preenchido);
}