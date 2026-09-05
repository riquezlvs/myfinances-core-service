import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import {
  definirMeta,
  listarMetas,
  removerMeta,
  type StatusMeta,
} from '../../services/budgets/budgetService';

const ICONE_NIVEL: Record<StatusMeta['nivel'], string> = {
  ok: '🟢',
  aviso80: '🟡',
  limite100: '🔴',
};

/** Lista as metas com o consumo atual do mês. */
export async function handleMetaListar(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const metas = await listarMetas(requestId);

  if (metas.length === 0) {
    await bot.sendMessage(
      chatId,
      '📭 Nenhuma meta definida.\n\nUse `/meta <categoria> <limite>` para criar (ex: `/meta alimentacao 600`).'
    );
    return;
  }

  const linhas = metas.map((m) => {
    const icone = ICONE_NIVEL[m.nivel];
    return `${icone} ${m.categoria}: R$ ${formatarReal(m.gastoAtual)} / R$ ${formatarReal(
      m.limite
    )} (${m.percentual.toFixed(0)}%)`;
  });

  await bot.sendMessage(
    chatId,
    ['🎯 *Metas do mês:*', '', ...linhas, '', 'Remova com `/meta remover <categoria>`.'].join('\n'),
    { parse_mode: 'Markdown' }
  );
}

/**
 * /meta <categoria> <limite> — define a meta.
 * /meta remover <categoria> — remove a meta.
 * /meta — lista.
 */
export async function handleMeta(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);

  if (partes.length === 0) {
    await handleMetaListar(chatId, requestId, bot);
    return;
  }

  if (partes[0].toLowerCase() === 'remover') {
    const nome = partes.slice(1).join(' ');
    if (!nome) {
      await bot.sendMessage(chatId, 'Use assim: /meta remover alimentacao');
      return;
    }
    try {
      const removida = await removerMeta(nome, requestId);
      if (!removida) {
        await bot.sendMessage(chatId, `❓ Não encontrei a categoria "${nome}".`);
        return;
      }
      await bot.sendMessage(chatId, `🗑️ Meta de "${removida}" removida.`);
    } catch (err) {
      log('error', 'Erro ao remover meta', { requestId, erro: err instanceof Error ? err.message : String(err) });
      await bot.sendMessage(chatId, '❌ Não consegui remover a meta. Tente novamente.');
    }
    return;
  }

  // /meta <categoria> <limite>: o limite é o último token numérico.
  const limiteStr = partes[partes.length - 1];
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(limiteStr)) {
    await bot.sendMessage(chatId, 'Use assim: /meta alimentacao 600');
    return;
  }
  const limite = parseFloat(limiteStr.replace(',', '.'));
  const nomeCategoria = partes.slice(0, -1).join(' ');

  if (!nomeCategoria || limite <= 0) {
    await bot.sendMessage(chatId, 'Use assim: /meta alimentacao 600');
    return;
  }

  try {
    const resultado = await definirMeta(nomeCategoria, limite, requestId);
    if (!resultado) {
      await bot.sendMessage(chatId, `❓ Não encontrei a categoria "${nomeCategoria}".`);
      return;
    }
    await bot.sendMessage(
      chatId,
      `✅ Meta definida!\n\n🏷️ ${resultado.categoria}\n🎯 Limite mensal: R$ ${formatarReal(resultado.limite)}\n\n` +
        'Vou te avisar quando passar de 80% ou estourar o limite.'
    );
  } catch (err) {
    log('error', 'Erro ao definir meta', { requestId, erro: err instanceof Error ? err.message : String(err) });
    await bot.sendMessage(chatId, '❌ Não consegui definir a meta. Tente novamente.');
  }
}

/** Formata o alerta de meta para anexar à confirmação de um gasto. */
export function formatarAlertaMeta(status: StatusMeta): string {
  if (status.nivel === 'limite100') {
    const excedente = status.gastoAtual - status.limite;
    return (
      `\n🔴 *Meta de ${status.categoria} estourada!*\n` +
      `R$ ${formatarReal(status.gastoAtual)} de R$ ${formatarReal(status.limite)} ` +
      `(excedeu R$ ${formatarReal(excedente)})`
    );
  }
  return (
    `\n🟡 *Atenção: ${status.categoria} em ${status.percentual.toFixed(0)}% da meta*\n` +
    `R$ ${formatarReal(status.gastoAtual)} de R$ ${formatarReal(status.limite)}`
  );
}