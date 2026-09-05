import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { resolveThirdPartyId } from '../people/peopleService';
import { calcularParcelas } from './installments';
import type { ParsedTransaction, PaymentMethod } from '../../types/transaction';

/**
 * Insere a transação. Se `installment_total` >= 2, divide o valor em N
 * linhas (uma por parcela), cada uma com occurred_at incrementado em um
 * mês e sufixo "(i/N)" na descrição, todas ligadas por installment_group_id.
 * Retorna os display_id gerados (para os botões inline).
 */
export async function registrarTransacao(
  dados: ParsedTransaction,
  rawInput: string,
  requestId: string
): Promise<{ displayIds: number[] }> {
  let thirdPartyId: string | null = null;
  if (dados.third_party_name) {
    thirdPartyId = await resolveThirdPartyId(dados.third_party_name, requestId);
  }

  const ehParcelado = !!dados.installment_total && dados.installment_total >= 2;

  return withTiming('inserir transação no Supabase', { requestId, parcelado: ehParcelado }, async () => {
    const supabase = getSupabaseClient();

    if (!ehParcelado) {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          description: dados.description,
          total_amount: dados.total_amount,
          category_id: dados.category_id,
          payment_method: dados.payment_method,
          occurred_at: dados.occurred_at,
          my_share_amount: dados.my_share_amount ?? null,
          third_party_id: thirdPartyId,
          raw_input: rawInput,
        })
        .select('display_id')
        .single();

      if (error) throw new Error(`Erro ao inserir no Supabase: ${error.message}`);
      return { displayIds: [data.display_id as number] };
    }

    const parcelas = calcularParcelas(dados.total_amount, dados.installment_total as number, dados.occurred_at);

    // Divide my_share_amount proporcionalmente a cada parcela, mantendo a
    // mesma proporção do valor total (ex: se 50% é minha parte no total,
    // 50% de cada parcela também é).
    const linhas = parcelas.map((p) => ({
      description: `${dados.description} ${p.descriptionSuffix}`,
      total_amount: p.amount,
      category_id: dados.category_id,
      payment_method: dados.payment_method,
      occurred_at: p.occurredAt,
      my_share_amount:
        dados.my_share_amount != null
          ? Math.round((dados.my_share_amount / dados.total_amount) * p.amount * 100) / 100
          : null,
      third_party_id: thirdPartyId,
      raw_input: rawInput,
      installment_group_id: p.installmentGroupId,
      installment_number: p.installmentNumber,
      installment_total: p.installmentTotal,
    }));

    const { data, error } = await supabase.from('transactions').insert(linhas).select('display_id');
    if (error) throw new Error(`Erro ao inserir parcelas no Supabase: ${error.message}`);

    log('info', 'Compra parcelada registrada', {
      requestId,
      installmentTotal: dados.installment_total,
      qtd_linhas: data?.length ?? 0,
    });

    return { displayIds: (data ?? []).map((d) => d.display_id as number) };
  });
}

export async function atualizarCategoria(displayId: number, categoryId: number, requestId: string): Promise<void> {
  await withTiming('atualizar categoria', { requestId, displayId, categoryId }, async () => {
    const { error } = await getSupabaseClient()
      .from('transactions')
      .update({ category_id: categoryId })
      .eq('display_id', displayId);

    if (error) throw new Error(`Erro ao atualizar categoria: ${error.message}`);
  });
}

export async function atualizarMetodo(displayId: number, metodo: PaymentMethod, requestId: string): Promise<void> {
  await withTiming('atualizar método de pagamento', { requestId, displayId, metodo }, async () => {
    const { error } = await getSupabaseClient()
      .from('transactions')
      .update({ payment_method: metodo })
      .eq('display_id', displayId);

    if (error) throw new Error(`Erro ao atualizar método: ${error.message}`);
  });
}

/**
 * 🔧 CORREÇÃO DO BUG: apaga uma transação por display_id, mas se ela fizer
 * parte de uma compra parcelada (installment_group_id não nulo), apaga
 * TODAS as linhas daquele grupo — nunca apenas a linha encontrada. Isso
 * evita deixar parcelas "órfãs" ativas no banco. Usada tanto pelo
 * /desfazer quanto pelo botão inline ❌ e pelo /apagar <id>.
 */
export async function apagarTransacaoComGrupo(
  displayId: number,
  requestId: string
): Promise<{ displayIds: number[] }> {
  return withTiming('apagar transação (com grupo de parcelas, se houver)', { requestId, displayId }, async () => {
    const supabase = getSupabaseClient();

    const { data: linha, error: erroBusca } = await supabase
      .from('transactions')
      .select('display_id, installment_group_id')
      .eq('display_id', displayId)
      .maybeSingle();

    if (erroBusca) throw new Error(`Erro ao buscar transação ${displayId}: ${erroBusca.message}`);
    if (!linha) return { displayIds: [] };

    if (!linha.installment_group_id) {
      const { error } = await supabase.from('transactions').delete().eq('display_id', displayId);
      if (error) throw new Error(`Erro ao apagar transação ${displayId}: ${error.message}`);
      return { displayIds: [displayId] };
    }

    const { data: apagadas, error: erroDelete } = await supabase
      .from('transactions')
      .delete()
      .eq('installment_group_id', linha.installment_group_id)
      .select('display_id');

    if (erroDelete) {
      throw new Error(`Erro ao apagar grupo de parcelas ${linha.installment_group_id}: ${erroDelete.message}`);
    }

    log('info', 'Grupo de parcelas apagado', {
      requestId,
      installmentGroupId: linha.installment_group_id,
      qtd_linhas: apagadas?.length ?? 0,
    });

    return { displayIds: (apagadas ?? []).map((d) => d.display_id as number) };
  });
}

/**
 * Apaga a transação mais recente (por created_at). Delega para
 * apagarTransacaoComGrupo — se a última linha inserida pertencer a uma
 * compra parcelada, o grupo inteiro é removido junto.
 */
export async function desfazerUltimaTransacao(requestId: string): Promise<{ displayIds: number[] } | null> {
  return withTiming('desfazer última transação', { requestId }, async () => {
    const supabase = getSupabaseClient();

    const { data: ultima, error: erroBusca } = await supabase
      .from('transactions')
      .select('display_id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (erroBusca) throw new Error(`Erro ao buscar última transação: ${erroBusca.message}`);
    if (!ultima) return null;

    return apagarTransacaoComGrupo(ultima.display_id as number, requestId);
  });
}

/** Comando /apagar <id>. Também é group-aware (ver apagarTransacaoComGrupo). */
export async function apagarTransacaoPorId(
  displayId: number,
  requestId: string
): Promise<{ apagou: boolean; displayIds: number[] }> {
  const resultado = await apagarTransacaoComGrupo(displayId, requestId);
  return { apagou: resultado.displayIds.length > 0, displayIds: resultado.displayIds };
}

export async function getUltimosGastos(limite: number, requestId: string) {
  return withTiming('buscar últimos gastos', { requestId, limite }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('display_id, description, total_amount, occurred_at, payment_method, categories(name)')
      .order('occurred_at', { ascending: false })
      .limit(limite);

    if (error) throw new Error(`Erro ao buscar últimos gastos: ${error.message}`);
    return data ?? [];
  });
}

export interface ResumoPorMetodo {
  metodo: PaymentMethod;
  total: number;
}

export interface ResumoMensal {
  meuGastoReal: number;
  gastosRecorrentes: number;
  quantidade: number;
  porMetodo: ResumoPorMetodo[];
}

export async function getResumoMensal(requestId: string): Promise<ResumoMensal> {
  return withTiming('calcular resumo mensal', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('total_amount, my_share_amount, payment_method, is_recurring')
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes);

    if (error) throw new Error(`Erro ao buscar resumo do mês: ${error.message}`);

    const porMetodoMap = new Map<PaymentMethod, number>();
    const resumo: ResumoMensal = { meuGastoReal: 0, gastosRecorrentes: 0, quantidade: 0, porMetodo: [] };

    for (const t of data ?? []) {
      const minhaParte = Number(t.my_share_amount ?? 0);
      const metodo = t.payment_method as PaymentMethod;

      resumo.meuGastoReal += minhaParte;
      if (t.is_recurring) resumo.gastosRecorrentes += minhaParte;
      resumo.quantidade += 1;

      porMetodoMap.set(metodo, (porMetodoMap.get(metodo) ?? 0) + Number(t.total_amount));
    }

    resumo.porMetodo = Array.from(porMetodoMap.entries()).map(([metodo, total]) => ({ metodo, total }));
    return resumo;
  });
}

export interface ItemFatura {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  installment_number: number | null;
  installment_total: number | null;
}

export async function getFaturaMensal(requestId: string): Promise<ItemFatura[]> {
  return withTiming('buscar fatura do cartão', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('display_id, description, total_amount, occurred_at, installment_number, installment_total')
      .eq('payment_method', 'credit_card')
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes)
      .order('occurred_at', { ascending: true });

    if (error) throw new Error(`Erro ao buscar fatura: ${error.message}`);
    return data ?? [];
  });
}