import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getGastosPorCategoria } from '../../services/transactions/transactionService';
import { listarMetas, type NivelMeta, type StatusMeta } from '../../services/budgets/budgetService';
import {
  gerarGraficoCategoriasPNG,
  type GastoPorCategoriaConStatus,
} from '../../services/charts/chartService';
import { RODAPE_UX } from '../../config/constants';

/** Normaliza para comparação de nomes de categoria (sem acentos, minúsculas). */
function normalizarNome(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * 8.5 — Best-effort: uma falha ao carregar as metas NUNCA derruba o gráfico
 * (todas as barras seguem verdes). Mesmo comportamento do /resumo.
 */
async function listarMetasSeguro(requestId: string): Promise<StatusMeta[]> {
  try {
    return await listarMetas(requestId);
  } catch (err) {
    log('warn', 'Falha ao carregar metas para o gráfico (paleta semafórica ignorada)', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Fase 8.5 — /grafico: envia um PNG com gráfico de barras horizontais dos
 * gastos do mês atual por categoria. A cor de cada barra reflete o status
 * do orçamento (🟢/🟡/🔴) calculado EN CÓDIGO a partir de listarMetas — a IA
 * não participa na decisão cromática.
 */
export async function handleGrafico(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  try {
    const dados = await getGastosPorCategoria(requestId);

    if (dados.length === 0) {
      await bot.sendMessage(chatId, `📭 Nenhum gasto registrado neste mês para gerar o gráfico.\n\n${RODAPE_UX}`);
      return;
    }

    // 8.5 — Associa o nivel de cada categoria (por nome normalizado) aos dados.
    const metas = await listarMetasSeguro(requestId);
    const nivelPorNome = new Map<string, NivelMeta>();
    for (const m of metas) nivelPorNome.set(normalizarNome(m.categoria), m.nivel);

    const dadosConStatus: GastoPorCategoriaConStatus[] = dados.map((d) => ({
      ...d,
      nivel: nivelPorNome.get(normalizarNome(d.categoria)),
    }));

    const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
    const png = await gerarGraficoCategoriasPNG(dadosConStatus, mesAno);

    await bot.sendPhoto(chatId, png, {
      caption: `📊 Gastos por categoria — ${mesAno}\n\n${RODAPE_UX}`,
    });
  } catch (err) {
    log('error', 'Erro ao gerar gráfico de categorias', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, `❌ Não consegui gerar o gráfico. Tente novamente.\n\n${RODAPE_UX}`);
  }
}