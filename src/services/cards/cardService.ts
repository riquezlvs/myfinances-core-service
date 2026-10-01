import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { randomUUID } from 'crypto';
import type { CardType } from '../../types/transaction';
import { obterContaPorId, obterContaPorNome, debitarSaldo } from '../accounts/accountService';

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

export interface ItemFaturaCartao {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  installment_number: number | null;
  installment_total: number | null;
  is_payment?: boolean;
  entry_type?: string;
}

export interface CicloFaturaItem {
  id: string;
  rotulo: string;
  mesReferencia: string;
  status: 'fechada' | 'aberta' | 'paga' | 'parcial' | 'futura';
  inicio: string;
  fechamento: string;
  vencimento?: string;
  totalCompras: number;
  totalPago: number;
  valorFatura: number;
  itens: ItemFaturaCartao[];
}

export interface CartaoDetalhado extends Cartao {
  faturaAtual: number;
  limiteDisponivel: number;
  percentualUtilizado: number;
  totalPagoCiclo?: number;
  statusFatura?: 'fechada' | 'aberta' | 'paga' | 'parcial' | 'futura';
  periodo: {
    inicio: string;
    fim: string;
    fechamento: string;
  };
  itensFatura: ItemFaturaCartao[];
  faturas?: CicloFaturaItem[];
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
    const supabase = getSupabaseClient();
    
    // Tenta selecionar todas as colunas estendidas do cartão
    const { data, error } = await supabase
      .from('cards')
      .select('id, name, closing_day, card_type, is_default, credit_limit, due_day, card_holder, last_four_digits, color_theme, is_virtual')
      .order('is_default', { ascending: false })
      .order('closing_day', { ascending: true });

    if (error) {
      // Se der erro de coluna inexistente no banco (schema antigo), faz fallback para colunas base
      if (error.message?.includes('column') || error.message?.includes('schema cache')) {
        const resBase = await supabase
          .from('cards')
          .select('id, name, closing_day, card_type, is_default')
          .order('is_default', { ascending: false })
          .order('closing_day', { ascending: true });

        if (resBase.error) throw new Error(`Erro ao listar cartões: ${resBase.error.message}`);
        return (resBase.data ?? []) as unknown as Cartao[];
      }
      throw new Error(`Erro ao listar cartões: ${error.message}`);
    }
    return (data ?? []) as unknown as Cartao[];
  });
}

/** Rótulo legível do tipo de cartão (8.2). */
export const LABEL_CARD_TYPE: Record<CardType, string> = {
  credit: 'Crédito',
  debit: 'Débito',
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

/** Remove um cartão por ID ou pelo nome. Retorna o nome removido ou null. */
export async function removerCartao(idOuNome: string, requestId: string): Promise<string | null> {
  return withTiming('remover cartão', { requestId, idOuNome }, async () => {
    const supabase = getSupabaseClient();
    
    // 1. Localiza o cartão primeiro (por ID se for UUID ou por Nome)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOuNome);
    let { data: card } = await supabase
      .from('cards')
      .select('id, name')
      .eq(isUuid ? 'id' : 'name', idOuNome)
      .maybeSingle();

    if (!card && isUuid) {
      const resNome = await supabase
        .from('cards')
        .select('id, name')
        .eq('name', idOuNome)
        .maybeSingle();
      card = resNome?.data;
    }

    if (!card) {
      log('warn', 'Cartão não encontrado para remoção', { requestId, idOuNome });
      return null;
    }

    const cardRealId = (card as any).id;
    const cardNome = (card as any).name || idOuNome;

    // 2. Desvincula o card_id das transações se houver ID numérico/uuid
    if (cardRealId && supabase.from('transactions')?.update) {
      try {
        await supabase
          .from('transactions')
          .update({ card_id: null })
          .eq('card_id', cardRealId);
      } catch (errUnlink: any) {
        log('warn', 'Aviso ao desvincular transações do cartão', { requestId, erro: errUnlink.message });
      }
    }

    // 3. Exclui o cartão do banco
    if (supabase.from('cards')?.delete) {
      const { error: errDel } = await supabase
        .from('cards')
        .delete()
        .eq(cardRealId ? 'id' : 'name', cardRealId || cardNome);

      if (errDel) {
        throw new Error(`Erro ao remover cartão: ${errDel.message}`);
      }
    }

    log('info', 'Cartão removido com sucesso', { requestId, idOuNome, nome: cardNome });
    return cardNome as string;
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

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export interface CicloDef {
  id: string;
  rotulo: string;
  mesReferencia: string;
  inicio: Date;
  fim: Date;
  fechamento: Date;
  vencimento: Date;
  isAtual: boolean;
  statusPadrao: 'fechada' | 'aberta' | 'futura';
}

/**
 * Gera as definições de ciclos de faturas: fechada/atual, aberta e faturas futuras.
 */
export function gerarCiclosFatura(
  closingDay: number,
  dueDay?: number | null,
  agora = new Date()
): CicloDef[] {
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth();
  const diaHoje = agora.getDate();

  const diaFechamentoMesAtual = Math.min(closingDay, obterUltimoDiaDoMes(anoAtual, mesAtual));
  const cartaoJaFechouNoMes = diaHoje > diaFechamentoMesAtual;

  const ciclos: CicloDef[] = [];
  const offsetInicio = cartaoJaFechouNoMes ? 0 : -1;
  const offsetFim = 3; // gera ciclo atual + até 3 faturas futuras

  for (let offset = offsetInicio; offset <= offsetFim; offset++) {
    const dataRef = new Date(anoAtual, mesAtual + offset, 1);
    const ano = dataRef.getFullYear();
    const mes = dataRef.getMonth();

    const ultimoDia = obterUltimoDiaDoMes(ano, mes);
    const diaFechamento = Math.min(closingDay, ultimoDia);
    const fechamento = new Date(ano, mes, diaFechamento, 23, 59, 59, 999);

    const ultimoDiaAnt = obterUltimoDiaDoMes(ano, mes - 1);
    const diaFechamentoAnt = Math.min(closingDay, ultimoDiaAnt);
    const inicio = new Date(ano, mes - 1, diaFechamentoAnt + 1, 0, 0, 0, 0);
    const fim = new Date(ano, mes, diaFechamento + 1, 0, 0, 0, 0);

    const diaVenc = dueDay && dueDay >= 1 && dueDay <= 31 ? dueDay : Math.min(28, closingDay + 7);
    let vencimento: Date;
    if (diaVenc > diaFechamento) {
      vencimento = new Date(ano, mes, Math.min(diaVenc, ultimoDia));
    } else {
      const ultProx = obterUltimoDiaDoMes(ano, mes + 1);
      vencimento = new Date(ano, mes + 1, Math.min(diaVenc, ultProx));
    }

    let statusPadrao: 'fechada' | 'aberta' | 'futura';
    let isAtual = false;

    if (agora > fechamento) {
      statusPadrao = 'fechada';
    } else if (agora >= inicio && agora <= fechamento) {
      statusPadrao = 'aberta';
      isAtual = true;
    } else {
      statusPadrao = 'futura';
    }

    if (cartaoJaFechouNoMes && offset === 0) {
      isAtual = true;
    }

    const mesStr = String(mes + 1).padStart(2, '0');
    const id = `${ano}-${mesStr}`;
    const nomeMes = NOMES_MESES[mes];
    const sufixoAno = ano !== anoAtual ? `/${String(ano).slice(2)}` : '';
    const rotulo = `${nomeMes}${sufixoAno}`;

    ciclos.push({
      id,
      rotulo,
      mesReferencia: id,
      inicio,
      fim,
      fechamento,
      vencimento,
      isAtual,
      statusPadrao,
    });
  }

  return ciclos;
}

export async function buscarPagamentosFatura(
  cardId: string,
  inicio: Date,
  fim: Date,
  requestId: string
): Promise<Array<{ id: string; amount: number; paid_at: string; account_id: string }>> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('invoice_payments')
      .select('id, amount, paid_at, account_id')
      .eq('card_id', cardId)
      .gte('paid_at', inicio.toISOString())
      .lt('paid_at', fim.toISOString());
    if (error) return [];
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

/**
 * Calcula todas as faturas (passada/fechada, atual e futuras) com lançamentos alocados a cada ciclo.
 */
export async function obterFaturasDetalhadasDoCartao(
  card: Cartao,
  isDefault: boolean,
  requestId: string,
  agora = new Date()
): Promise<CicloFaturaItem[]> {
  const ciclos = gerarCiclosFatura(card.closing_day, card.due_day, agora);
  if (ciclos.length === 0) return [];

  const supabase = getSupabaseClient();
  const inicioGeral = ciclos[0].inicio;
  const fimGeral = ciclos[ciclos.length - 1].fim;

  let query = supabase
    .from('transactions')
    .select(
      'display_id, description, total_amount, occurred_at, installment_number, installment_total, card_id'
    )
    .eq('payment_method', 'credit_card')
    .gte('occurred_at', inicioGeral.toISOString())
    .lt('occurred_at', fimGeral.toISOString())
    .order('occurred_at', { ascending: true });

  query = isDefault
    ? query.or(`card_id.eq.${card.id},card_id.is.null`)
    : query.eq('card_id', card.id);

  const [resTransacoes, pagamentos] = await Promise.all([
    query,
    buscarPagamentosFatura(card.id, inicioGeral, fimGeral, requestId),
  ]);

  const transacoes = (resTransacoes.data ?? []) as unknown as ItemFaturaCartao[];

  return ciclos.map((c) => {
    const inicioMs = c.inicio.getTime();
    const fimMs = c.fim.getTime();

    const itensDoCiclo = transacoes.filter((t) => {
      const tMs = new Date(t.occurred_at).getTime();
      return tMs >= inicioMs && tMs < fimMs;
    });

    const pagamentosDoCiclo = pagamentos.filter((p) => {
      const pMs = new Date(p.paid_at).getTime();
      return pMs >= inicioMs && pMs < fimMs;
    });

    const totalCompras = itensDoCiclo.reduce((s, t) => s + Number(t.total_amount || 0), 0);
    const totalPago = pagamentosDoCiclo.reduce((s, p) => s + Number(p.amount || 0), 0);
    const valorFatura = Math.max(0, Math.round((totalCompras - totalPago) * 100) / 100);

    let status: 'fechada' | 'aberta' | 'paga' | 'parcial' | 'futura' = c.statusPadrao;
    if (totalPago >= totalCompras && totalCompras > 0) {
      status = 'paga';
    } else if (totalPago > 0 && totalPago < totalCompras) {
      status = 'parcial';
    }

    const itensComPagamentos: ItemFaturaCartao[] = [...itensDoCiclo];
    pagamentosDoCiclo.forEach((p, idx) => {
      itensComPagamentos.push({
        display_id: 990000 + idx,
        description: 'Pagamento de fatura recebido',
        total_amount: Number(p.amount),
        occurred_at: p.paid_at,
        installment_number: null,
        installment_total: null,
        is_payment: true,
      });
    });

    return {
      id: c.id,
      rotulo: c.rotulo,
      mesReferencia: c.mesReferencia,
      status,
      inicio: c.inicio.toISOString(),
      fechamento: c.fechamento.toISOString(),
      vencimento: c.vencimento.toISOString(),
      totalCompras: Math.round(totalCompras * 100) / 100,
      totalPago: Math.round(totalPago * 100) / 100,
      valorFatura,
      itens: itensComPagamentos.reverse(),
    };
  });
}

export interface PagamentoFaturaDTO {
  cardId: string;
  accountId: string;
  amount: number;
  paidAt?: string;
}

export interface ResultadoPagamentoFatura {
  sucesso: boolean;
  mensagem: string;
  authCode: string;
  cardId: string;
  cardName: string;
  accountId: string;
  accountName: string;
  amount: number;
  paidAt: string;
  novoSaldoConta: number;
  novaFaturaAtual: number;
  novoLimiteDisponivel: number;
}

/**
 * Processa o pagamento de uma fatura de cartão usando o saldo de um bolso/conta.
 * Debita a conta imediatamente, quita o saldo devedor do cartão e libera o limite.
 */
export async function processarPagamentoFatura(
  dto: PagamentoFaturaDTO,
  requestId: string
): Promise<ResultadoPagamentoFatura> {
  return withTiming('processar pagamento fatura com saldo', { requestId, dto }, async () => {
    const supabase = getSupabaseClient();
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new Error('O valor do pagamento deve ser maior que zero.');
    }

    const isCardUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.cardId);
    let cardQuery = supabase
      .from('cards')
      .select('id, name, closing_day, credit_limit, due_day');

    if (isCardUuid) {
      cardQuery = cardQuery.eq('id', dto.cardId);
    } else {
      cardQuery = cardQuery.ilike('name', dto.cardId.trim());
    }

    const { data: card, error: errCard } = await cardQuery.maybeSingle();

    if (errCard || !card) {
      throw new Error(`Cartão "${dto.cardId}" não encontrado.`);
    }

    const isAccountUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.accountId);
    let conta = isAccountUuid
      ? await obterContaPorId(dto.accountId, requestId)
      : await obterContaPorNome(dto.accountId, requestId);

    if (!conta && !isAccountUuid) {
      conta = await obterContaPorId(dto.accountId, requestId).catch(() => null);
    }

    if (!conta) {
      throw new Error(`Conta de origem "${dto.accountId}" não encontrada.`);
    }

    const saldoAtualConta = Number(conta.balance || 0);
    if (saldoAtualConta < amount) {
      throw new Error(
        `Saldo insuficiente no bolso "${conta.name}". Disponível: R$ ${saldoAtualConta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
      );
    }

    const novoSaldoConta = await debitarSaldo(conta.id, amount, requestId);
    const paidAt = dto.paidAt || new Date().toISOString();
    const authCode = `GUA-${paidAt.slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;

    try {
      await supabase.from('invoice_payments').insert({
        card_id: card.id,
        account_id: conta.id,
        amount,
        paid_at: paidAt,
        payment_method: 'account_balance',
        notes: `Pagamento de fatura • ${card.name}`,
      });
    } catch (errPay: any) {
      log('warn', 'Aviso ao registrar em invoice_payments', { requestId, erro: errPay.message });
    }

    try {
      const { data: cat } = await supabase.from('categories').select('id').limit(1).single();
      await supabase.from('transactions').insert({
        description: `Pagamento de Fatura • ${card.name}`,
        total_amount: amount,
        my_share_amount: amount,
        category_id: cat?.id || 1,
        payment_method: 'debit_card',
        account_id: conta.id,
        card_id: card.id,
        entry_type: 'transfer',
        occurred_at: paidAt,
        raw_input: `Pagamento de fatura do cartão ${card.name} no valor de R$ ${amount}`,
      });
    } catch (errTx: any) {
      log('warn', 'Aviso ao registrar transação no extrato', { requestId, erro: errTx.message });
    }

    const faturas = await obterFaturasDetalhadasDoCartao(card as unknown as Cartao, false, requestId);
    const faturaAlvo = faturas.find((f) => f.status === 'fechada' && f.valorFatura > 0) || faturas[0];
    const novaFaturaAtual = faturaAlvo ? faturaAlvo.valorFatura : 0;
    const limiteTotal = Number(card.credit_limit || 0);
    const novoLimiteDisponivel = Math.max(0, limiteTotal - novaFaturaAtual);

    log('info', 'Pagamento de fatura processado com sucesso', {
      requestId,
      cartao: card.name,
      conta: conta.name,
      valor: amount,
      authCode,
      novoSaldoConta,
      novaFaturaAtual,
      novoLimiteDisponivel,
    });

    return {
      sucesso: true,
      mensagem: `Fatura de ${card.name} paga com sucesso! R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} debitados de ${conta.name}.`,
      authCode,
      cardId: card.id,
      cardName: card.name,
      accountId: conta.id,
      accountName: conta.name,
      amount,
      paidAt,
      novoSaldoConta,
      novaFaturaAtual,
      novoLimiteDisponivel,
    };
  });
}

/**
 * Obtém todos os cartões cadastrados já calculando as faturas detalhadas
 * (fechada, atual e próximas faturas), limite restante e lançamentos.
 */
export async function obterCartoesDetalhados(requestId: string): Promise<CartaoDetalhado[]> {
  return withTiming('obter cartões detalhados', { requestId }, async () => {
    const cartoes = await listarCartoes(requestId);
    if (cartoes.length === 0) return [];

    const hoje = new Date();
    const resultado: CartaoDetalhado[] = [];

    for (let i = 0; i < cartoes.length; i++) {
      const card = cartoes[i];
      const isDefault = i === 0 || card.is_default;
      const faturas = await obterFaturasDetalhadasDoCartao(card, isDefault, requestId, hoje);

      // A fatura ativa para exibição no card principal:
      // se houver fatura fechada com saldo devedor, ela é a principal a pagar.
      // senão, a fatura aberta do mês.
      const faturaFechadaPendente = faturas.find((f) => f.status === 'fechada' && f.valorFatura > 0);
      const faturaAberta = faturas.find((f) => f.status === 'aberta' || f.status === 'parcial') || faturas[0];
      const faturaPrincipal = faturaFechadaPendente || faturaAberta;

      const totalFatura = faturaPrincipal ? faturaPrincipal.valorFatura : 0;
      const limite = Number(card.credit_limit || 0);
      const disponivel = Math.max(0, limite - totalFatura);
      const percentual = limite > 0 ? Math.min(100, (totalFatura / limite) * 100) : 0;

      resultado.push({
        ...card,
        faturaAtual: totalFatura,
        limiteDisponivel: disponivel,
        percentualUtilizado: Number(percentual.toFixed(1)),
        totalPagoCiclo: faturaPrincipal?.totalPago ?? 0,
        statusFatura: faturaPrincipal?.status ?? 'aberta',
        periodo: {
          inicio: faturaPrincipal?.inicio ?? new Date().toISOString(),
          fim: faturaPrincipal?.fechamento ?? new Date().toISOString(),
          fechamento: faturaPrincipal?.fechamento ?? new Date().toISOString(),
        },
        itensFatura: faturaPrincipal?.itens ?? [],
        faturas,
      });
    }

    return resultado;
  });
}