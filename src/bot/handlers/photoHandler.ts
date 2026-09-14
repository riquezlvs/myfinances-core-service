// src/bot/handlers/photoHandler.ts
import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { MAX_IMAGE_FILE_SIZE_BYTES, RODAPE_UX } from '../../config/constants';
import { interpretarExtrato } from '../../services/gemini/statementParser';
import { listarCartoes } from '../../services/cards/cardService';
import {
  registrarLoteExtrato,
  type ItemLoteExtrato,
} from '../../services/transactions/transactionService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';
import { buildExtratoKeyboard } from '../keyboards/transactionKeyboard';

/**
 * Intercepta imagens enviadas ao bot (ex: fotos ou screenshots de extratos/faturas),
 * envia ao Gemini 3.5 Flash multimodal para OCR estruturado, resolve o cartão de crédito,
 * filtra duplicidades e registra as despesas na base.
 */
export async function photoHandler(
  msg: Message,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const requestId = randomUUID();
  const chatId = msg.chat.id;

  log('info', '📸 Imagem recebida no chat', {
    requestId,
    chatId,
    userId: msg.from?.id,
    qtd_tamanhos: msg.photo?.length ?? 0,
  });

  if (msg.from?.id !== AUTHORIZED_USER_ID) {
    log('warn', '🚫 Tentativa de acesso não autorizada (imagem)', {
      requestId,
      userId: msg.from?.id,
    });
    await bot.sendMessage(chatId, '🚫 Acesso negado.');
    return;
  }

  const photos = msg.photo;
  if (!photos || photos.length === 0) {
    await bot.sendMessage(chatId, '⚠️ Não consegui acessar a imagem enviada.');
    return;
  }

  // Pega a versão com maior resolução (último item do array no Telegram)
  const maiorFoto = photos[photos.length - 1]!;

  if ((maiorFoto.file_size ?? 0) > MAX_IMAGE_FILE_SIZE_BYTES) {
    await bot.sendMessage(
      chatId,
      '📦 Imagem muito pesada para processar. Envie uma foto ou captura de tela de até 15MB 🙂'
    );
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    // 1) Link temporário do arquivo no servidor do Telegram
    const link = await bot.getFileLink(maiorFoto.file_id);

    // 2) Download da imagem para buffer em memória
    const response = await fetch(link, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Download da imagem falhou (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // Captura legenda/comentário enviado junto com a imagem (ex: "Fatura Viagem Rio", "Nubank Setembro")
    const legenda = msg.caption?.trim() || undefined;

    await bot.sendMessage(chatId, '🔍 Analisando extrato/fatura... Aguarde um instante.');

    // 3) Leitura multimodal estruturada com Gemini 3.5 Flash
    const extrato = await interpretarExtrato(buffer, 'image/jpeg', requestId, legenda);

    if (!extrato.items.length) {
      await bot.sendMessage(
        chatId,
        'ℹ️ Não encontrei nenhuma transação ou compra legível nesta imagem. ' +
          'Certifique-se de que a foto está nítida e mostra valores e descrições claras.'
      );
      return;
    }

    // 4) Identificação e vinculação de Cartão
    const cartoes = await listarCartoes(requestId).catch(() => []);
    let cartaoEscolhido = cartoes.find((c) => c.card_type === 'credit' && c.is_default);

    // Se a legenda ou hint indicar o cartão, prioriza correspondência
    const textoParaBuscaCartao = `${legenda ?? ''} ${extrato.card_name_hint ?? ''}`.toLowerCase();
    if (textoParaBuscaCartao.trim()) {
      const match = cartoes.find((c) => {
        const nomeC = c.name.toLowerCase();
        return textoParaBuscaCartao.includes(nomeC) || (extrato.card_name_hint && nomeC.includes(extrato.card_name_hint.toLowerCase()));
      });
      if (match) {
        cartaoEscolhido = match;
      }
    }

    // 5) Converte os itens para persistência
    const itensParaLote: ItemLoteExtrato[] = extrato.items.map((item) => ({
      description: item.description,
      amount: item.amount,
      category_id: item.category_id,
      occurred_at: item.date.includes('T') ? item.date : `${item.date}T12:00:00-03:00`,
      installment_number: item.installment_current,
      installment_total: item.installment_total,
    }));

    // 6) Registro em lote no banco com prevenção de duplicidades
    const resultadoLote = await registrarLoteExtrato({
      cardId: cartaoEscolhido?.id ?? null,
      itens: itensParaLote,
      comentarioLote: legenda,
      requestId,
    });

    const totalRegistrado = resultadoLote.inseridos.reduce((soma, i) => soma + i.amount, 0);
    const cartaoLabel = cartaoEscolhido ? `💳 *Cartão:* ${cartaoEscolhido.name}` : '💳 *Método:* Cartão de crédito';
    const tituloExtrato = legenda ? `📄 *Extrato processado — "${legenda}"*` : '📄 *Extrato processado com sucesso!*';

    const linhasMsg: string[] = [
      tituloExtrato,
      '',
      cartaoLabel,
      `✅ *Lançamentos registrados:* ${resultadoLote.inseridos.length} (Total: R$ ${formatarReal(totalRegistrado)})`,
    ];

    if (resultadoLote.inseridos.length > 0) {
      linhasMsg.push('');
      linhasMsg.push('*Lançamentos:*');
      for (const item of resultadoLote.inseridos.slice(0, 10)) {
        linhasMsg.push(`   • #${item.displayId} · ${item.description} — R$ ${formatarReal(item.amount)}`);
      }
      if (resultadoLote.inseridos.length > 10) {
        linhasMsg.push(`   • ...e mais ${resultadoLote.inseridos.length - 10} compras.`);
      }
    }

    if (resultadoLote.duplicados.length > 0) {
      linhasMsg.push('');
      linhasMsg.push(`⚠️ *Ignorados por duplicidade (${resultadoLote.duplicados.length}):*`);
      for (const dup of resultadoLote.duplicados.slice(0, 5)) {
        linhasMsg.push(`   • ${dup.description} (R$ ${formatarReal(dup.amount)}) em ${formatarDataCurta(dup.data)}`);
      }
      if (resultadoLote.duplicados.length > 5) {
        linhasMsg.push(`   • ...e outros ${resultadoLote.duplicados.length - 5} já existentes.`);
      }
    }

    linhasMsg.push('');
    linhasMsg.push(RODAPE_UX);

    const displayIdsInseridos = resultadoLote.inseridos.map((i) => i.displayId);
    const replyMarkup =
      displayIdsInseridos.length > 0 ? buildExtratoKeyboard(displayIdsInseridos) : undefined;

    await bot.sendMessage(chatId, linhasMsg.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  } catch (err) {
    const msgErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Falha ao processar extrato via imagem', { requestId, erro: msgErro });
    await bot.sendMessage(
      chatId,
      '❌ Não consegui processar a imagem do extrato. Verifique se a foto está legível e tente novamente 🙂'
    );
  }
}
