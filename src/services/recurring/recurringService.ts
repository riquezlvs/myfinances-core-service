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

import { creditarSaldo } from '../accounts/accountService';

export interface RecurringTransactionRow {
  id: string;
  description: string;
  total_amount: number;
  category_id?: number | null;
  payment_method?: 'pix' | 'credit_card' | 'debit_card' | null;
  my_share_amount?: number | null;
  third_party_id?: string | null;
  day_of_month: number;
  last_generated_month?: string | null;
  entry_type?: 'expense' | 'income';
  account_id?: string | null;
  income_type?: 'salary' | 'freelance' | 'benefit' | 'other' | null;
  weekend_rule?: 'anticipate' | 'postpone' | 'exact';
  is_active?: boolean;
}

export interface RendaPrevistaPeriodo {
  id: string;
  description: string;
  amount: number;
  dataPrevista: Date;
  dataEfetivaFormatada: string;
  income_type?: 'salary' | 'freelance' | 'benefit' | 'other' | null;
  account_id?: string | null;
}

/** Retorna o primeiro dia do mês atual em formato YYYY-MM-DD (UTC). */
function primeiroDiaDoMesAtual(agora = new Date()): string {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Calcula a data efetiva de uma recorrência em um determinado mês/ano,
 * aplicando a regra de fim de semana (antecipar, postergar ou exato).
 */
export function calcularDataEfetivaRecorrencia(
  diaDoMes: number,
  ano: number,
  mesZeroIndexed: number,
  weekendRule?: 'anticipate' | 'postpone' | 'exact' | null
): Date {
  const ultimoDiaMes = new Date(Date.UTC(ano, mesZeroIndexed + 1, 0)).getUTCDate();
  const diaAlvo = Math.min(Math.max(1, diaDoMes), ultimoDiaMes);
  const data = new Date(Date.UTC(ano, mesZeroIndexed, diaAlvo, 12, 0, 0));

  if (!weekendRule || weekendRule === 'exact') {
    return data;
  }

  const diaSemana = data.getUTCDay(); // 0 = Domingo, 6 = Sábado

  if (weekendRule === 'anticipate') {
    if (diaSemana === 6) {
      data.setUTCDate(data.getUTCDate() - 1); // Sexta
    } else if (diaSemana === 0) {
      data.setUTCDate(data.getUTCDate() - 2); // Sexta
    }
  } else if (weekendRule === 'postpone') {
    if (diaSemana === 6) {
      data.setUTCDate(data.getUTCDate() + 2); // Segunda
    } else if (diaSemana === 0) {
      data.setUTCDate(data.getUTCDate() + 1); // Segunda
    }
  }

  return data;
}

/** Busca todas as receitas recorrentes ativas. */
export async function buscarRendasRecorrentesAtivas(
  requestId: string
): Promise<RecurringTransactionRow[]> {
  return withTiming('buscar rendas recorrentes ativas', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .eq('entry_type', 'income');

    if (error) {
      // Se a coluna entry_type não existir ou falhar por alguma razão, retorna vazio
      log('warn', 'Aviso ao buscar rendas recorrentes', { requestId, erro: error.message });
      return [];
    }
    return (data ?? []) as RecurringTransactionRow[];
  });
}

/**
 * Retorna todas as receitas recorrentes que devem cair dentro de um período [inicio, fim].
 * Muito útil para saber se o salário cai antes do fechamento da fatura!
 */
export async function obterRendasPrevistasNoPeriodo(
  inicio: Date,
  fim: Date,
  requestId: string
): Promise<RendaPrevistaPeriodo[]> {
  return withTiming('obter rendas previstas no período', { requestId }, async () => {
    const rendas = await buscarRendasRecorrentesAtivas(requestId);
    if (rendas.length === 0) return [];

    const resultados: RendaPrevistaPeriodo[] = [];
    const inicioTimestamp = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), 0, 0, 0).getTime();
    const fimTimestamp = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), 23, 59, 59).getTime();

    // Checa o mês de início e o mês de fim (podem ser meses adjacentes)
    const mesesParaChecar = [
      { ano: inicio.getFullYear(), mes: inicio.getMonth() },
      { ano: fim.getFullYear(), mes: fim.getMonth() },
    ];
    // Elimina duplicação de mês
    const mesesUnicos = mesesParaChecar.filter(
      (m, idx, self) => idx === self.findIndex((t) => t.ano === m.ano && t.mes === m.mes)
    );

    for (const rec of rendas) {
      for (const { ano, mes } of mesesUnicos) {
        const dataEfetiva = calcularDataEfetivaRecorrencia(
          rec.day_of_month,
          ano,
          mes,
          rec.weekend_rule || 'postpone'
        );
        const tempo = dataEfetiva.getTime();

        if (tempo >= inicioTimestamp && tempo <= fimTimestamp) {
          const anoStr = dataEfetiva.getUTCFullYear();
          const mesStr = String(dataEfetiva.getUTCMonth() + 1).padStart(2, '0');
          const diaStr = String(dataEfetiva.getUTCDate()).padStart(2, '0');

          resultados.push({
            id: rec.id,
            description: rec.description,
            amount: Number(rec.total_amount),
            dataPrevista: dataEfetiva,
            dataEfetivaFormatada: `${anoStr}-${mesStr}-${diaStr}`,
            income_type: rec.income_type,
            account_id: rec.account_id,
          });
        }
      }
    }

    return resultados.sort((a, b) => a.dataPrevista.getTime() - b.dataPrevista.getTime());
  });
}

/** Lista todas as recorrências cadastradas (despesas ou receitas). */
export async function listarTodasRecorrencias(
  entryType?: 'expense' | 'income',
  requestId: string = 'listar-recorrencias'
): Promise<RecurringTransactionRow[]> {
  return withTiming('listar todas recorrências', { requestId, entryType }, async () => {
    let query = getSupabaseClient()
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .order('day_of_month', { ascending: true });

    if (entryType) {
      query = query.eq('entry_type', entryType);
    }

    const { data, error } = await query;
    if (error) {
      log('error', 'Erro ao listar recorrências', { requestId, erro: error.message });
      throw new Error(`Erro ao listar recorrências: ${error.message}`);
    }
    return (data ?? []) as RecurringTransactionRow[];
  });
}

/** Cria uma nova recorrência no banco. */
export async function cadastrarNovaRecorrencia(
  dados: {
    description: string;
    total_amount: number;
    day_of_month: number;
    entry_type?: 'expense' | 'income';
    payment_method?: 'pix' | 'credit_card' | 'debit_card';
    category_id?: number | null;
    account_id?: string | null;
    income_type?: 'salary' | 'freelance' | 'benefit' | 'other' | null;
    weekend_rule?: 'anticipate' | 'postpone' | 'exact';
  },
  requestId: string = 'cadastrar-recorrencia'
): Promise<RecurringTransactionRow> {
  return withTiming('cadastrar nova recorrência', { requestId, description: dados.description }, async () => {
    const supabase = getSupabaseClient();
    const entryType = dados.entry_type || 'expense';

    const payload: any = {
      description: dados.description,
      total_amount: dados.total_amount,
      day_of_month: Math.min(31, Math.max(1, dados.day_of_month)),
      entry_type: entryType,
      is_active: true,
      account_id: dados.account_id || null,
      weekend_rule: dados.weekend_rule || (entryType === 'income' ? 'anticipate' : 'postpone'),
    };

    if (dados.income_type) {
      payload.income_type = dados.income_type;
    }
    if (dados.payment_method) {
      payload.payment_method = dados.payment_method;
    } else if (entryType === 'expense') {
      payload.payment_method = 'credit_card';
    }
    if (dados.category_id) {
      payload.category_id = dados.category_id;
    }

    const { data, error } = await supabase
      .from('recurring_transactions')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      log('error', 'Erro ao inserir recorrência', { requestId, erro: error.message });
      throw new Error(`Erro ao inserir recorrência: ${error.message}`);
    }

    log('info', 'Recorrência cadastrada com sucesso', { requestId, id: data.id, entryType });
    return data as RecurringTransactionRow;
  });
}

/** Desativa uma recorrência. */
export async function desativarRecorrenciaPorId(
  id: string,
  requestId: string = 'desativar-recorrencia'
): Promise<boolean> {
  return withTiming('desativar recorrência', { requestId, id }, async () => {
    const { error } = await getSupabaseClient()
      .from('recurring_transactions')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      log('error', 'Erro ao desativar recorrência', { requestId, id, erro: error.message });
      throw new Error(`Erro ao desativar recorrência: ${error.message}`);
    }
    return true;
  });
}

/** Busca as recorrências ativas que ainda não geraram no mês atual. */
export async function buscarRecorrenciasPendentes(
  requestId: string
): Promise<RecurringTransactionRow[]> {
  return withTiming('buscar recorrências pendentes', { requestId }, async () => {
    const mesAtual = primeiroDiaDoMesAtual();

    const { data, error } = await getSupabaseClient()
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .or(`last_generated_month.is.null,last_generated_month.lt.${mesAtual}`);

    if (error) throw new Error(`Erro ao buscar recorrências: ${error.message}`);
    return (data ?? []) as RecurringTransactionRow[];
  });
}

/** Busca todas as recorrências ativas de cartão de crédito. */
export async function buscarRecorrenciasAtivasCredito(
  requestId: string
): Promise<RecurringTransactionRow[]> {
  return withTiming('buscar recorrências ativas de crédito', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .eq('payment_method', 'credit_card');

    if (error) throw new Error(`Erro ao buscar recorrências ativas de crédito: ${error.message}`);
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

  // Calcula dia efetivo considerando a regra de fim de semana
  const dataEfetiva = calcularDataEfetivaRecorrencia(
    recorrencia.day_of_month,
    agora.getUTCFullYear(),
    agora.getUTCMonth(),
    recorrencia.weekend_rule || (recorrencia.entry_type === 'income' ? 'anticipate' : 'exact')
  );
  const diaAlvo = dataEfetiva.getUTCDate();

  if (diaAtual !== diaAlvo) return null;

  return withTiming('materializar recorrência', { requestId, id: recorrencia.id }, async () => {
    const supabase = getSupabaseClient();
    const mesAtual = primeiroDiaDoMesAtual();
    const isIncome = recorrencia.entry_type === 'income';

    // Insere a transação recorrente.
    const { data, error } = await supabase
      .from('transactions')
      .insert({
        description: recorrencia.description,
        total_amount: recorrencia.total_amount,
        category_id: recorrencia.category_id ?? null,
        payment_method: recorrencia.payment_method ?? (isIncome ? 'pix' : 'credit_card'),
        occurred_at: new Date().toISOString(),
        my_share_amount: recorrencia.my_share_amount ?? null,
        third_party_id: recorrencia.third_party_id ?? null,
        is_recurring: true,
        entry_type: isIncome ? 'income' : 'expense',
        account_id: recorrencia.account_id ?? null,
      })
      .select('display_id')
      .single();

    if (error) throw new Error(`Erro ao inserir recorrência: ${error.message}`);

    // Se for uma receita com conta destino, credita automaticamente o saldo da conta
    if (isIncome && recorrencia.account_id) {
      try {
        await creditarSaldo(recorrencia.account_id, Number(recorrencia.total_amount), requestId);
      } catch (errCredit: any) {
        log('warn', 'Não foi possível creditar saldo na conta ao materializar renda', {
          requestId,
          accountId: recorrencia.account_id,
          erro: errCredit.message,
        });
      }
    }

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
      entryType: isIncome ? 'income' : 'expense',
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