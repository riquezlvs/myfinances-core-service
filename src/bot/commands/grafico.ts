import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getGastosPorCategoria } from '../../services/transactions/transactionService';
import { gerarGraficoCategoriasPNG } from '../../services/charts/chartService';

/**
 * Fase 5 — /grafico: envia uma imagem PNG com o gráfico de barras dos
 * gastos do mês atual agrupados por categoria.
 */
export async function handleGrafico(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  try {
    const dados = await getGastosPorCategoria(requestId);

    if (dados.length === 0) {
      await bot.sendMessage(chatId, '📭 Nenhum gasto registrado neste mês para gerar o gráfico.');
      return;
    }

    const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
    const png = await gerarGraficoCategoriasPNG(dados, mesAno);

    await bot.sendPhoto(chatId, png, {
      caption: `📊 Gastos por categoria — ${mesAno}`,
    });
  } catch (err) {
    log('error', 'Erro ao gerar gráfico de categorias', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui gerar o gráfico. Tente novamente.');
  }
}