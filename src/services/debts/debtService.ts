import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { buscarPessoaId, listarOuCriarPessoas } from '../people/peopleService';
import { formatarReal } from '../../utils/formatters';
import type { SaldoTerceiro, ResultadoPagamento } from '../../types/transaction';
import { intervaloDoMes, mesAnoAtual } from '../../utils/month';
import { randomUUID } from 'crypto';

/** Resultado do split de contas: transação + linhas de dívida criadas. */
export interface ResultadoSplit {
  transactionId: string;
  total: number;
  minhaParte: number;
  partes: Array<{ nome: string; pessoaId: string; valor: number }>;
}

/** Linha de dívida de um split (para exibição no /dividas). */
export interface LinhaDividaSplit {
  transactionId: string;
  descricao: string;
  total: number;
  minhaParte: number;
  devedores: Array<{ nome: string; valor: number }>;
  ocorreuEm: string;
}

export async function getSaldoTerceiros(requestId: string, incluirTotais = false): Promise<SaldoTerceiro[]> {
  return withTiming('calcular saldo de terceiros', { requestId }, async () => {
    const supabase = getSupabaseClient();

    const { data: dividas, error: erroDividas } = await supabase
      .from('transactions')
      .select('display_id, description, third_party_id, third_party_share_amount, installment_number, installment_total, occurred_at, people(name)')
      .gt('third_party_share_amount', 0);

    if (erroDividas) throw new Error(`Erro ao buscar dívidas: ${erroDividas.message}`);

    const { data: pagamentos, error: erroPagamentos } = await supabase
      .from('debt_payments')
      .select('person_id, amount');

    if (erroPagamentos) throw new Error(`Erro ao buscar pagamentos: ${erroPagamentos.message}`);

    const saldosPorId = new Map<string, { nome: string; linhas: any[] }>();
    const intervaloAtual = intervaloDoMes(mesAnoAtual());

    for (const linha of (dividas ?? []) as any[]) {
      const id: string | null = linha.third_party_id;
      const nome: string | undefined = linha.people?.name;
      if (!id || !nome) continue;
      const atual = saldosPorId.get(id) ?? { nome, linhas: [] };
      atual.linhas.push(linha);
      saldosPorId.set(id, atual);
    }

    const pagamentosPorId = new Map<string, number>();
    for (const pagamento of (pagamentos ?? []) as any[]) {
      pagamentosPorId.set(
        pagamento.person_id,
        (pagamentosPorId.get(pagamento.person_id) ?? 0) + Number(pagamento.amount)
      );
    }

    log('info', 'Saldos calculados', {
      requestId,
      qtd_dividas: dividas?.length ?? 0,
      qtd_pagamentos: pagamentos?.length ?? 0,
    });

    return Array.from(saldosPorId.entries())
      .map(([id, s]) => {
        const linhas = [...s.linhas].sort(
          (a, b) => new Date(a.occurred_at ?? 0).getTime() - new Date(b.occurred_at ?? 0).getTime()
        );
        let pagamentoRestante = pagamentosPorId.get(id) ?? 0;
        const parcelas = linhas
          .map((linha) => {
            const bruto = Number(linha.third_party_share_amount);
            const abatimento = Math.min(bruto, pagamentoRestante);
            pagamentoRestante -= abatimento;
            const valor = Math.round((bruto - abatimento) * 100) / 100;
            return {
              displayId: linha.display_id == null ? undefined : Number(linha.display_id),
              descricao: linha.description ?? undefined,
              valor,
              numero: linha.installment_number == null ? undefined : Number(linha.installment_number),
              total: linha.installment_total == null ? undefined : Number(linha.installment_total),
              ocorreuEm: linha.occurred_at ?? undefined,
            };
          })
          .filter((parcela) => parcela.valor > 0.009);
        const valor = Math.round(parcelas.reduce((total, parcela) => total + parcela.valor, 0) * 100) / 100;
        const total = Math.round(
          s.linhas.reduce((soma, linha) => soma + Number(linha.third_party_share_amount), 0) * 100
        ) / 100;
        const totalMes = intervaloAtual
          ? Math.round(
              s.linhas
                .filter((linha) => linha.occurred_at >= intervaloAtual.inicioISO && linha.occurred_at < intervaloAtual.fimISO)
                .reduce((soma, linha) => soma + Number(linha.third_party_share_amount), 0) * 100
            ) / 100
          : 0;
        const saldo: SaldoTerceiro = { nome: s.nome, valor };
        if (incluirTotais) {
          saldo.total = total;
          saldo.totalMes = totalMes;
        }
        saldo.parcelas = parcelas;
        return saldo;
      })
      .filter((s) => s.valor > 0.009);
  });
}

export async function registrarPagamentoNoBanco(
  personId: string,
  valor: number,
  requestId: string
): Promise<void> {
  await withTiming('registrar pagamento no ledger', { requestId, personId, valor }, async () => {
    const { error } = await getSupabaseClient()
      .from('debt_payments')
      .insert({ person_id: personId, amount: valor });

    if (error) throw new Error(`Erro ao registrar pagamento: ${error.message}`);
  });
}

/**
 * Orquestra um pagamento de ponta a ponta: resolve a pessoa, calcula o
 * saldo devido, trava o valor no saldo (nunca gera crédito) e registra no
 * ledger. Retorna um resultado discriminado por `status` — a camada de bot
 * só formata a mensagem, nenhuma regra de negócio vive nos handlers.
 */
export async function processarPagamento(
  nomeBruto: string,
  valorInformado: number | undefined,
  requestId: string
): Promise<ResultadoPagamento> {
  const nome = nomeBruto.trim();

  const personId = await buscarPessoaId(nome, requestId);
  if (!personId) {
    return { status: 'pessoa_nao_encontrada', nome };
  }

  const saldos = await getSaldoTerceiros(requestId);
  const saldoPessoa = saldos.find((s) => s.nome.toLowerCase() === nome.toLowerCase());

  if (!saldoPessoa || saldoPessoa.valor <= 0) {
    return { status: 'sem_divida', nome };
  }

  let valorPago = valorInformado ?? saldoPessoa.valor;
  let avisoValorAjustado: string | undefined;

  if (valorPago > saldoPessoa.valor + 0.01) {
    avisoValorAjustado = `${nome} devia apenas R$ ${formatarReal(
      saldoPessoa.valor
    )}. Registrei o valor total devido, não o valor informado.`;
    valorPago = saldoPessoa.valor;
  }

  await registrarPagamentoNoBanco(personId, valorPago, requestId);

  const saldoRestante = Math.max(saldoPessoa.valor - valorPago, 0);

  if (saldoRestante <= 0.009) {
    return { status: 'quitado', nome, valorPago, avisoValorAjustado };
  }

  return { status: 'parcial', nome, valorPago, saldoRestante, avisoValorAjustado };
}

export interface ResumoDividasPorMes {
  totalAReceber: number;
  totalAReceberMes: number;
  totalAReceberGeral: number;
  pendentesCount: number;
  pendentesCountMes: number;
  pendentesCountGeral: number;
  porMes: Array<{
    mesAno: string;
    rotulo: string;
    total: number;
    pendentesCount: number;
  }>;
}

/**
 * 8.7 — Split de contas avançado: registra uma transação principal e cria
 * linhas de dívida para cada pessoa mencionada.
 *
 * Exemplo: "Jantar de 120 dividido em 3 com Maria e João" →
 *   - 1 transação de R$ 120,00
 *   - minhaParte = R$ 40,00 (total / numeroDePessoas)
 *   - 2 linhas de dívida: Maria R$ 40,00, João R$ 40,00
 *
 * Se displayId for informado, atualiza a transação original existente em vez de
 * duplicá-la.
 */
export async function salvarDividida(params: {
  displayId?: number;
  descricao: string;
  total: number;
  categoryId: number;
  paymentMethod: string;
  ocorreuEm: string;
  pessoas: string[];
  requestId: string;
}): Promise<ResultadoSplit> {
  const { displayId, descricao, total, categoryId, paymentMethod, ocorreuEm, pessoas, requestId } = params;

  return withTiming('salvar despesa dividida', { requestId, total, qtdPessoas: pessoas?.length ?? 0 }, async () => {
    if (!descricao || !descricao.trim()) throw new Error('Descrição da despesa dividida é obrigatória.');
    if (!Number.isFinite(total) || total <= 0) throw new Error('Total da despesa dividida inválido.');
    if (!pessoas || pessoas.length < 1) {
      throw new Error('Informe pelo menos 1 pessoa para dividir a conta.');
    }

    const supabase = getSupabaseClient();
    const mapaPessoas = await listarOuCriarPessoas(pessoas, requestId);

    // Calcula partes: n = pessoas citadas + o usuário.
    const n = pessoas.length + 1;
    const minhaParte = Math.round((total / n) * 100) / 100;
    const parteCadaOutro = Math.round(((total - minhaParte) / pessoas.length) * 100) / 100;

    let grupoSplit = randomUUID();
    let transactionId = '';

    if (displayId) {
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('id, installment_group_id')
        .eq('display_id', displayId)
        .maybeSingle();

      if (existingTx) {
        transactionId = existingTx.id;
        grupoSplit = existingTx.installment_group_id || grupoSplit;
        const { error: erroUpdate } = await supabase
          .from('transactions')
          .update({
            my_share_amount: minhaParte,
            third_party_share_amount: total - minhaParte,
            installment_group_id: grupoSplit,
          })
          .eq('id', existingTx.id);

        if (erroUpdate) {
          throw new Error(`Erro ao atualizar transação original: ${erroUpdate.message}`);
        }
      }
    }

    if (!transactionId) {
      // Registra a transação principal se não veio displayId existente
      const { data: transacao, error: erroTransacao } = await supabase
        .from('transactions')
        .insert({
          description: descricao.trim(),
          total_amount: total,
          category_id: categoryId,
          payment_method: paymentMethod,
          occurred_at: ocorreuEm,
          my_share_amount: minhaParte,
          third_party_share_amount: total - minhaParte,
          installment_group_id: grupoSplit,
        })
        .select('id')
        .single();

      if (erroTransacao) throw new Error(`Erro ao registrar despesa dividida: ${erroTransacao.message}`);
      transactionId = transacao.id as string;
    }

    // Cria as dívidas individuais para cada outra pessoa
    // Nota: total_amount = 0 para não inflacionar o total de gastos do extrato,
    // enquanto third_party_share_amount armazena o débito a receber
    const partes: Array<{ nome: string; pessoaId: string; valor: number }> = [];
    const nomesResolvidos = [...mapaPessoas.entries()];

    for (const [nomeNormalizado, pessoaId] of nomesResolvidos) {
      if (!pessoaId) continue;
      const nomeOriginal = pessoas.find((p) => p.trim().toLowerCase() === nomeNormalizado);
      if (!nomeOriginal) continue;

      const { error: erroDivida } = await supabase
        .from('transactions')
        .insert({
          description: `${descricao.trim()} (parte de ${nomeOriginal})`,
          total_amount: 0,
          category_id: categoryId,
          payment_method: paymentMethod,
          occurred_at: ocorreuEm,
          my_share_amount: 0,
          third_party_id: pessoaId,
          third_party_share_amount: parteCadaOutro,
          installment_group_id: grupoSplit,
        });

      if (erroDivida) throw new Error(`Erro ao registrar dívida de ${nomeOriginal}: ${erroDivida.message}`);

      partes.push({ nome: nomeOriginal, pessoaId, valor: parteCadaOutro });
    }

    log('info', 'Despesa dividida registrada', {
      requestId,
      transactionId,
      total,
      minhaParte,
      partes: partes.length,
    });

    return {
      transactionId,
      total,
      minhaParte,
      partes,
    };
  });
}

/**
 * Obtém resumo estatístico consolidado de dívidas por mês
 */
export async function obterResumoDividasPorMes(
  requestId: string,
  mesAnoAlvo?: string
): Promise<ResumoDividasPorMes> {
  return withTiming('obter resumo de dívidas por mês', { requestId, mesAnoAlvo }, async () => {
    const supabase = getSupabaseClient();
    const mesFiltro = mesAnoAlvo || mesAnoAtual();

    // 1. Busca todas as transações com dívida
    const { data: dividas, error: erroDividas } = await supabase
      .from('transactions')
      .select('display_id, description, third_party_id, third_party_share_amount, occurred_at, people(name)')
      .gt('third_party_share_amount', 0);

    if (erroDividas) throw new Error(`Erro ao buscar dívidas: ${erroDividas.message}`);

    // 2. Busca todos os pagamentos
    const { data: pagamentos, error: erroPagamentos } = await supabase
      .from('debt_payments')
      .select('person_id, amount, created_at');

    if (erroPagamentos) throw new Error(`Erro ao buscar pagamentos: ${erroPagamentos.message}`);

    const pagamentosPorId = new Map<string, number>();
    for (const p of pagamentos ?? []) {
      const atual = pagamentosPorId.get(p.person_id) ?? 0;
      pagamentosPorId.set(p.person_id, atual + Number(p.amount));
    }

    // Agrupa por mês e por pessoa
    const mesesMap = new Map<string, { total: number; pessoas: Set<string> }>();
    const saldosGeraisPorPessoa = new Map<string, number>();

    for (const linha of (dividas ?? []) as any[]) {
      const id = linha.third_party_id;
      const valor = Number(linha.third_party_share_amount || 0);
      if (!id || valor <= 0) continue;

      saldosGeraisPorPessoa.set(id, (saldosGeraisPorPessoa.get(id) ?? 0) + valor);

      const mes = (linha.occurred_at || '').substring(0, 7) || mesAnoAtual();
      const mesData = mesesMap.get(mes) ?? { total: 0, pessoas: new Set<string>() };
      mesData.total += valor;
      mesData.pessoas.add(id);
      mesesMap.set(mes, mesData);
    }

    // Calcula saldo geral restante abatendo pagamentos
    let totalAReceberGeral = 0;
    let pendentesCountGeral = 0;
    for (const [id, totalDevido] of saldosGeraisPorPessoa.entries()) {
      const pago = pagamentosPorId.get(id) ?? 0;
      const saldo = Math.max(0, Math.round((totalDevido - pago) * 100) / 100);
      if (saldo > 0.009) {
        totalAReceberGeral += saldo;
        pendentesCountGeral++;
      }
    }
    totalAReceberGeral = Math.round(totalAReceberGeral * 100) / 100;

    // Métricas do mês alvo
    const mesAlvoData = mesesMap.get(mesFiltro);
    const totalMesAlvo = Math.round((mesAlvoData?.total ?? 0) * 100) / 100;
    const pendentesCountMes = mesAlvoData?.pessoas.size ?? 0;

    // Lista de meses ordenada descrescente
    const mesesOrdenados = Array.from(mesesMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([m, d]) => ({
        mesAno: m,
        rotulo: m,
        total: Math.round(d.total * 100) / 100,
        pendentesCount: d.pessoas.size,
      }));

    return {
      totalAReceber: mesAnoAlvo ? totalMesAlvo : totalAReceberGeral,
      totalAReceberMes: totalMesAlvo,
      totalAReceberGeral,
      pendentesCount: mesAnoAlvo ? pendentesCountMes : pendentesCountGeral,
      pendentesCountMes,
      pendentesCountGeral,
      porMes: mesesOrdenados,
    };
  });
}

/**
 * 8.7 — Lista todas as despesas divididas (splits) de um mês.
 * Lê as transações com third_party_share_amount > 0 e associa os nomes.
 */
export async function listarListasDivididas(
  requestId: string,
  mesAno?: string
): Promise<LinhaDividaSplit[]> {
  return withTiming('listar despesas divididas', { requestId, mesAno }, async () => {
    const supabase = getSupabaseClient();

    let query = supabase
      .from('transactions')
      .select('id, description, total_amount, my_share_amount, occurred_at, third_party_id, people(name)')
      .gt('third_party_share_amount', 0)
      .order('occurred_at', { ascending: false });

    if (mesAno) {
      const inicio = `${mesAno}-01T00:00:00`;
      const [ano, mes] = mesAno.split('-').map(Number);
      const fim = `${ano}-${String(mes + 1).padStart(2, '0')}-01T00:00:00`;
      query = query.gte('occurred_at', inicio).lt('occurred_at', fim);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao buscar despesas divididas: ${error.message}`);

    const linhas: LinhaDividaSplit[] = [];
    for (const row of (data ?? []) as any[]) {
      const nome: string | undefined = row.people?.name;
      if (!nome) continue;

      linhas.push({
        transactionId: row.id,
        descricao: row.description,
        total: Number(row.total_amount),
        minhaParte: Number(row.my_share_amount ?? 0),
        devedores: [{ nome, valor: Number(row.third_party_share_amount) }],
        ocorreuEm: row.occurred_at,
      });
    }

    return linhas;
  });
}