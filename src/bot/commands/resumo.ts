import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getResumoMensal, getGastosDiariosDoMes } from '../../services/transactions/transactionService';
import { listarMetas, type StatusMeta } from '../../services/budgets/budgetService';
import { formatarReal } from '../../utils/formatters';
import { gerarSparklineMensal, gerarBarraTexto } from '../../utils/sparklines';
import { buildResumoKeyboard } from '../keyboards/transactionKeyboard';
import { RODAPE_UX } from '../../config/constants';

const EMOJI_METODO: Record<string, string> = {
  pix: '💠',
  credit_card: '💳',
  debit_card: '🏧',
};

const NOME_METODO: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

/** 8.3 — Ícone de status da meta, igual ao comando /meta. */
const ICONE_NIVEL: Record<StatusMeta['nivel'], string> = {
  ok: '🟢',
  aviso80: '🟡',
  limite100: '🔴',
};

/**
 * 8.3 — Metas no resumo são best-effort: uma falha na consulta de orçamentos
 * NUNCA derruba o resumo (que continua válido sem a seção).
 */
async function listarMetasSeguro(requestId: string): Promise<StatusMeta[]> {
  try {
    return await listarMetas(requestId);
  } catch (err) {
    log('warn', 'Falha ao carregar metas no resumo (seção omitida)', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function handleResumo(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const [r, gastosPorDia, metas] = await Promise.all([
    getResumoMensal(requestId),
    getGastosDiariosDoMes(requestId),
    listarMetasSeguro(requestId),
  ]);

  // Fase 5: sparkline unicode da evolução diária de gastos no mês.
  const ultimoDia = gastosPorDia.length || 1;
  const sparkline = gerarSparklineMensal(gastosPorDia, ultimoDia);

  const maxTotalMetodo = r.porMetodo.length ? Math.max(...r.porMetodo.map((m) => m.total)) : 0;

  // 8.5 — Barra textual proporcional ao maior método do mês.
  const linhasPorMetodo = r.porMetodo.length
    ? r.porMetodo.map((m) => {
        const barra = gerarBarraTexto(m.total, maxTotalMetodo);
        return `   ${EMOJI_METODO[m.metodo] ?? '💰'} ${NOME_METODO[m.metodo] ?? m.metodo.replace(/_/g, ' ')}: ${barra} R$ ${formatarReal(m.total)}`;
      })
    : ['   (nenhum lançamento no mês)'];

  // 8.3 — Metas do mês com semáforo de status (🟢 ok, 🟡 ≥80%, 🔴 estourada).
  // listarMetas já ordena por % usada (estouradas primeiro).
  const linhasMetas = metas.map((m) => {
    const barra = gerarBarraTexto(m.gastoAtual, m.limite);
    return `${ICONE_NIVEL[m.nivel]} ${m.categoria}: ${barra} R$ ${formatarReal(
      m.gastoAtual
    )} / R$ ${formatarReal(m.limite)} (${m.percentual.toFixed(0)}%)`;
  });

  // 8.6 — Teclado dinâmico de navegação: [Ver Gráfico] [Faturas] [Dívidas].
  await bot.sendMessage(
    chatId,
    [
      '📊 *Resumo do mês*',
      '',
      `💸 Meus gastos reais: R$ ${formatarReal(r.meuGastoReal)}`,
      `🔁 Recorrentes (minha parte): R$ ${formatarReal(r.gastosRecorrentes)}`,
      `🧾 Lançamentos no mês: ${r.quantidade}`,
      '',
      r.quantidade > 0 ? `📈 Evolução diária:\n${sparkline}` : '',
      '',
      '📂 *Por método de pagamento:*',
      ...linhasPorMetodo,
      '',
      ...(metas.length > 0 ? ['🎯 *Metas do mês:*', ...linhasMetas, ''] : []),
      RODAPE_UX,
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: buildResumoKeyboard() }
  );
}
