import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { getResumoMensal, getGastosDiariosDoMes } from '../../services/transactions/transactionService';
import { listarMetas, type StatusMeta } from '../../services/budgets/budgetService';
import { formatarReal } from '../../utils/formatters';
import { gerarSparklineMensal, gerarBarraTexto } from '../../utils/sparklines';
import { buildResumoKeyboard } from '../keyboards/transactionKeyboard';
import { RODAPE_UX } from '../../config/constants';
import { mesAnoAtual, rotuloDoMes } from '../../utils/month';

const EMOJI_METODO: Record<string, string> = {
  pix: '💠',
  credit_card: '💳',
  debit_card: '🏧',
  meal_voucher: '🍽️',
  food_voucher: '🛒',
};

const NOME_METODO: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  meal_voucher: 'Vale-refeição',
  food_voucher: 'Vale-alimentação',
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
        const nome = NOME_METODO[m.metodo] ?? m.metodo.replace(/_/g, ' ');
        const emoji = EMOJI_METODO[m.metodo] ?? '💰';
        return `   ${emoji} ${nome}: ${barra} R$ ${formatarReal(m.total)}`;
      })
    : ['   (nenhum lançamento no mês)'];

  // 8.3 — Metas do mês com semáforo de status (🟢 ok, 🟡 ≥80%, 🔴 estourada).
  // listarMetas já ordena por % usada (estouradas primeiro).
  const linhasMetas = metas.map((m) => {
    const barra = gerarBarraTexto(m.gastoAtual, m.limite);
    return `   ${ICONE_NIVEL[m.nivel]} *${m.categoria}*: ${barra} R$ ${formatarReal(
      m.gastoAtual
    )} / R$ ${formatarReal(m.limite)} (${m.percentual.toFixed(0)}%)`;
  });

  const mesFormatado = rotuloDoMes(mesAnoAtual());
  const mesTitulo = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);

  const blocos: string[] = [
    `📊 *Resumo Financeiro — ${mesTitulo}*`,
    '',
    '💰 *Visão Geral*',
    `   • 💸 *Total gasto (sua parte):* R$ ${formatarReal(r.meuGastoReal)}`,
    `   • 🔁 *Gastos fixos/recorrentes:* R$ ${formatarReal(r.gastosRecorrentes)}`,
    `   • 🧾 *Lançamentos registrados:* ${r.quantidade}`,
  ];

  if (r.quantidade > 0 && sparkline) {
    blocos.push('');
    blocos.push('📈 *Ritmo de Gastos Diário*');
    blocos.push(`   \`${sparkline}\``);
  }

  blocos.push('');
  blocos.push('💳 *Gastos por Forma de Pagamento*');
  blocos.push(...linhasPorMetodo);

  if (metas.length > 0) {
    blocos.push('');
    blocos.push('🎯 *Acompanhamento de Metas*');
    blocos.push(...linhasMetas);
  }

  blocos.push('');
  blocos.push(RODAPE_UX);

  // 8.6 — Teclado dinâmico de navegação: [Ver Gráfico] [Faturas] [Dívidas].
  await bot.sendMessage(
    chatId,
    blocos.join('\n'),
    { parse_mode: 'Markdown', reply_markup: buildResumoKeyboard() }
  );
}
