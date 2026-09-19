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
  credit_limit?: number;
  due_day?: number | null;
  card_holder?: string | null;
  last_four_digits?: string | null;
  color_theme?: string;
  is_virtual?: boolean;
}

export interface CartaoDetalhado extends Cartao {
  faturaAtual: number;
  limiteDisponivel: number;
  percentualUtilizado: number;
  periodo: {
    inicio: string;
    fim: string;
    fechamento: string;
  };
  itensFatura: ItemFaturaCartao[];
}

export interface PeriodoFatura {
  inicio: Date;
  /** Exclusivo (fim do período). */
  fim: Date;
  /** Data de fechamento desta fatura. */
  fechamento: Date;
}

/**
 * Retorna o último dia de um determinado mês em um ano (ex: 28/29 em fev, 30 em abr, 31 em mai).
 */
export function obterUltimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes + 1, 0).getDate();
}

/**
 * Função pura: calcula o período da fatura atual de um cartão com suporte
 * dinâmico a fechamento no fim do mês (1 a 31).
 *
 * Se closing_day for maior que o número de dias do mês corrente (ex: dia 31 em
 * fevereiro ou abril), o fechamento é clampado para o último dia daquele mês.
 *
 * - Se hoje <= diaFechamentoEfetivo: fatura fecha neste mês. O início é no dia
 *   seguinte ao fechamento efetivo do mês anterior.
 * - Se hoje > diaFechamentoEfetivo: fatura já fechou e o período atual fecha
 *   no mês seguinte.
 */
export function calcularPeriodoFatura(closingDay: number, agora = new Date()): PeriodoFatura {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  const diaHoje = agora.getDate();

  const diaFechamentoMesAtual = Math.min(closingDay, obterUltimoDiaDoMes(ano, mes));

  if (diaHoje <= diaFechamentoMesAtual) {
    // Fatura fecha no mês atual
    const diaFechamentoMesAnterior = Math.min(closingDay, obterUltimoDiaDoMes(ano, mes - 1));
    const inicio = new Date(ano, mes - 1, diaFechamentoMesAnterior + 1);
    const fechamento = new Date(ano, mes, diaFechamentoMesAtual);
    const fim = new Date(ano, mes, diaFechamentoMesAtual + 1);

    return { inicio, fim, fechamento };
  }

  // Fatura fecha no mês subsequente
  const diaFechamentoMesSeguinte = Math.min(closingDay, obterUltimoDiaDoMes(ano, mes + 1));
  const inicio = new Date(ano, mes, diaFechamentoMesAtual + 1);
  const fechamento = new Date(ano, mes + 1, diaFechamentoMesSeguinte);
  const fim = new Date(ano, mes + 1, diaFechamentoMesSeguinte + 1);

  return { inicio, fim, fechamento };
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

export interface NovoCartaoDTO {
  id?: string;
  name: string;
  closing_day: number;
  due_day?: number;
  credit_limit?: number;
  card_type?: CardType;
  card_holder?: string;
  last_four_digits?: string;
  color_theme?: string;
  is_virtual?: boolean;
}

/** Cria ou atualiza um cartão com todos os detalhes e configurações visuais. */
export async function cadastrarNovoCartao(
  dto: NovoCartaoDTO,
  requestId: string
): Promise<Cartao> {
  return withTiming('cadastrar ou atualizar cartão', { requestId, dto }, async () => {
    const supabase = getSupabaseClient();
    const payloadCompleto: any = {
      name: dto.name.trim(),
      closing_day: dto.closing_day,
      due_day: dto.due_day || null,
      credit_limit: dto.credit_limit || 0,
      card_type: dto.card_type || 'credit',
      card_holder: dto.card_holder?.trim() || null,
      last_four_digits: dto.last_four_digits?.trim() || null,
      color_theme: dto.color_theme || 'titanium',
      is_virtual: Boolean(dto.is_virtual),
    };

    if (dto.id && !dto.id.startsWith('temp-') && !dto.id.includes('-default')) {
      payloadCompleto.id = dto.id;
    }

    const onConflictTarget = dto.id && !dto.id.startsWith('temp-') && !dto.id.includes('-default') ? 'id' : 'name';

    // Tentativa 1: tentar salvar com todas as colunas novas
    let data: any = null;
    let error: any = null;

    const resCompleto = await supabase
      .from('cards')
      .upsert(payloadCompleto, { onConflict: onConflictTarget })
      .select('id, name, closing_day, card_type, is_default, credit_limit, due_day, card_holder, last_four_digits, color_theme, is_virtual')
      .maybeSingle();

    data = resCompleto.data;
    error = resCompleto.error;

    // Se o banco remoto ainda não tiver as colunas novas (schema cache), faz fallback seguro para a tabela base
    if (error && (error.message?.includes('card_holder') || error.message?.includes('column') || error.message?.includes('schema cache'))) {
      log('warn', 'Colunas adicionais de cards não detectadas no Supabase. Usando colunas base.', {
        requestId,
        erro: error.message,
      });

      const payloadBase: any = {
        name: dto.name.trim(),
        closing_day: dto.closing_day,
        card_type: dto.card_type || 'credit',
      };
      if (dto.id && !dto.id.startsWith('temp-') && !dto.id.includes('-default')) {
        payloadBase.id = dto.id;
      }

      const resBase = await supabase
        .from('cards')
        .upsert(payloadBase, { onConflict: onConflictTarget })
        .select('id, name, closing_day, card_type, is_default')
        .single();

      if (resBase.error) {
        throw new Error(`Erro ao salvar cartão: ${resBase.error.message}`);
      }

      data = {
        ...resBase.data,
        credit_limit: dto.credit_limit || 0,
        due_day: dto.due_day || 10,
        card_holder: dto.card_holder || null,
        last_four_digits: dto.last_four_digits || null,
        color_theme: dto.color_theme || 'titanium',
        is_virtual: Boolean(dto.is_virtual),
      };
      error = null;
    } else if (error) {
      throw new Error(`Erro ao salvar cartão: ${error.message}`);
    }

    const cartao = data as unknown as Cartao;

    if (!cartao.is_default) {
      const principal = await obterCartaoPrincipal(cartao.card_type, requestId);
      if (!principal) {
        await supabase.from('cards').update({ is_default: true }).eq('id', cartao.id);
        cartao.is_default = true;
      }
    }

    return cartao;
  });
}

/**
 * Obtém todos os cartões cadastrados já calculando a fatura do período atual,
 * limite restante e lançamentos da fatura.
 */
export async function obterCartoesDetalhados(requestId: string): Promise<CartaoDetalhado[]> {
  return withTiming('obter cartões detalhados', { requestId }, async () => {
    const cartoes = await listarCartoes(requestId);
    if (cartoes.length === 0) return [];

    const hoje = new Date();
    const resultado: CartaoDetalhado[] = [];

    for (let i = 0; i < cartoes.length; i++) {
      const card = cartoes[i];
      const periodo = calcularPeriodoFatura(card.closing_day, hoje);
      const isDefault = i === 0 || card.is_default;
      const itens = await getFaturaDoPeriodo(card.id, periodo, isDefault, requestId);

      const totalFatura = itens.reduce((acc, item) => acc + Number(item.total_amount || 0), 0);
      const limite = Number(card.credit_limit || 0);
      const disponivel = Math.max(0, limite - totalFatura);
      const percentual = limite > 0 ? Math.min(100, (totalFatura / limite) * 100) : 0;

      resultado.push({
        ...card,
        faturaAtual: totalFatura,
        limiteDisponivel: disponivel,
        percentualUtilizado: Number(percentual.toFixed(1)),
        periodo: {
          inicio: periodo.inicio.toISOString(),
          fim: periodo.fim.toISOString(),
          fechamento: periodo.fechamento.toISOString(),
        },
        itensFatura: itens.slice(-15).reverse(),
      });
    }

    return resultado;
  });
}