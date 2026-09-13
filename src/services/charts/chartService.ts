import { createCanvas } from '@napi-rs/canvas';
import { withTiming } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import type { GastoPorCategoria } from '../transactions/transactionService';
import type { NivelMeta } from '../budgets/budgetService';

/**
 * Fase 8.5 — Gráfico de barras HORIZONTALES por categoria, gerado como PNG
 * em memória com @napi-rs/canvas (canvas nativo, sem navegador headless —
 * leve para o Free Tier). Barras horizontais = nomes longos de categorias
 * legíveis, eixo X com escala explícita de valores (R$) e paleta semafórica
 * ligada ao status do orçamento (🟢 < 80%, 🟡 >= 80%, 🔴 100% estourado).
 * A cor NUNCA vem da IA: decisão puramente do código.
 */

/** 8.5 — Gasto por categoria enriquecido com o status da meta (budgetService). */
export interface GastoPorCategoriaConStatus extends GastoPorCategoria {
  /** Status da meta (ok | aviso80 | limite100). Ausente ou null = sem meta (verde). */
  nivel?: NivelMeta;
}

const LARGURA = 860;
const ALTURA_FILA = 50;
const ALTURA_MINIMA = 300;
const MARGEM = { topo: 64, base: 44, entrefilas: 8 };

const COR_FONDO = '#ffffff';
const COR_TEXTO = '#1f2937';
const COR_GRADE = '#e5e7eb';
const COR_GRADE_ROTULO = '#6b7280';

/** Largura máxima do nome da categoria antes de truncar no eixo Y. */
const NOME_MAX = 24;

/**
 * 8.5 — Paleta semafórica (integração com budgetService): cor por status.
 * Exportada para testes unitários puros.
 */
export const COR_POR_NIVEL: Record<NivelMeta, string> = {
  ok: '#2e9e5b',
  aviso80: '#f0a820',
  limite100: '#d64545',
};

/** Cor de uma barra a partir do status; sem meta -> verde (ok). */
export function corParaNivel(nivel: NivelMeta | undefined): string {
  return COR_POR_NIVEL[nivel ?? 'ok'];
}

function truncarNome(nome: string): string {
  return nome.length > NOME_MAX ? `${nome.slice(0, NOME_MAX - 1)}…` : nome;
}

/**
 * 8.5 — Gera o PNG do gráfico de barras horizontais de gastos por categoria.
 * Retorna o buffer pronto para bot.sendPhoto().
 */
export async function gerarGraficoCategoriasPNG(
  dados: GastoPorCategoriaConStatus[],
  mesAno: string
): Promise<Buffer> {
  return withTiming('gerar gráfico de categorias (PNG)', { qtd_categorias: dados.length }, async () => {
    if (dados.length === 0) throw new Error('Sem dados para gerar o gráfico.');

    // Margem esquerdo dinâmico: o nome mais longo define a largura do eixo Y.
    const nomeMaxLargo = Math.max(...dados.map((d) => truncarNome(d.categoria).length));
    const margemEsq = Math.min(300, Math.max(140, nomeMaxLargo * 7.6 + 22));
    const larguraUtil = LARGURA - margemEsq - 50;

    const alturaTotal = Math.max(ALTURA_MINIMA, MARGEM.topo + dados.length * ALTURA_FILA + MARGEM.base);
    const canvas = createCanvas(LARGURA, alturaTotal);
    const ctx = canvas.getContext('2d');

    // Fundo branco.
    ctx.fillStyle = COR_FONDO;
    ctx.fillRect(0, 0, LARGURA, alturaTotal);

    // Título.
    ctx.fillStyle = COR_TEXTO;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Gastos por categoria — ${mesAno}`, margemEsq, 44);

    const maxValor = Math.max(...dados.map((d) => d.total));

    // Eixo X: escala explícita de valores (0%, 25%, 50%, 75%, 100%) com
    // linhas de grade verticais e rótulo em R$ (legibilidade dos valores).
    ctx.strokeStyle = COR_GRADE;
    ctx.lineWidth = 1;
    ctx.fillStyle = COR_GRADE_ROTULO;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    const passosEixoX = 4;
    for (let i = 0; i <= passosEixoX; i++) {
      const fracao = i / passosEixoX;
      const x = margemEsq + larguraUtil * fracao;
      ctx.beginPath();
      ctx.moveTo(x, MARGEM.topo);
      ctx.lineTo(x, alturaTotal - MARGEM.base);
      ctx.stroke();
      ctx.fillText(`R$ ${formatarReal(maxValor * fracao)}`, x, alturaTotal - MARGEM.base + 20);
    }

    // Filas: nome (eixo Y) + barra horizontal proporcional + valor em R$.
    dados.forEach((d, i) => {
      const topoFila = MARGEM.topo + i * ALTURA_FILA + MARGEM.entrefilas;
      const alturaBarra = ALTURA_FILA - MARGEM.entrefilas * 2;
      const largura = Math.max(4, (d.total / maxValor) * larguraUtil);
      const cor = corParaNivel(d.nivel);

      // Nome da categoria alinhado à esquerda (sem cortes: o margem se adapta).
      ctx.fillStyle = COR_TEXTO;
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(truncarNome(d.categoria), 8, topoFila + alturaBarra / 2 + 5);

      // Barra horizontal com cor semafórica.
      ctx.fillStyle = cor;
      ctx.fillRect(margemEsq, topoFila, largura, alturaBarra);

      // Valor em R$: dentro da barra (branco) quando cabe; senão à direita.
      const etiquetaValor = `R$ ${formatarReal(d.total)}`;
      ctx.font = 'bold 14px sans-serif';
      const larguraRotulo = etiquetaValor.length * 7.4;
      if (largura >= larguraRotulo + 20) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(etiquetaValor, margemEsq + largura - 10, topoFila + alturaBarra / 2 + 5);
      } else {
        ctx.fillStyle = COR_TEXTO;
        ctx.textAlign = 'left';
        ctx.fillText(etiquetaValor, margemEsq + largura + 8, topoFila + alturaBarra / 2 + 5);
      }
    });

    // Otimização: encode assíncrono libera o event loop durante a
    // compressão PNG (toBuffer seria síncrono e bloqueante).
    return Buffer.from(await canvas.encode('png'));
  });
}
