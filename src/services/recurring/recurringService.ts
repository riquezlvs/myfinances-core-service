import cron, { type ScheduledTask } from 'node-cron';
import { getSupabaseClient } from '../../clients/supabaseClient';
import { log, withTiming } from '../../utils/logger';

/**
 * Serviço de recorrências mensais.
 *
 * Roda uma vez por dia (cron) e materializa as despesas fixas da tabela
 * `recurring_transactions` na tabela `transactions` com `is_recurring = true`.
 *
 * Idempotência: cada recorrência guarda `last_generated_month` (primeiro dia
 * do mês em que já gerou). Se o mês atual já foi gerado, pula — mesmo que o
 * job rode mais de uma vez no mesmo dia/mês.
 */

interface RecurringTransactionRow {
  id: string;
  description: string;
  total_amount: number;
  category_id: number;
  payment_method: 'pix' | 'credit_card' | 'debit_card';
  my_share_amount: number | null;
  third_party_id: string | null;
  day_of_month: number;
  last_generated_month: string | null;
}

/** Retorna o primeiro dia do mês atual em formato YYYY-MM-DD (UTC). */
function primeiroDiaDoMesAtual(agora = new Date()): string {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Busca as recorrências ativas que ainda não geraram no mês atual. */
export async function buscarRecorrenciasPendentes(
  requestId: string
): Promise<RecurringTransactionRow[]> {
  return withTiming('buscar recorrências pendentes', { requestId }, async () => {
    const mesAtual = primeiroDiaDoMesAtual();

    const { data, error } = await getSupabaseClient()
      .from('recurring_transactions')
      .select(
        'id, description, total_amount, category_id, payment_method, my_share_amount, third_party_id, day_of_month, last_generated_month'
      )
      .eq('is_active', true)
      .or(`last_generated_month.is.null,last_generated_month.lt.${mesAtual}`);

    if (error) throw new Error(`Erro ao buscar recorrências: ${error.message}`);
    return (data ?? []) as RecurringTransactionRow[];
  });
}

/**
 * Materializa uma recorrência no mês atual: insere a linha em `transactions`
 * com `is_recurring = true` e atualiza `last_generated_month` da recorrência.
 * Retorna o display_id gerado, ou null se o dia ainda não chegou.
 */
export async function materializarRecorrencia(
  recorrencia: RecurringTransactionRow,
  requestId: string
): Promise<number | null> {
  const agora = new Date();
  const diaAtual = agora.getUTCDate();

  // Só gera no dia do mês configurado (ou no último dia se o mês for curto).
  const ultimoDiaMes = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const diaAlvo = Math.min(recorrencia.day_of_month, ultimoDiaMes);

  if (diaAtual !== diaAlvo) return null;

  return withTiming('materializar recorrência', { requestId, id: recorrencia.id }, async () => {
    const supabase = getSupabaseClient();
    const mesAtual = primeiroDiaDoMesAtual();

    // Insere a transação recorrente.
    const { data, error } = await supabase
      .from('transactions')
      .insert({
        description: recorrencia.description,
        total_amount: recorrencia.total_amount,
        category_id: recorrencia.category_id,
        payment_method: recorrencia.payment_method,
        occurred_at: new Date().toISOString(),
        my_share_amount: recorrencia.my_share_amount ?? null,
        third_party_id: recorrencia.third_party_id ?? null,
        is_recurring: true,
      })
      .select('display_id')
      .single();

    if (error) throw new Error(`Erro ao inserir recorrência: ${error.message}`);

    // Marca o mês como gerado (idempotência).
    const { error: erroUpdate } = await supabase
      .from('recurring_transactions')
      .update({ last_generated_month: mesAtual })
      .eq('id', recorrencia.id);

    if (erroUpdate) {
      throw new Error(`Erro ao atualizar last_generated_month: ${erroUpdate.message}`);
    }

    log('info', 'Recorrência materializada', {
      requestId,
      id: recorrencia.id,
      displayId: data.display_id,
      mes: mesAtual,
    });

    return data.display_id as number;
  });
}

/**
 * Executa o ciclo completo de materialização das recorrências do dia.
 * Chamado pelo cron diário e também exportado para testes.
 */
// Guard de reentrada: se um ciclo ainda estiver rodando (Supabase lento,
// retries), o próximo disparo do cron é ignorado em vez de sobrepor.
let cicloEmExecucao = false;

export async function executarCicloRecorrencias(requestId: string): Promise<number[]> {
  if (cicloEmExecucao) {
    log('warn', 'Ciclo de recorrências anterior ainda em execução — disparo ignorado', { requestId });
    return [];
  }
  cicloEmExecucao = true;

  try {
    const pendentes = await buscarRecorrenciasPendentes(requestId);

    // Otimização: materializa em paralelo com allSettled — uma falha
    // individual não aborta as demais (resiliência + menor latência).
    const resultados = await Promise.allSettled(
      pendentes.map((rec) => materializarRecorrencia(rec, requestId))
    );

    const gerados: number[] = [];
    for (const resultado of resultados) {
      if (resultado.status === 'fulfilled' && resultado.value != null) {
        gerados.push(resultado.value);
      } else if (resultado.status === 'rejected') {
        log('error', 'Falha ao materializar uma recorrência (continuando)', {
          requestId,
          erro: resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason),
        });
      }
    }

    log('info', 'Ciclo de recorrências concluído', {
      requestId,
      pendentes: pendentes.length,
      gerados: gerados.length,
    });

    return gerados;
  } finally {
    cicloEmExecucao = false;
  }
}

/**
 * Agenda o cron diário. Roda às 06:00 (horário local do servidor) para
 * materializar as recorrências do dia. Retorna a task para permitir
 * desligamento limpo.
 */
export function iniciarCronRecorrencias(): ScheduledTask {
  const task = cron.schedule('0 6 * * *', async () => {
    const requestId = `cron-${Date.now()}`;
    log('info', '⏰ Cron de recorrências disparado', { requestId });
    try {
      await executarCicloRecorrencias(requestId);
    } catch (err) {
      log('error', '❌ Cron de recorrências falhou', {
        requestId,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  });

  log('info', '⏰ Cron de recorrências agendado (diário às 06:00)');
  return task;
}