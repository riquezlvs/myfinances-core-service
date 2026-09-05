import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { withTiming } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import type { GastoPorCategoria } from '../transactions/transactionService';

/**
 * Fase 5 — Gráfico de barras por categoria, gerado como PNG em memória
 * com @napi-rs/canvas (canvas nativo, sem navegador headless — leve o
 * suficiente para o Free Tier).
 */

const LARGURA = 800;
const ALTURA_POR_BARRA = 90;
const ALTURA_MINIMA = 260;
const MARGEM = { topo: 70, esquerda: 40, direita: 40, base: 40 };
const COR_BARRA = '#4f8ef7';
const COR_TEXTO = '#1f2937';
const COR_VALOR = '#111827';
const COR_GRADE = '#e5e7eb';

/** Desenha uma barra com rótulo da categoria e valor. */
function desenharBarra(
  ctx: SKRSContext2D,
  barra: { x: number; y: number; largura: number; altura: number },
  categoria: string,
  valor: number,
  maxValor: number
): void {
  // Barra (altura proporcional ao valor, com mínimo visível de 4px).
  const altura = Math.max(4, (valor / maxValor) * barra.altura);
  ctx.fillStyle = COR_BARRA;
  ctx.fillRect(barra.x, barra.y + barra.altura - altura, barra.largura, altura);

  // Nome da categoria (truncado para caber).
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  const rotulo = categoria.length > 14 ? `${categoria.slice(0, 13)}…` : categoria;
  ctx.fillText(rotulo, barra.x + barra.largura / 2, barra.y + barra.altura + 22);

  // Valor em R$ acima da barra.
  ctx.fillStyle = COR_VALOR;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`R$ ${formatarReal(valor)}`, barra.x + barra.largura / 2, barra.y + barra.altura - altura - 8);
}

/**
 * Gera o PNG do gráfico de barras de gastos por categoria do mês.
 * Retorna o buffer pronto para bot.sendPhoto().
 */
export async function gerarGraficoCategoriasPNG(dados: GastoPorCategoria[], mesAno: string): Promise<Buffer> {
  return withTiming('gerar gráfico de categorias (PNG)', { qtd_categorias: dados.length }, async () => {
    if (dados.length === 0) throw new Error('Sem dados para gerar o gráfico.');

    const altura = Math.max(ALTURA_MINIMA, MARGEM.topo + dados.length * ALTURA_POR_BARRA + MARGEM.base);
    const canvas = createCanvas(LARGURA, altura);
    const ctx = canvas.getContext('2d');

    // Fundo branco.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LARGURA, altura);

    // Título.
    ctx.fillStyle = COR_TEXTO;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Gastos por categoria — ${mesAno}`, MARGEM.esquerda, 44);

    const maxValor = Math.max(...dados.map((d) => d.total));
    const areaUtil = altura - MARGEM.topo - MARGEM.base;
    const alturaBarra = Math.min(48, (areaUtil / dados.length) * 0.55);
    const passo = areaUtil / dados.length;

    // Linhas de grade horizontais leves.
    ctx.strokeStyle = COR_GRADE;
    ctx.lineWidth = 1;
    for (let i = 0; i <= dados.length; i++) {
      const y = MARGEM.topo + i * passo;
      ctx.beginPath();
      ctx.moveTo(MARGEM.esquerda, y);
      ctx.lineTo(LARGURA - MARGEM.direita, y);
      ctx.stroke();
    }

    dados.forEach((d, i) => {
      desenharBarra(
        ctx,
        {
          x: MARGEM.esquerda + 10,
          y: MARGEM.topo + i * passo,
          largura: LARGURA - MARGEM.esquerda - MARGEM.direita - 20,
          altura: alturaBarra,
        },
        d.categoria,
        d.total,
        maxValor
      );
    });

    // Otimização: encode assíncrono libera o event loop durante a
    // compressão PNG (toBuffer seria síncrono e bloqueante).
    return Buffer.from(await canvas.encode('png'));
  });
}
