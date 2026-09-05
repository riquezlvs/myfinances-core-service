import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { exportarGastosDoMesCSV, exportarDividasCSV } from '../../services/export/exportService';

/**
 * Comando /exportar — gera um CSV em memória e envia como documento.
 *
 * Uso:
 *   /exportar            → gastos do mês atual (padrão)
 *   /exportar gastos     → idem
 *   /exportar dividas    → saldos devedores por pessoa
 */
export async function handleExportar(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
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
        { caption: '💸 Dívidas em aberto (saldo por pessoa).' },
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

    const { nome, buffer, linhas } = await exportarGastosDoMesCSV(requestId);
    if (linhas === 0) {
      await bot.sendMessage(chatId, '📭 Nenhum gasto registrado neste mês para exportar.');
      return;
    }

    const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
    await bot.sendDocument(
      chatId,
      buffer,
      { caption: `📊 Gastos de ${mesAno} — ${linhas} registro(s).` },
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