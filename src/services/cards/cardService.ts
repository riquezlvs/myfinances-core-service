import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';

/**
 * Fase 6 — Multi-cartão com data de fechamento personalizada.
 * O período da fatura vai do dia seguinte ao fechamento anterior até o
 * dia de fechamento atual (não é o mês civil).
 */

export interface Cartao {
  id: string;
  name: string;
  closing_day: number;
}

export interface PeriodoFatura {
  inicio: Date;
  /** Exclusivo (fim do período). */
  fim: Date;
  /** Data de fechamento desta fatura. */
  fechamento: Date;
}

/**
 * Função pura: calcula o período da fatura atual de um cartão.
 * - Se hoje <= closing_day: fatura começou no dia seguinte ao fechamento
 *   do mês anterior e fecha em closing_day deste mês.
 * - Se hoje > closing_day: fatura começou no dia seguinte ao fechamento
 *   deste mês e fecha em closing_day do mês seguinte.
 * Datas JS normalizam overflow (ex: closing 31 em fev → 3/mar) automaticamente.
 */
export function calcularPeriodoFatura(closingDay: number, agora = new Date()): PeriodoFatura {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();

  if (agora.getDate() <= closingDay) {
    return {
      inicio: new Date(ano, mes - 1, closingDay + 1),
      fim: new Date(ano, mes, closingDay + 1),
      fechamento: new Date(ano, mes, closingDay),
    };
  }
  return {
    inicio: new Date(ano, mes, closingDay + 1),
    fim: new Date(ano, mes + 1, closingDay + 1),
    fechamento: new Date(ano, mes + 1, closingDay),
  };
}

/** Lista os cartões cadastrados (ordenados por dia de fechamento). */
export async function listarCartoes(requestId: string): Promise<Cartao[]> {
  return withTiming('listar cartões', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('cards')
      .select('id, name, closing_day')
      .order('closing_day', { ascending: true });

    if (error) throw new Error(`Erro ao listar cartões: ${error.message}`);
    return (data ?? []) as Cartao[];
  });
}

/** Cria ou atualiza um cartão pelo nome (upsert). */
export async function definirCartao(
  nome: string,
  closingDay: number,
  requestId: string
): Promise<Cartao> {
  return withTiming('definir cartão', { requestId, nome, closingDay }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('cards')
      .upsert({ name: nome, closing_day: closingDay }, { onConflict: 'name' })
      .select('id, name, closing_day')
      .single();

    if (error) throw new Error(`Erro ao salvar cartão: ${error.message}`);
    return data as unknown as Cartao;
  });
}

export interface ItemFaturaCartao {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  installment_number: number | null;
  installment_total: number | null;
}

/**
 * Busca os lançamentos de crédito de um cartão dentro do período da fatura.
 * `incluirSemCartao`: gastos credit_card com card_id NULL pertencem ao
 * cartão padrão (o primeiro da lista) — evita dupla contagem nos demais.
 */
export async function getFaturaDoPeriodo(
  cardId: string,
  periodo: PeriodoFatura,
  incluirSemCartao: boolean,
  requestId: string
): Promise<ItemFaturaCartao[]> {
  return withTiming(
    'buscar fatura por período de fechamento',
    { requestId, cardId, incluirSemCartao },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('transactions')
        .select(
          'display_id, description, total_amount, occurred_at, installment_number, installment_total, card_id'
        )
        .eq('payment_method', 'credit_card')
        .gte('occurred_at', periodo.inicio.toISOString())
        .lt('occurred_at', periodo.fim.toISOString())
        .order('occurred_at', { ascending: true });

      query = incluirSemCartao
        ? query.or(`card_id.eq.${cardId},card_id.is.null`)
        : query.eq('card_id', cardId);

      const { data, error } = await query;
      if (error) throw new Error(`Erro ao buscar fatura do cartão: ${error.message}`);
      return (data ?? []) as unknown as ItemFaturaCartao[];
    }
  );
}

/** Remove um cartão pelo nome. Retorna o nome removido ou null. */
export async function removerCartao(nome: string, requestId: string): Promise<string | null> {
  return withTiming('remover cartão', { requestId, nome }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('cards')
      .delete()
      .eq('name', nome)
      .select('name')
      .maybeSingle();

    if (error) throw new Error(`Erro ao remover cartão: ${error.message}`);
    if (!data) return null;
    log('info', 'Cartão removido', { requestId, nome });
    return (data as any).name as string;
  });
}