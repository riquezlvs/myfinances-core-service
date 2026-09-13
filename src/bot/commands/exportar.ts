import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { exportarGastosDoMesCSV, exportarDividasCSV } from '../../services/export/exportService';
import { mesAnoNaJanela } from '../../utils/month';
import { RODAPE_UX } from '../../config/constants';

/** Opções vindas da rota de linguagem natural (IntentRouter → params). */
export interface ExportarOpcoes {
  /** Mês (YYYY-MM) já validado pelo intentGuard (regex) — revalidado aqui. */
  mesAno?: string;
}

/**
 * Comando /exportar — gera um CSV em memória e envia como documento.
 *
 * Uso:
 *   /exportar            → gastos do mês atual (padrão)
 *   /exportar gastos     → idem
 *   /exportar dividas    → saldos devedores por pessoa
 * Rota de IA: "manda a planilha de setembro" → opcoes.mesAno = '2026-09'.
 */
export async function handleExportar(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot(),
  opcoes: ExportarOpcoes = {}
): Promise<void> {
  const alvo = argumentos.trim().toLowerCase();

  try {
    if (alvo.startsWith('divida')) {
      const { nome, buffer, linhas } = await exportarDividasCSV(requestId);
      if (linhas === 0) {
        await bot.sendMessage(chatId, '✅ Nenhuma dívida em aberto para exportar.');
        return;
      }
      await bot.sendDocument(
        chatId,
        buffer,
        { caption: `💸 Dívidas em aberto (saldo por pessoa).\n\n${RODAPE_UX}` },
        { filename: nome, contentType: 'text/csv' }
      );
      return;
    }

    if (alvo && !alvo.startsWith('gasto')) {
      await bot.sendMessage(
        chatId,
        'Use assim:\n/exportar — gastos do mês atual\n/exportar dividas — saldos devedores'
      );
      return;
    }

    // Hard-limit em código: a IA sugere o mês, o CÓDIGO decide a janela.
    const mesAno = opcoes.mesAno;
    if (mesAno && !mesAnoNaJanela(mesAno)) {
      await bot.sendMessage(
        chatId,
        '⚠️ Só consigo exportar meses dos últimos 12 (ou o próximo). Me diga outro período — ex: "exporta setembro" ou /exportar.'
      );
      return;
    }

    const resultado =
      mesAno !== undefined
        ? await exportarGastosDoMesCSV(requestId, mesAno)
        : await exportarGastosDoMesCSV(requestId);
    const { nome, buffer, linhas } = resultado;
    if (linhas === 0) {
      await bot.sendMessage(chatId, '📭 Nenhum gasto registrado neste mês para exportar.');
      return;
    }

    const dataReferencia = mesAno
      ? new Date(Number(mesAno.slice(0, 4)), Number(mesAno.slice(5, 7)) - 1, 1)
      : new Date();
    const mesAnoFormatado = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
    }).format(dataReferencia);
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `📊 Gastos de ${mesAnoFormatado} — ${linhas} registro(s).\n\n${RODAPE_UX}` },
      { filename: nome, contentType: 'text/csv' }
    );
  } catch (err) {
    log('error', 'Erro ao exportar CSV', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, '❌ Não consegui gerar o CSV. Tente novamente.');
  }
}