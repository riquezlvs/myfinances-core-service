import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { MAX_AUDIO_DURATION_SECONDS } from '../../config/constants';
import { interpretarAudio } from '../../services/gemini/audioParser';
import { registrarEResponderGasto } from './novoGasto';

/**
 * Fase 4 — Processamento de Áudio (Voice-to-Text).
 *
 * Fluxo: intercepta msg.voice/msg.audio → valida duração (Free Tier) →
 * baixa o OGG via getFileLink + fetch → envia o buffer ao Gemini multimodal
 * (transcrição + intenção + transação em uma chamada) → se for gasto,
 * reutiliza o MESMO fluxo de salvamento/confirmação do chat em texto
 * (registrarEResponderGasto), com os mesmos botões interativos.
 */
export async function voiceHandler(
  msg: Message,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const requestId = randomUUID();
  const chatId = msg.chat.id;

  log('info', '🎙️ Mensagem de voz/áudio recebida', {
    requestId,
    chatId,
    userId: msg.from?.id,
    duracao_segundos: msg.voice?.duration ?? msg.audio?.duration,
  });

  if (msg.from?.id !== AUTHORIZED_USER_ID) {
    log('warn', '🚫 Tentativa de acesso não autorizada (áudio)', { requestId, userId: msg.from?.id });
    await bot.sendMessage(chatId, '🚫 Acesso negado.');
    return;
  }

  const audio = msg.voice ?? msg.audio;
  if (!audio) {
    await bot.sendMessage(chatId, '⚠️ Só consigo processar mensagens de voz ou áudio.');
    return;
  }

  if ((audio.duration ?? 0) > MAX_AUDIO_DURATION_SECONDS) {
    await bot.sendMessage(
      chatId,
      `⏱️ Áudio muito longo (${audio.duration}s). Aceito áudios de até ${MAX_AUDIO_DURATION_SECONDS}s — ` +
        'resuma o gasto em um áudio curto ou mande por texto 🙂'
    );
    return;
  }

  // Otimização de memória: barra arquivos grandes ANTES de baixar (o
  // Telegram informa file_size), evitando spikes de heap no Free Tier.
  const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10 MB
  if ((audio.file_size ?? 0) > TAMANHO_MAXIMO_BYTES) {
    await bot.sendMessage(
      chatId,
      '📦 Áudio muito grande para processar. Mande um áudio de voz curto (OGG) ou o gasto em texto 🙂'
    );
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    // 1) Link temporário do arquivo no servidor do Telegram.
    const link = await bot.getFileLink(audio.file_id);

    // 2) Download do OGG para memória (sem arquivos temporários em disco).
    // Timeout de 30s: evita promise pendurada eternamente se o CDN travar.
    const response = await fetch(link, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Download do áudio falhou (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // 3) Transcrição + intenção + extração em uma única chamada multimodal.
    const extracao = await interpretarAudio(buffer, audio.mime_type ?? 'audio/ogg', requestId);
    log('info', 'Áudio processado pelo Gemini', {
      requestId,
      intent: extracao.intent,
      transcricao: extracao.transcricao,
    });

    // 4) Roteia pelo mesmo fluxo do chat em texto.
    if (extracao.intent === 'NOVO_GASTO' && extracao.transaction) {
      await registrarEResponderGasto(
        chatId,
        extracao.transaction,
        `[áudio] ${extracao.transcricao}`,
        requestId,
        bot
      );
      return;
    }

    // Intenções não-suportadas por áudio: mostra a transcrição e orienta.
    await bot.sendMessage(
      chatId,
      [
        `🎙️ Transcrição: "${extracao.transcricao}"`,
        '',
        'Por enquanto, registro de gastos por áudio é o que consigo fazer sozinho. ' +
          'Para pagamentos e consultas, me mande por texto (ex: "minha irmã pagou 25 reais" ou /resumo).',
      ].join('\n')
    );
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : String(err);
    log('error', '❌ Falha no processamento do áudio', { requestId, erro: mensagemErro });
    // Não expõe detalhes internos ao usuário; a causa fica no log (requestId).
    await bot.sendMessage(
      chatId,
      '❌ Não consegui processar seu áudio. Tente novamente — se o problema persistir, ' +
        'mande o gasto em texto (requestId no log para referência).'
    );
  }
}