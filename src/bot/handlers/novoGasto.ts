import type TelegramBot from 'node-telegram-bot-api';
import { log } from '../../utils/logger';
import { registrarTransacao } from '../../services/transactions/transactionService';
import { getCategoryMap } from '../../services/categories/categoryCache';
import { inferirMetodoPagamento } from '../../services/cards/paymentInference';
import { formatarMetodo, formatarReal } from '../../utils/formatters';
import { buildGastoKeyboard } from '../keyboards/transactionKeyboard';
import { verificarMeta } from '../../services/budgets/budgetService';
import { formatarAlertaMeta } from '../commands/meta';
import { RODAPE_UX } from '../../config/constants';
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
  bot: TelegramBot,
  avisos: string[] = []
): Promise<void> {
  const categoryMap = await getCategoryMap(requestId);

  // 8.2 — Método de pagamento: resolve o cartão correspondente ou INFERE pela
  // categoria (determinístico, em código — nunca decisão do LLM).
  const decisao = await inferirMetodoPagamento(dados, categoryMap, requestId);
  const dadosComPagamento: ParsedTransaction = {
    ...dados,
    payment_method: decisao.payment_method,
    card_id: decisao.card_id,
  };

  const { displayIds } = await registrarTransacao(dadosComPagamento, rawInput, requestId);
  const categoriaNome = categoryMap[dados.category_id] ?? 'Outros';
  const ehParcelado = displayIds.length > 1;

  const cartaoInfo = decisao.cartaoNome ? ` (${decisao.cartaoNome})` : '';
  let resposta = `✅ Gasto registrado!\n\n📝 ${dados.description}\n💰 R$ ${formatarReal(
    dados.total_amount
  )}\n🏷️ ${categoriaNome}\n💳 ${formatarMetodo(decisao.payment_method)}${cartaoInfo}`;

  if (ehParcelado) {
    resposta += `\n🔢 Parcelado em ${displayIds.length}x (IDs #${displayIds.join(', #')})`;
  } else {
    resposta += `\n🆔 #${displayIds[0]}`;
  }

  if (dados.third_party_names?.length || dados.third_party_name) {
    const nomes = dados.third_party_names?.length
      ? dados.third_party_names
      : [dados.third_party_name as string];
    // 8.7 — Sem valor informado, a parte própria é equitativa (igual ao
    // cálculo do registrarTransacao): total / (pessoas + você).
    const minhaParte =
      dados.my_share_amount ?? Math.round((dados.total_amount / (nomes.length + 1)) * 100) / 100;
    resposta += `\n🤝 Dividido com: ${nomes.join(', ')} (sua parte: R$ ${formatarReal(minhaParte)})`;
  }

  // Fase 6: alerta proativo de meta (80%/100%) — best-effort, nunca quebra o fluxo.
  const statusMeta = await verificarMeta(dados.category_id, requestId);
  if (statusMeta && statusMeta.nivel !== 'ok') {
    resposta += formatarAlertaMeta(statusMeta);
  }

  // Fase 8: avisos do guard (ex.: data clampeada) + aviso de método inferido.
  const avisosFinais = decisao.aviso ? [...avisos, decisao.aviso] : avisos;
  if (avisosFinais.length > 0) {
    resposta += `\n${avisosFinais.join('\n')}`;
  }

  // 8.1 — Rodapé humanizado padrão de fechamento de fluxo.
  resposta += `\n\n${RODAPE_UX}`;

  // 8.6 — Teclado dinâmico: desfazer/editar + navegação rápida (resumo,
  // adicionar outro) + botões contextuais de gráfico/insight quando a meta
  // estourou (nível limite100). Os callbacks passam SEMPRE pelo gate de autorização.
  const alertaEstouro = statusMeta?.nivel === 'limite100';

  await bot.sendMessage(chatId, resposta, {
    reply_markup: buildGastoKeyboard(displayIds[0], ehParcelado, alertaEstouro),
  });

  log('info', '✅ Gasto registrado e confirmado ao usuário', { requestId, displayIds });
}