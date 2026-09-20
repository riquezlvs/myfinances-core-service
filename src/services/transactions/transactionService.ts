// src/services/transactions/transactionService.ts
import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { randomUUID } from 'crypto';
import { resolveThirdPartyId } from '../people/peopleService';
import { calcularParcelas } from './installments';
import { mesAnoAtual, intervaloDoMes } from '../../utils/month';
import type { ParsedTransaction, PaymentMethod } from '../../types/transaction';

/**
 * Fase 7 (7.2) — Calcula quanto fica para o terceiro quando há divisão.
 * Antes, `third_party_share_amount` só era preenchido se a IA o inferisse
 * (o que nunca acontecia no schema) e o módulo de dívidas nunca via nada.
 * Agora é derivado automaticamente: total - minha parte. Sem terceiro
 * resolvido, é sempre 0. Sem `my_share_amount` mas com terceiro, assume-se
 * que o total inteiro é responsabilidade do terceiro (ex: "paguei o Uber
 * da Maria, 40 reais" sem menção de divisão).
 */
function calcularThirdPartyShare(totalAmount: number, myShareAmount: number | null | undefined): number {
  const minhaParte = myShareAmount ?? 0;
  return Math.round((totalAmount - minhaParte) * 100) / 100;
}

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
  // 8.7 — Split múltiple: lista de TODAS as pessoas da divisão (a IA envia
  // third_party_names; o campo singular antigo continua aceito como 1 pessoa).
  const nomesTerceiros = dados.third_party_names?.length
    ? dados.third_party_names
    : dados.third_party_name
      ? [dados.third_party_name]
      : [];

  const ehParcelado = !!dados.installment_total && dados.installment_total >= 2;
  // Parcelado e dividido entre várias pessoas ao mesmo tempo não combinam
  // (cada parcela teria N linhas de dívida): o parcelado tem prioridade.
  const ehSplitMultiplo = nomesTerceiros.length > 1 && !ehParcelado;

  let thirdPartyId: string | null = null;
  if (!ehSplitMultiplo && nomesTerceiros.length === 1) {
    thirdPartyId = await resolveThirdPartyId(nomesTerceiros[0], requestId);
  }
  const thirdPartyShareTotal = thirdPartyId
    ? calcularThirdPartyShare(dados.total_amount, dados.my_share_amount)
    : 0;

  return withTiming('inserir transação no Supabase', { requestId, parcelado: ehParcelado, split: ehSplitMultiplo }, async () => {
    const supabase = getSupabaseClient();

    // ------------------------------------------------------------------
    // 8.7 — SPLIT MÚLTIPLE: 1 transação principal (minha parte) + 1 linha
    // de dívida por pessoa (total_amount = 0; a parte da pessoa vai em
    // third_party_share_amount, refletindo automaticamente em /dividas).
    // Todas compartilham o mesmo installment_group_id (grupo de split) para
    // que o desfazer remova o conjunto inteiro de uma vez.
    // ------------------------------------------------------------------
    if (ehSplitMultiplo) {
      const nomes = nomesTerceiros;
      const qtd = nomes.length;
      const ids = await Promise.all(nomes.map((n) => resolveThirdPartyId(n, requestId)));

      const total = dados.total_amount;
      // Minha parte: informada pela IA ou equitativa (total / (pessoas + você)).
      const minhaParte =
        dados.my_share_amount != null
          ? Math.min(Math.round(dados.my_share_amount * 100) / 100, total)
          : Math.round((total / (qtd + 1)) * 100) / 100;
      const restante = Math.round((total - minhaParte) * 100) / 100;
      const parteBase = Math.round((restante / qtd) * 100) / 100;
      const grupoSplit = randomUUID();

      const linhaPrincipal = {
        description: dados.description,
        total_amount: total,
        category_id: dados.category_id,
        payment_method: dados.payment_method,
        card_id: dados.card_id ?? null,
        occurred_at: dados.occurred_at,
        my_share_amount: minhaParte,
        third_party_id: null,
        third_party_share_amount: 0,
        raw_input: rawInput,
        installment_group_id: grupoSplit,
      };

      const linhasDivida = ids.map((id, i) => {
        // A primeira pessoa absorve o resíduo do arredondamento (centavos),
        // garantindo que a soma das partes seja exatamente o restante.
        const parte =
          i === 0 ? Math.round((restante - parteBase * (qtd - 1)) * 100) / 100 : parteBase;
        return {
          description: `${dados.description} (parte de ${nomes[i]})`,
          total_amount: 0,
          category_id: dados.category_id,
          payment_method: dados.payment_method,
          card_id: null,
          occurred_at: dados.occurred_at,
          my_share_amount: 0,
          third_party_id: id,
          third_party_share_amount: parte,
          raw_input: `${rawInput} [divisão: ${nomes[i]}]`,
          installment_group_id: grupoSplit,
        };
      });

      const { data, error } = await supabase
        .from('transactions')
        .insert([linhaPrincipal, ...linhasDivida])
        .select('display_id');
      if (error) throw new Error(`Erro ao inserir despesa dividida no Supabase: ${error.message}`);

      log('info', 'Despesa dividida entre várias pessoas registrada', {
        requestId,
        pessoas: nomes.join(', '),
        minhaParte,
        qtd_linhas: data?.length ?? 0,
      });
      return { displayIds: (data ?? []).map((d) => d.display_id as number) };
    }

    if (!ehParcelado) {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          description: dados.description,
          total_amount: dados.total_amount,
          category_id: dados.category_id,
          payment_method: dados.payment_method,
          card_id: dados.card_id ?? null,
          occurred_at: dados.occurred_at,
          my_share_amount: dados.my_share_amount ?? null,
          third_party_id: thirdPartyId,
          third_party_share_amount: thirdPartyShareTotal,
          raw_input: rawInput,
          entry_type: dados.entry_type ?? 'expense',
          account_id: dados.account_id ?? null,
        })
        .select('display_id')
        .single();

      if (error) throw new Error(`Erro ao inserir no Supabase: ${error.message}`);
      return { displayIds: [data.display_id as number] };
    }

    let closingDay: number | null = null;
    if (dados.payment_method === 'credit_card' && dados.card_id) {
      const { data: cartao } = await supabase
        .from('cards')
        .select('closing_day')
        .eq('id', dados.card_id)
        .maybeSingle();
      if (cartao?.closing_day) {
        closingDay = cartao.closing_day;
      }
    }

    const parcelas = calcularParcelas(
      dados.total_amount,
      dados.installment_total as number,
      dados.occurred_at,
      closingDay
    );

    // Divide my_share_amount e third_party_share_amount proporcionalmente a
    // cada parcela, mantendo a mesma proporção do valor total (ex: se 50% é
    // minha parte no total, 50% de cada parcela também é — e o mesmo vale
    // para a parte do terceiro).
    const linhas = parcelas.map((p) => ({
      description: `${dados.description} ${p.descriptionSuffix}`,
      total_amount: p.amount,
      category_id: dados.category_id,
      payment_method: dados.payment_method,
      card_id: dados.card_id ?? null,
      occurred_at: p.occurredAt,
      my_share_amount:
        dados.my_share_amount != null
          ? Math.round((dados.my_share_amount / dados.total_amount) * p.amount * 100) / 100
          : null,
      third_party_id: thirdPartyId,
      third_party_share_amount: thirdPartyId
        ? Math.round((thirdPartyShareTotal / dados.total_amount) * p.amount * 100) / 100
        : 0,
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

export async function atualizarCategoriaEmLote(
  displayIds: number[],
  categoryId: number,
  requestId: string
): Promise<void> {
  if (!displayIds.length) return;
  await withTiming('atualizar categoria em lote', { requestId, count: displayIds.length, categoryId }, async () => {
    const { error } = await getSupabaseClient()
      .from('transactions')
      .update({ category_id: categoryId })
      .in('display_id', displayIds);

    if (error) throw new Error(`Erro ao atualizar categoria em lote: ${error.message}`);
  });
}

export async function atualizarCartaoEmLote(
  displayIds: number[],
  cardId: string,
  requestId: string
): Promise<void> {
  if (!displayIds.length) return;
  await withTiming('atualizar cartão em lote', { requestId, count: displayIds.length, cardId }, async () => {
    const { error } = await getSupabaseClient()
      .from('transactions')
      .update({ card_id: cardId, payment_method: 'credit_card' })
      .in('display_id', displayIds);

    if (error) throw new Error(`Erro ao atualizar cartão em lote: ${error.message}`);
  });
}

export async function atualizarMetodo(displayId: number, metodo: PaymentMethod, requestId: string): Promise<void> {
  await withTiming('atualizar método de pagamento', { requestId, displayId, metodo }, async () => {
    // Troca manual de método invalida o cartão inferido na criação (8.2):
    // um card_id órfão de outro tipo corromperia fatura/vale.
    const { error } = await getSupabaseClient()
      .from('transactions')
      .update({ payment_method: metodo, card_id: null })
      .eq('display_id', displayId);

    if (error) throw new Error(`Erro ao atualizar método: ${error.message}`);
  });
}

export type EscopoExclusaoParcela = 'apenas_esta' | 'esta_e_seguintes' | 'todas';

/**
 * Apaga transações/parcelas conforme o escopo selecionado:
 * - 'apenas_esta': remove somente a linha correspondente ao displayId
 * - 'esta_e_seguintes': remove esta e todas as parcelas com installment_number >= parcela atual
 * - 'todas': remove todo o grupo vinculado a installment_group_id
 */
export async function apagarParcelasPorEscopo(
  displayId: number,
  escopo: EscopoExclusaoParcela,
  requestId: string
): Promise<{ displayIds: number[] }> {
  return withTiming('apagar parcelas por escopo', { requestId, displayId, escopo }, async () => {
    const supabase = getSupabaseClient();

    const { data: linha, error: erroBusca } = await supabase
      .from('transactions')
      .select('display_id, installment_group_id, installment_number')
      .eq('display_id', displayId)
      .maybeSingle();

    if (erroBusca) throw new Error(`Erro ao buscar transação ${displayId}: ${erroBusca.message}`);
    if (!linha) return { displayIds: [] };

    // Se não faz parte de um grupo de parcelas, apaga apenas a própria linha
    if (!linha.installment_group_id || escopo === 'apenas_esta') {
      const { error } = await supabase.from('transactions').delete().eq('display_id', displayId);
      if (error) throw new Error(`Erro ao apagar transação ${displayId}: ${error.message}`);
      return { displayIds: [displayId] };
    }

    let query = supabase
      .from('transactions')
      .delete()
      .eq('installment_group_id', linha.installment_group_id);

    if (escopo === 'esta_e_seguintes' && linha.installment_number != null) {
      query = query.gte('installment_number', linha.installment_number);
    }

    const { data: apagadas, error: erroDelete } = await query.select('display_id');
    if (erroDelete) {
      throw new Error(`Erro ao apagar parcelas no escopo ${escopo}: ${erroDelete.message}`);
    }

    log('info', 'Parcelas apagadas com sucesso', {
      requestId,
      escopo,
      installmentGroupId: linha.installment_group_id,
      qtd_linhas: apagadas?.length ?? 0,
    });

    return { displayIds: (apagadas ?? []).map((d) => d.display_id as number) };
  });
}

/**
 * Antecipa parcelas futuras de uma compra para uma data específica (ou fatura/mês atual),
 * mantendo o grupo e o installment_number para fins de histórico e rastreabilidade.
 */
export async function anteciparParcelas(
  installmentGroupId: string,
  installmentNumbersParaAntecipar: number[],
  novaDataISO: string,
  requestId: string
): Promise<{ displayIds: number[] }> {
  return withTiming(
    'antecipar parcelas',
    { requestId, installmentGroupId, parcelas: installmentNumbersParaAntecipar, novaDataISO },
    async () => {
      const supabase = getSupabaseClient();

      const { data: atualizadas, error } = await supabase
        .from('transactions')
        .update({ occurred_at: novaDataISO })
        .eq('installment_group_id', installmentGroupId)
        .in('installment_number', installmentNumbersParaAntecipar)
        .select('display_id');

      if (error) {
        throw new Error(`Erro ao antecipar parcelas: ${error.message}`);
      }

      log('info', 'Parcelas antecipadas com sucesso', {
        requestId,
        installmentGroupId,
        qtd_atualizadas: atualizadas?.length ?? 0,
      });

      return { displayIds: (atualizadas ?? []).map((d) => d.display_id as number) };
    }
  );
}

export async function apagarTransacaoComGrupo(
  displayId: number,
  requestId: string
): Promise<{ displayIds: number[] }> {
  return apagarParcelasPorEscopo(displayId, 'todas', requestId);
}

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

export async function apagarTransacaoPorId(
  displayId: number,
  requestId: string
): Promise<{ apagou: boolean; displayIds: number[] }> {
  const resultado = await apagarTransacaoComGrupo(displayId, requestId);
  return { apagou: resultado.displayIds.length > 0, displayIds: resultado.displayIds };
}

export async function getUltimosGastos(limite: number, requestId: string) {
  return withTiming('buscar últimos gastos', { requestId, limite }, async () => {
    // 8.7 — Filas de dívida do split têm total_amount = 0: não são gastos.
    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('display_id, description, total_amount, occurred_at, payment_method, entry_type, installment_number, installment_total, installment_group_id, categories(name)')
      .gt('total_amount', 0)
      .order('occurred_at', { ascending: false })
      .limit(limite);

    if (error) throw new Error(`Erro ao buscar últimos gastos: ${error.message}`);
    return data ?? [];
  });
}

/** 8.4 — Item retornado por una consulta granular (categoria e/ou mês). */
export interface ItemGastoConsulta {
  display_id: number;
  description: string;
  total_amount: number;
  occurred_at: string;
  categoria: string | null;
  payment_method: string | null;
}

/** 8.4 — Resultado agregado de `consultarGastosGranulares`. */
export interface ResultadoConsultaGranular {
  /** Suma EXACTA del período (sin tope de `limite`). */
  total: number;
  /** Detalle (los `limite` más recientes del período). */
  items: ItemGastoConsulta[];
}

/**
 * 8.4 — Consulta granular determinística para perguntas em linguagem natural
 * ("quanto gastei com transporte em agosto?"). O `month` já vem validado
 * pelo intentGuard (regex YYYY-MM) e por `mesAnoNaJanela` EM CÓDIGO; esta
 * função NUNCA recebe um mês alucinado. `categoryId` é resolvido pelo
 * handler contra o catálogo do Supabase — a IA nunca pede IDs.
 */
export async function consultarGastosGranulares(
  filtro: { categoryId?: number; month?: string; limite?: number },
  requestId: string
): Promise<ResultadoConsultaGranular> {
  return withTiming('consultar gastos granulares', { requestId, filtro }, async () => {
    const mes = filtro.month ?? mesAnoAtual();
    const intervalo = intervaloDoMes(mes);
    if (!intervalo) {
      // Rede de segurança: mesmo que um bug deixe passar um mês malformado,
      // a query jamais é montada com uma data alucinada.
      throw new Error(`Mês inválido para consulta granular: ${mes}`);
    }

    const supabase = getSupabaseClient();

    // 1) Soma EXATA do período (sem limite) — responde "quanto gastei?".
    let builderTotal = supabase
      .from('transactions')
      .select('total_amount')
      .gte('occurred_at', intervalo.inicioISO)
      .lt('occurred_at', intervalo.fimISO);
    if (filtro.categoryId) builderTotal = builderTotal.eq('category_id', filtro.categoryId);

    // 2) Detalhe (últimos N do período, mais recentes primeiro). Filas de dívida
    // do split (total 0) não aparecem no detalhe.
    let builderDetalle = supabase
      .from('transactions')
      .select('display_id, description, total_amount, occurred_at, payment_method, categories(name)')
      .gte('occurred_at', intervalo.inicioISO)
      .lt('occurred_at', intervalo.fimISO)
      .gt('total_amount', 0)
      .order('occurred_at', { ascending: false })
      .limit(filtro.limite ?? 20);
    if (filtro.categoryId) builderDetalle = builderDetalle.eq('category_id', filtro.categoryId);

    // Rodam em paralelo: latência = max(agregado, detalhe), não a soma.
    const [{ data: dTotal, error: eTotal }, { data, error }] = await Promise.all([
      builderTotal,
      builderDetalle,
    ]);

    if (eTotal) throw new Error(`Erro ao somar consulta granular: ${eTotal.message}`);
    if (error) throw new Error(`Erro ao listar consulta granular: ${error.message}`);

    const total = (dTotal ?? []).reduce((acc, t) => acc + Number(t.total_amount), 0);

    return {
      total,
      items: (data ?? []).map((t) => ({
        display_id: t.display_id as number,
        description: t.description as string,
        total_amount: Number(t.total_amount),
        occurred_at: t.occurred_at as string,
        categoria: (t as any).categories?.name ?? null,
        payment_method: (t as any).payment_method ?? null,
      })),
    };
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

    // 8.7 — Filas de dívida do split (total 0) não contam como lançamentos.
    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('total_amount, my_share_amount, payment_method, is_recurring')
      .gt('total_amount', 0)
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

/**
 * Fase 7 (7.1) — Gasto total por dia do mês corrente (índice 0 = dia 1),
 * usado pelo sparkline do /resumo. Antes usava `getFullYear/getMonth/getDate`
 * (fuso local do processo); agora todo o cálculo — limites do mês e o dia
 * de cada lançamento — usa UTC, evitando que um gasto perto da meia-noite
 * (ex.: 23h30 BRT = madrugada UTC do dia seguinte) caia no dia errado do
 * gráfico. Nota: esta função e `getResumoMensal`/`getGastosPorCategoria`
 * (que seguem em horário local) podem, em teoria, discordar sobre qual é
 * o "mês atual" nos poucos minutos ao redor da virada de mês em UTC — é
 * um limite aceito do escopo do item 7.1, que mira especificamente o
 * agrupamento diário/sparkline.
 */
export async function getGastosDiariosDoMes(requestId: string): Promise<number[]> {
  return withTiming('buscar gastos diários do mês', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)).toISOString();
    const primeiroDiaProxMes = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1)
    ).toISOString();

    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('total_amount, occurred_at')
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes);

    if (error) throw new Error(`Erro ao buscar gastos diários: ${error.message}`);

    const ultimoDia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0)).getUTCDate();
    const porDia = new Array<number>(ultimoDia).fill(0);

    for (const t of data ?? []) {
      const dia = new Date(t.occurred_at as string).getUTCDate();
      if (dia >= 1 && dia <= ultimoDia) {
        porDia[dia - 1] += Number(t.total_amount);
      }
    }
    return porDia;
  });
}

export interface GastoPorCategoria {
  categoria: string;
  total: number;
}

export async function getGastosPorCategoria(requestId: string): Promise<GastoPorCategoria[]> {
  return withTiming('buscar gastos por categoria', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('total_amount, categories(name)')
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes);

    if (error) throw new Error(`Erro ao buscar gastos por categoria: ${error.message}`);

    const totais = new Map<string, number>();
    for (const t of data ?? []) {
      const nome = (t as any).categories?.name ?? 'Outros';
      totais.set(nome, (totais.get(nome) ?? 0) + Number((t as any).total_amount));
    }

    return Array.from(totais.entries())
      .map(([categoria, total]) => ({ categoria, total }))
      .sort((a, b) => b.total - a.total);
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

        // 8.7 — Filas de dívida do split (total 0) não entram na fatura.
    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select('display_id, description, total_amount, occurred_at, installment_number, installment_total')
      .eq('payment_method', 'credit_card')
      .gt('total_amount', 0)
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes)
      .order('occurred_at', { ascending: true });

    if (error) throw new Error(`Erro ao buscar fatura: ${error.message}`);
    return data ?? [];
  });
}

export async function atualizarGastoPorId(
  displayId: number,
  patch: { total_amount?: number; description?: string; occurred_at?: string },
  requestId: string
): Promise<void> {
  if (Object.keys(patch).length === 0) throw new Error('Nenhuma alteração informada.');
  await withTiming('atualizar gasto por ID', { requestId, displayId }, async () => {
    const { error } = await getSupabaseClient().from('transactions').update(patch).eq('display_id', displayId);
    if (error) throw new Error(`Erro ao atualizar gasto: ${error.message}`);
  });
}

export interface ItemLoteExtrato {
  description: string;
  amount: number;
  category_id: number;
  occurred_at: string;
  installment_number?: number | null;
  installment_total?: number | null;
}

export interface ResultadoLoteExtrato {
  inseridos: Array<{ displayId: number; description: string; amount: number }>;
  duplicados: Array<{ description: string; amount: number; data: string }>;
}

/**
 * Registra um lote de despesas extraídas de um extrato/fatura.
 * Executa detecção preventiva de duplicidades (mesmo valor, cartão e dia aproximado).
 * Permite adicionar um comentário ou título geral ao lote (ex: "Fatura Viagem").
 */
export async function registrarLoteExtrato(params: {
  cardId: string | null;
  itens: ItemLoteExtrato[];
  comentarioLote?: string | null;
  requestId: string;
}): Promise<ResultadoLoteExtrato> {
  const { cardId, itens, comentarioLote, requestId } = params;
  return withTiming('registrar lote de extrato', { requestId, totalItens: itens.length }, async () => {
    const supabase = getSupabaseClient();
    const inseridos: Array<{ displayId: number; description: string; amount: number }> = [];
    const duplicados: Array<{ description: string; amount: number; data: string }> = [];

    if (!itens.length) {
      return { inseridos, duplicados };
    }

    // Buscar transações existentes no período para evitar duplicidades
    const datas = itens.map((it) => it.occurred_at.split('T')[0]!).sort();
    const menorData = datas[0]!;
    const maiorData = datas[datas.length - 1]!;

    let queryExistentes = supabase
      .from('transactions')
      .select('description, total_amount, occurred_at')
      .gte('occurred_at', `${menorData}T00:00:00`)
      .lte('occurred_at', `${maiorData}T23:59:59`);

    if (cardId) {
      queryExistentes = queryExistentes.eq('card_id', cardId);
    }

    const { data: existentes } = await queryExistentes;
    const transacoesExistentes = existentes ?? [];

    const ehDuplicado = (item: ItemLoteExtrato): boolean => {
      const dataItem = item.occurred_at.split('T')[0]!;
      const descItem = item.description.trim().toLowerCase();
      return transacoesExistentes.some((ex: any) => {
        const dataEx = String(ex.occurred_at).split('T')[0]!;
        const descEx = String(ex.description).trim().toLowerCase();
        const mesmoValor = Math.abs(Number(ex.total_amount) - item.amount) < 0.01;
        const mesmaData = dataEx === dataItem;
        const descParecida = descEx.includes(descItem) || descItem.includes(descEx);
        return mesmoValor && mesmaData && descParecida;
      });
    };

    const prefixoComentario = comentarioLote?.trim() ? `[${comentarioLote.trim()}] ` : '';

    for (const item of itens) {
      if (ehDuplicado(item)) {
        duplicados.push({
          description: item.description,
          amount: item.amount,
          data: item.occurred_at.split('T')[0]!,
        });
        continue;
      }

      const sufixoParcela =
        item.installment_number && item.installment_total
          ? ` (${item.installment_number}/${item.installment_total})`
          : '';

      // Se a descrição do item já contém a legenda ou é a própria legenda, não adiciona prefixo
      const descJaContemComentario =
        comentarioLote &&
        item.description.toLowerCase().includes(comentarioLote.trim().toLowerCase());
      const prefixoEfetivo =
        prefixoComentario && !descJaContemComentario ? prefixoComentario : '';

      const { data, error } = await supabase
        .from('transactions')
        .insert({
          description: `${prefixoEfetivo}${item.description}${sufixoParcela}`,
          total_amount: item.amount,
          category_id: item.category_id,
          payment_method: 'credit_card',
          card_id: cardId,
          occurred_at: item.occurred_at,
          installment_number: item.installment_number ?? null,
          installment_total: item.installment_total ?? null,
          raw_input: `[extrato${prefixoComentario ? `: ${comentarioLote?.trim()}` : ''}: ${item.description}]`,
        })
        .select('display_id')
        .single();

      if (error) {
        log('error', 'Erro ao inserir item do extrato', { requestId, erro: error.message, item });
        continue;
      }

      if (data?.display_id) {
        inseridos.push({
          displayId: data.display_id as number,
          description: `${prefixoEfetivo}${item.description}${sufixoParcela}`,
          amount: item.amount,
        });
        // Adiciona à lista de existentes em memória para evitar duplicar itens repetidos no próprio extrato
        transacoesExistentes.push({
          description: item.description,
          total_amount: item.amount,
          occurred_at: item.occurred_at,
        });
      }
    }

    log('info', 'Lote de extrato processado', {
      requestId,
      inseridos: inseridos.length,
      duplicados: duplicados.length,
    });

    return { inseridos, duplicados };
  });
}

/**
 * Apaga uma lista de IDs de transações (usado para desfazer importação de extrato em bloco).
 */
export async function apagarTransacoesPorIds(
  displayIds: number[],
  requestId: string
): Promise<{ apagadas: number[] }> {
  return withTiming('apagar transações por IDs', { requestId, count: displayIds.length }, async () => {
    if (!displayIds.length) return { apagadas: [] };
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('transactions')
      .delete()
      .in('display_id', displayIds)
      .select('display_id');

    if (error) throw new Error(`Erro ao apagar lote de transações: ${error.message}`);
    return { apagadas: (data ?? []).map((d) => d.display_id as number) };
  });
}

/**
 * Registra uma entrada de dinheiro (salário, freelance, recarga de VR, etc.)
 * e credita opcionalmente o saldo da conta vinculada.
 */
export async function registrarEntrada(
  dados: {
    description: string;
    total_amount: number;
    account_name?: string | null;
    account_id?: string | null;
    category_id?: number;
    occurred_at?: string;
  },
  rawInput: string,
  requestId: string
): Promise<{ displayId: number; accountName: string; novoSaldo?: number }> {
  return withTiming('registrar entrada', { requestId, total_amount: dados.total_amount }, async () => {
    const supabase = getSupabaseClient();
    let accountId = dados.account_id ?? null;
    let accountName = dados.account_name ?? 'Conta Principal';

    if (!accountId && dados.account_name) {
      try {
        const { data: c } = await supabase
          .from('accounts')
          .select('id, name')
          .ilike('name', dados.account_name.trim())
          .maybeSingle();
        if (c) {
          accountId = c.id;
          accountName = c.name;
        }
      } catch {
        // Ignora caso tabela de contas ainda não exista no ambiente
      }
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        description: dados.description,
        total_amount: dados.total_amount,
        category_id: dados.category_id ?? 1,
        payment_method: 'pix',
        occurred_at: dados.occurred_at ?? new Date().toISOString(),
        raw_input: rawInput,
        entry_type: 'income',
        account_id: accountId,
      })
      .select('display_id')
      .single();

    if (error) throw new Error(`Erro ao registrar entrada no Supabase: ${error.message}`);

    let novoSaldo: number | undefined;
    if (accountId) {
      try {
        const { data: acc } = await supabase
          .from('accounts')
          .select('balance')
          .eq('id', accountId)
          .maybeSingle();
        if (acc) {
          novoSaldo = Math.round((Number(acc.balance) + dados.total_amount) * 100) / 100;
          await supabase
            .from('accounts')
            .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
            .eq('id', accountId);
        }
      } catch {
        // Ignora erro caso ocorra em ambiente isolado
      }
    }

    return {
      displayId: data.display_id as number,
      accountName,
      novoSaldo,
    };
  });
}

export interface GraficosDashboardData {
  distribuicaoCategorias: Array<{
    categoria: string;
    total: number;
    percentual: number;
    cor: string;
  }>;
  totalCategorias: number;
  rotuloMesAtual: string;
  evolucao: {
    totalMesAtual: number;
    variacaoPercentual: number;
    seisMeses: Array<{ label: string; total: number; mesAno: string }>;
    trintaDias: Array<{ label: string; total: number; data: string }>;
    seteDias: Array<{ label: string; total: number; data: string }>;
  };
}

export async function obterDadosGraficosDashboard(requestId: string): Promise<GraficosDashboardData> {
  return withTiming('obter dados graficos dashboard', { requestId }, async () => {
    const supabase = getSupabaseClient();
    const agora = new Date();

    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const rotuloMesAtual = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(agora);

    // 1. Categorias do mês atual
    const primeiroDiaMesAtual = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
    const primeiroDiaProxMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1)).toISOString();

    const { data: transacoesMes, error: errMes } = await supabase
      .from('transactions')
      .select('total_amount, entry_type, occurred_at, categories(name)')
      .gte('occurred_at', primeiroDiaMesAtual)
      .lt('occurred_at', primeiroDiaProxMes);

    if (errMes) throw new Error(`Erro ao buscar transações do mês: ${errMes.message}`);

    const totaisPorCat = new Map<string, number>();
    let totalGeralCategorias = 0;

    for (const t of transacoesMes ?? []) {
      if ((t as any).entry_type === 'income') continue;
      const valor = Number((t as any).total_amount) || 0;
      const nome = (t as any).categories?.name || 'Outros';
      totaisPorCat.set(nome, (totaisPorCat.get(nome) ?? 0) + valor);
      totalGeralCategorias += valor;
    }

    const coresPalette = ['#0a0a0a', '#525252', '#8c8c8c', '#a3a3a3', '#d4d4d4', '#e5e5e5'];
    const distribuicaoCategorias = Array.from(totaisPorCat.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([categoria, total], idx) => ({
        categoria,
        total: Math.round(total * 100) / 100,
        percentual: totalGeralCategorias > 0 ? Math.round((total / totalGeralCategorias) * 100) : 0,
        cor: coresPalette[idx % coresPalette.length],
      }));

    // 2. Evolução dos últimos 6 meses
    const seisMesesInicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 5, 1)).toISOString();
    const { data: transacoes6m, error: err6m } = await supabase
      .from('transactions')
      .select('total_amount, occurred_at, entry_type')
      .gte('occurred_at', seisMesesInicio)
      .lt('occurred_at', primeiroDiaProxMes)
      .order('occurred_at', { ascending: true });

    if (err6m) throw new Error(`Erro ao buscar histórico semestral: ${err6m.message}`);

    const seisMeses: Array<{ label: string; total: number; mesAno: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const mAno = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      seisMeses.push({
        label: mesesNomes[d.getMonth()],
        mesAno: mAno,
        total: 0,
      });
    }

    for (const t of transacoes6m ?? []) {
      if ((t as any).entry_type === 'income') continue;
      const dataStr = (t as any).occurred_at?.slice(0, 7);
      const slot = seisMeses.find((s) => s.mesAno === dataStr);
      if (slot) {
        slot.total += Number((t as any).total_amount) || 0;
      }
    }

    seisMeses.forEach((s) => {
      s.total = Math.round(s.total * 100) / 100;
    });

    const totalMesAtual = seisMeses[seisMeses.length - 1]?.total || 0;
    const totalMesAnterior = seisMeses[seisMeses.length - 2]?.total || 0;
    const variacaoPercentual =
      totalMesAnterior > 0
        ? Math.round(((totalMesAtual - totalMesAnterior) / totalMesAnterior) * 1000) / 10
        : 0;

    // 3. 30 dias (dias do mês atual)
    const ultimoDiaMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
    const trintaDias: Array<{ label: string; total: number; data: string }> = [];
    for (let d = 1; d <= ultimoDiaMes; d++) {
      trintaDias.push({
        label: String(d),
        data: `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        total: 0,
      });
    }

    for (const t of transacoesMes ?? []) {
      if ((t as any).entry_type === 'income') continue;
      const diaNum = parseInt((t as any).occurred_at?.slice(8, 10), 10);
      if (diaNum >= 1 && diaNum <= ultimoDiaMes) {
        trintaDias[diaNum - 1].total += Number((t as any).total_amount) || 0;
      }
    }
    trintaDias.forEach((d) => (d.total = Math.round(d.total * 100) / 100));

    // 4. Últimos 7 dias
    const seteDias: Array<{ label: string; total: number; data: string }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - i);
      const diaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()];
      const iso = d.toISOString().slice(0, 10);
      seteDias.push({
        label: diaSemana,
        data: iso,
        total: 0,
      });
    }

    const seteDiasInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 6).toISOString();
    const { data: transacoes7d } = await supabase
      .from('transactions')
      .select('total_amount, occurred_at, entry_type')
      .gte('occurred_at', seteDiasInicio);

    for (const t of transacoes7d ?? []) {
      if ((t as any).entry_type === 'income') continue;
      const iso = (t as any).occurred_at?.slice(0, 10);
      const slot = seteDias.find((s) => s.data === iso);
      if (slot) {
        slot.total += Number((t as any).total_amount) || 0;
      }
    }
    seteDias.forEach((d) => (d.total = Math.round(d.total * 100) / 100));

    return {
      distribuicaoCategorias,
      totalCategorias: Math.round(totalGeralCategorias * 100) / 100,
      rotuloMesAtual,
      evolucao: {
        totalMesAtual,
        variacaoPercentual,
        seisMeses,
        trintaDias,
        seteDias,
      },
    };
  });
}