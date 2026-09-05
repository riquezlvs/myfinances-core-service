import type TelegramBot from 'node-telegram-bot-api';
import { log } from '../../utils/logger';
import { registrarTransacao } from '../../services/transactions/transactionService';
import { getCategoryMap } from '../../services/categories/categoryCache';
import { formatarReal } from '../../utils/formatters';
import { buildSuccessKeyboard } from '../keyboards/transactionKeyboard';
import { verificarMeta } from '../../services/budgets/budgetService';
import { formatarAlertaMeta } from '../commands/meta';
import type { ParsedTransaction } from '../../types/transaction';

/**
 * Fluxo compartilhado de salvamento de um gasto já estruturado: insere no
 * Supabase e responde com a confirmação + botões interativos (desfazer,
 * mudar categoria, alterar método) — usado tanto pelo chat em texto
 * (messageHandler) quanto pelo áudio (voiceHandler), garantindo UX idêntica.
 */
export async function registrarEResponderGasto(
  chatId: number,
  dados: ParsedTransaction,
  rawInput: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const { displayIds } = await registrarTransacao(dados, rawInput, requestId);
  const categoryMap = await getCategoryMap(requestId);
  const categoriaNome = categoryMap[dados.category_id] ?? 'Outros';
  const ehParcelado = displayIds.length > 1;

  let resposta = `✅ Gasto registrado!\n\n📝 ${dados.description}\n💰 R$ ${formatarReal(
    dados.total_amount
  )}\n🏷️ ${categoriaNome}\n💳 ${dados.payment_method}`;

  if (ehParcelado) {
    resposta += `\n🔢 Parcelado em ${displayIds.length}x (IDs #${displayIds.join(', #')})`;
  } else {
    resposta += `\n🆔 #${displayIds[0]}`;
  }

  if (dados.third_party_name) {
    const minhaParte = dados.my_share_amount ?? dados.total_amount;
    resposta += `\n🤝 Dividido com: ${dados.third_party_name} (sua parte: R$ ${formatarReal(minhaParte)})`;
  }

  // Fase 6: alerta proativo de meta (80%/100%) — best-effort, nunca quebra o fluxo.
  const statusMeta = await verificarMeta(dados.category_id, requestId);
  if (statusMeta && statusMeta.nivel !== 'ok') {
    resposta += formatarAlertaMeta(statusMeta);
  }

  await bot.sendMessage(chatId, resposta, {
    reply_markup: buildSuccessKeyboard(displayIds[0], ehParcelado),
  });

  log('info', '✅ Gasto registrado e confirmado ao usuário', { requestId, displayIds });
}