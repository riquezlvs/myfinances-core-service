import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import type { CardType } from '../../types/transaction';

/**
 * Fase 6 — Multi-cartão com data de fechamento personalizada.
 * O período da fatura vai do dia seguinte ao fechamento anterior até o
 * dia de fechamento atual (não é o mês civil).
 */

export interface Cartao {
  id: string;
  name: string;
  closing_day: number;
  /** 8.2 — Tipo do cartão (crédito, vale-refeição, vale-alimentação). */
  card_type: CardType;
  /** 8.2 — Cartão principal do seu tipo (usado pela inferência de pagamento). */
  is_default: boolean;
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

/** Lista os cartões cadastrados (principal de cada tipo primeiro). */
export async function listarCartoes(requestId: string): Promise<Cartao[]> {
  return withTiming('listar cartões', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('cards')
      .select('id, name, closing_day, card_type, is_default')
      .order('is_default', { ascending: false })
      .order('closing_day', { ascending: true });

    if (error) throw new Error(`Erro ao listar cartões: ${error.message}`);
    return (data ?? []) as unknown as Cartao[];
  });
}

/** Rótulo legível do tipo de cartão (8.2). */
export const LABEL_CARD_TYPE: Record<CardType, string> = {
  credit: 'Crédito',
  meal_voucher: 'Vale-refeição',
  food_voucher: 'Vale-alimentação',
};

/**
 * 8.2 — Retorna o cartão PRINCIPAL do tipo pedido (is_default), com fallback
 * para o primeiro do tipo (ordenado por fechamento). null se não houver.
 * Consulta frequente da inferência de pagamento — sempre 1 linha.
 */
export async function obterCartaoPrincipal(
  tipo: CardType,
  requestId: string
): Promise<Cartao | null> {
  const { data, error } = await getSupabaseClient()
    .from('cards')
    .select('id, name, closing_day, card_type, is_default')
    .eq('card_type', tipo)
    .order('is_default', { ascending: false })
    .order('closing_day', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar cartão principal: ${error.message}`);
  return (data as unknown as Cartao) ?? null;
}

/** Cria ou atualiza um cartão pelo nome (upsert), com tipo (8.2). */
export async function definirCartao(
  nome: string,
  closingDay: number,
  requestId: string,
  cardType: CardType = 'credit'
): Promise<Cartao> {
  return withTiming('definir cartão', { requestId, nome, closingDay, cardType }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('cards')
      .upsert(
        { name: nome, closing_day: closingDay, card_type: cardType },
        { onConflict: 'name' }
      )
      .select('id, name, closing_day, card_type, is_default')
      .single();

    if (error) throw new Error(`Erro ao salvar cartão: ${error.message}`);
    const cartao = data as unknown as Cartao;

    // Primeiro cartão do tipo se torna o principal automaticamente.
    if (!cartao.is_default) {
      const principal = await obterCartaoPrincipal(cartao.card_type, requestId);
      if (!principal) {
        const { error: errDefault } = await getSupabaseClient()
          .from('cards')
          .update({ is_default: true })
          .eq('id', cartao.id);
        if (errDefault) throw new Error(`Erro ao definir cartão principal: ${errDefault.message}`);
        cartao.is_default = true;
      }
    }
    return cartao;
  });
}

/**
 * 8.2 — Define o cartão principal do SEU tipo: zera os demais do mesmo tipo
 * e marca o alvo. Duas queries (sem transação) são aceitáveis no escopo
 * single-tenant; a constraint única parcial impede dois defaults do tipo.
 */
export async function definirCartaoPrincipal(id: string, requestId: string): Promise<Cartao> {
  return withTiming('definir cartão principal', { requestId, cardId: id }, async () => {
    const supabase = getSupabaseClient();
    const { data: alvo, error: errAlvo } = await supabase
      .from('cards')
      .select('id, name, closing_day, card_type, is_default')
      .eq('id', id)
      .maybeSingle();
    if (errAlvo) throw new Error(`Erro ao buscar cartão: ${errAlvo.message}`);
    if (!alvo) throw new Error('Cartão não encontrado.');

    const { error: errZerar } = await supabase
      .from('cards')
      .update({ is_default: false })
      .eq('card_type', (alvo as any).card_type as CardType);
    if (errZerar) throw new Error(`Erro ao zerar principais: ${errZerar.message}`);

    const { data: atualizado, error: errSet } = await supabase
      .from('cards')
      .update({ is_default: true })
      .eq('id', id)
      .select('id, name, closing_day, card_type, is_default')
      .single();
    if (errSet) throw new Error(`Erro ao definir principal: ${errSet.message}`);

    log('info', 'Cartão principal definido', {
      requestId,
      nome: (atualizado as any).name,
      tipo: (alvo as any).card_type,
    });
    return atualizado as unknown as Cartao;
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