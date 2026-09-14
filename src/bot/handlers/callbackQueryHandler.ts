import { randomUUID } from 'crypto';
import type { CallbackQuery } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { withTiming, log } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { getCategoryMap } from '../../services/categories/categoryCache';
import { listarCartoes } from '../../services/cards/cardService';
import {
  apagarTransacaoComGrupo,
  apagarTransacoesPorIds,
  atualizarCategoria,
  atualizarCategoriaEmLote,
  atualizarCartaoEmLote,
  atualizarMetodo,
} from '../../services/transactions/transactionService';
import {
  buildSuccessKeyboard,
  buildCategoryKeyboard,
  buildMethodKeyboard,
  buildExtratoKeyboard,
  buildCategoryBatchKeyboard,
  buildCardBatchKeyboard,
  metodoCurtoParaCompleto,
} from '../keyboards/transactionKeyboard';
import { formatarMetodo } from '../../utils/formatters';
import { handleGrafico } from '../commands/grafico';
import { handleResumo } from '../commands/resumo';
import { handleFatura } from '../commands/fatura';
import { handleDividas } from '../commands/dividas';
import { handleInsight } from '../commands/insight';
import { handleMeta } from '../commands/meta';
import { handleStatus } from '../commands/status';
import { handleViagem } from '../commands/viagem';
import { RODAPE_UX } from '../../config/constants';

export async function callbackQueryHandler(
  query: CallbackQuery,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const requestId = randomUUID();
  const data = query.data;
  const message = query.message;

  if (!data || !message) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const chatId = message.chat.id;
  const messageId = message.message_id;

  log('info', '🔘 Callback recebido', { requestId, data, userId: query.from.id });

  if (query.from.id !== AUTHORIZED_USER_ID) {
    await bot.answerCallbackQuery(query.id, { text: '🚫 Acesso negado.' });
    return;
  }

  // 8.6 — Botões de navegação rápida (`nav:<destino>`): ações que NÃO dependem
  // de displayId; reutilizam os comandos existentes (gráfico/resumo/fatura/...).
  const primeiraParte = data.split(':')[0];
  if (primeiraParte === 'nav') {
    await manipularNavegacao(query, bot, chatId, requestId);
    return;
  }

  try {
    const [acao, idStr, extra] = data.split(':');
    // Ações de lote de extrato: catl, crdl, undl, setcl, setcrdl, backl
    if (['catl', 'crdl', 'undl', 'setcl', 'setcrdl', 'backl'].includes(acao)) {
      await manipularAcoesLoteExtrato(query, bot, chatId, messageId, data, requestId);
      return;
    }

    const displayId = Number(idStr);

    if (!Number.isFinite(displayId)) {
      await bot.answerCallbackQuery(query.id, { text: '❓ Ação inválida.' });
      return;
    }

    switch (acao) {
      case 'und': {
        const resultado = await withTiming('callback: desfazer transação', { requestId, displayId }, () =>
          apagarTransacaoComGrupo(displayId, requestId)
        );
        await bot.deleteMessage(chatId, messageId);
        await bot.answerCallbackQuery(query.id, {
          text: resultado.displayIds.length > 1 ? '✅ Compra parcelada desfeita.' : '✅ Gasto desfeito.',
        });
        break;
      }

      case 'catm': {
        const categoryMap = await getCategoryMap(requestId);
        await bot.editMessageReplyMarkup(buildCategoryKeyboard(displayId, categoryMap), {
          chat_id: chatId,
          message_id: messageId,
        });
        await bot.answerCallbackQuery(query.id);
        break;
      }

      case 'metm': {
        await bot.editMessageReplyMarkup(buildMethodKeyboard(displayId), {
          chat_id: chatId,
          message_id: messageId,
        });
        await bot.answerCallbackQuery(query.id);
        break;
      }

      case 'setc': {
        const categoryId = Number(extra);
        const categoryMap = await getCategoryMap(requestId);
        const nomeCategoria = categoryMap[categoryId] ?? 'desconhecida';

        await atualizarCategoria(displayId, categoryId, requestId);
        await bot.editMessageReplyMarkup(buildSuccessKeyboard(displayId, false), {
          chat_id: chatId,
          message_id: messageId,
        });
        await bot.answerCallbackQuery(query.id, { text: `🏷️ Categoria alterada para: ${nomeCategoria}` });
        break;
      }

      case 'setm': {
        const metodo = metodoCurtoParaCompleto(extra);

        await atualizarMetodo(displayId, metodo, requestId);
        await bot.editMessageReplyMarkup(buildSuccessKeyboard(displayId, false), {
          chat_id: chatId,
          message_id: messageId,
        });
        await bot.answerCallbackQuery(query.id, {
          text: `💳 Método alterado para: ${formatarMetodo(metodo)}`,
        });
        break;
      }

      case 'back': {
        await bot.editMessageReplyMarkup(buildSuccessKeyboard(displayId, false), {
          chat_id: chatId,
          message_id: messageId,
        });
        await bot.answerCallbackQuery(query.id);
        break;
      }

      default:
        await bot.answerCallbackQuery(query.id, { text: '❓ Ação não reconhecida.' });
    }
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Callback terminou em erro', { requestId, data, erro: mensagemErro });
    await bot.answerCallbackQuery(query.id, { text: '❌ Algo deu errado. Tente novamente.' });
  }
}

/**
 * 8.6 — Navegação rápida pelos botões inline (`nav:<destino>`): reutiliza as
 * mesmas rotas dos comandos (gráfico/resumo/fatura/dívidas/insight) sem que o
 * usuário digite nada. O destino é validado por lista fixa — qualquer valor
 * fora dela é recusado. Roda apenas após o gate de AUTHORIZED_USER_ID.
 */
async function manipularNavegacao(
  query: CallbackQuery,
  bot: TelegramBot,
  chatId: number,
  requestId: string
): Promise<void> {
  const destino = query.data?.split(':')[1] ?? '';

  switch (destino) {
    case 'grafico':
      await handleGrafico(chatId, requestId, bot);
      break;
    case 'resumo':
      await handleResumo(chatId, requestId, bot);
      break;
    case 'fatura':
      await handleFatura(chatId, requestId, bot);
      break;
    case 'dividas':
      await handleDividas(chatId, requestId, bot);
      break;
    case 'insight':
      await handleInsight(chatId, requestId, bot);
      break;
    case 'meta':
      await handleMeta(chatId, '', requestId, bot);
      break;
    case 'status':
      await handleStatus(chatId, requestId, bot);
      break;
    case 'viagem':
      await handleViagem(chatId, '', requestId, bot);
      break;
    case 'novogasto':
      await bot.sendMessage(
        chatId,
        `➕ Claro! Manda o novo gasto, por exemplo:\n"Gastei 30 no mercado".\n\n${RODAPE_UX}`
      );
      break;
    default:
      await bot.answerCallbackQuery(query.id, { text: '❓ Ação não reconhecida.' });
      return;
  }

  log('info', 'Callback: navegação rápida executada', { requestId, destino });
  await bot.answerCallbackQuery(query.id, { text: '✅ Pronto!' });
}

import { obterLoteIds } from '../../utils/batchStore';

/**
 * Resolve displayIds a partir do sufixo do callback de lote.
 * Suporta tokens do batchStore ("a1b2c3d4") e listas legadas.
 */
function extrairDisplayIdsDeLote(sufixo: string): number[] {
  return obterLoteIds(sufixo);
}

/**
 * Trata ações de edição/cancelamento em lote disparadas pela importação de extrato.
 */
async function manipularAcoesLoteExtrato(
  query: CallbackQuery,
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  data: string,
  requestId: string
): Promise<void> {
  const partes = data.split(':');
  const acao = partes[0]!;

  switch (acao) {
    case 'undl': {
      const sufixo = partes.slice(1).join(':');
      const ids = extrairDisplayIdsDeLote(sufixo);
      await withTiming('callback: desfazer lote extrato', { requestId, count: ids.length }, async () => {
        await apagarTransacoesPorIds(ids, requestId);
      });
      await bot.deleteMessage(chatId, messageId);
      await bot.answerCallbackQuery(query.id, { text: '✅ Importação do extrato desfeita com sucesso.' });
      break;
    }

    case 'catl': {
      const sufixo = partes.slice(1).join(':');
      const categoryMap = await getCategoryMap(requestId);
      await bot.editMessageReplyMarkup(buildCategoryBatchKeyboard(sufixo, categoryMap), {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.answerCallbackQuery(query.id);
      break;
    }

    case 'crdl': {
      const sufixo = partes.slice(1).join(':');
      const cartoes = await listarCartoes(requestId).catch(() => []);
      await bot.editMessageReplyMarkup(buildCardBatchKeyboard(sufixo, cartoes), {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.answerCallbackQuery(query.id);
      break;
    }

    case 'setcl': {
      const categoryId = Number(partes[1]);
      const sufixo = partes.slice(2).join(':');
      const ids = extrairDisplayIdsDeLote(sufixo);
      const categoryMap = await getCategoryMap(requestId);
      const nomeCategoria = categoryMap[categoryId] ?? 'desconhecida';

      await atualizarCategoriaEmLote(ids, categoryId, requestId);
      await bot.editMessageReplyMarkup(buildExtratoKeyboard(sufixo), {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.answerCallbackQuery(query.id, {
        text: `🏷️ Categoria de ${ids.length} lançamentos alterada para: ${nomeCategoria}`,
      });
      break;
    }

    case 'setcrdl': {
      const cardId = partes[1]!;
      const sufixo = partes.slice(2).join(':');
      const ids = extrairDisplayIdsDeLote(sufixo);
      const cartoes = await listarCartoes(requestId).catch(() => []);
      const cartao = cartoes.find((c) => c.id === cardId);
      const nomeCartao = cartao?.name ?? 'Cartão';

      await atualizarCartaoEmLote(ids, cardId, requestId);
      await bot.editMessageReplyMarkup(buildExtratoKeyboard(sufixo), {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.answerCallbackQuery(query.id, {
        text: `💳 Cartão de ${ids.length} lançamentos alterado para: ${nomeCartao}`,
      });
      break;
    }

    case 'backl': {
      const sufixo = partes.slice(1).join(':');
      await bot.editMessageReplyMarkup(buildExtratoKeyboard(sufixo), {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.answerCallbackQuery(query.id);
      break;
    }
  }
}