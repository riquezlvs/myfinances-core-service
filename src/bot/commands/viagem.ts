/**
 * Fase 9 — Modo viagem: registro de gastos em moeda estrangeira.
 *
 * /viagem — exibe cotações atuais (USD/EUR vs BRL).
 * /viagem registrar <valor> <moeda> — converte e registra em BRL.
 * /viagem histórico — lista gastos em moeda estrangeira do mês.
 *
 * A conversão é determinística (código): a IA apenas extrai o valor e a moeda;
 * o cálculo do BRL é feito em código via exchangeService.
 */

import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import { RODAPE_UX } from '../../config/constants';
import { buscarTaxa, isMoedaSuportada, MOEDAS_SUPORTADAS } from '../../services/exchange/exchangeService';
import { buildViagemKeyboard } from '../keyboards/transactionKeyboard';

const ORIENTACAO =
  '✈️ *Modo Viagem*\n\n' +
  'Use assim:\n' +
  '• `/viagem` — ver cotações atuais\n' +
  '• `/viagem registrar 50 USD` — registra gasto em dólar\n' +
  '• `/viagem historico` — gastos em moeda estrangeira do mês\n\n' +
  'Moedas suportadas: USD (dólar) e EUR (euro)';

export async function handleViagem(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);

  try {
    if (partes.length === 0) {
      await exibirCotacoes(chatId, requestId, bot);
      return;
    }

    const acao = partes[0].toLowerCase();

    if (acao === 'registrar') {
      if (partes.length < 3) {
        await bot.sendMessage(chatId, `⚠️ Informe o valor e a moeda.\n\n${ORIENTACAO}\n\n${RODAPE_UX}`);
        return;
      }
      const valorStr = partes[1];
      const moedaStr = partes[2].toUpperCase();

      if (!isMoedaSuportada(moedaStr)) {
        await bot.sendMessage(
          chatId,
          `⚠️ Moeda "${moedaStr}" não suportada. Use: ${MOEDAS_SUPORTADAS.join(', ')}.\n\n${RODAPE_UX}`
        );
        return;
      }

      const valor = parseFloat(valorStr.replace(',', '.'));
      if (!Number.isFinite(valor) || valor <= 0) {
        await bot.sendMessage(chatId, `⚠️ Valor inválido: "${valorStr}".\n\n${RODAPE_UX}`);
        return;
      }

      const { taxa, daApi } = await buscarTaxa(moedaStr, requestId);
      const valorBRL = Math.round(valor * taxa * 100) / 100;
      const simbolo = moedaStr === 'USD' ? 'US$' : '€';
      const origem = daApi ? 'API' : 'cache/fallback';

      await bot.sendMessage(
        chatId,
        [
          '✅ *Conversão calculada*',
          '',
          `${simbolo} ${valor.toFixed(2).replace('.', ',')} × ${taxa.toFixed(2).replace('.', ',')} = *R$ ${formatarReal(valorBRL)}*`,
          `📡 Fonte: ${origem}`,
          '',
          `Para registrar, use: /gastar ${valorBRL.toFixed(2).replace('.', ',')} descricao`,
          '',
          RODAPE_UX,
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: buildViagemKeyboard() }
      );
      return;
    }

    if (acao === 'historico') {
      await bot.sendMessage(
        chatId,
        `📋 Em breve: histórico de gastos em moeda estrangeira.\n\n${RODAPE_UX}`,
        { reply_markup: buildViagemKeyboard() }
      );
      return;
    }

    await bot.sendMessage(chatId, `⚠️ Comando inválido.\n\n${ORIENTACAO}\n\n${RODAPE_UX}`);
  } catch (err) {
    log('error', 'Erro ao processar /viagem', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, `❌ Não consegui processar o modo viagem. Tente novamente.\n\n${RODAPE_UX}`);
  }
}

async function exibirCotacoes(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  const linhas = ['💱 *Cotações atuais (vs BRL)*', ''];

  for (const moeda of MOEDAS_SUPORTADAS) {
    try {
      const { taxa, daApi } = await buscarTaxa(moeda, requestId);
      const simbolo = moeda === 'USD' ? '🇺🇸' : '🇪🇺';
      const origem = daApi ? '🟢 API' : '🟡 cache';
      linhas.push(`${simbolo} 1 ${moeda} = R$ ${formatarReal(taxa)} ${origem}`);
    } catch {
      linhas.push(`⚠️ ${moeda}: indisponível`);
    }
  }

  linhas.push('', RODAPE_UX);

  await bot.sendMessage(chatId, linhas.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: buildViagemKeyboard(),
  });
}