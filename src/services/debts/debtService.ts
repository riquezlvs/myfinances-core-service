import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { buscarPessoaId, listarOuCriarPessoas } from '../people/peopleService';
import { formatarReal } from '../../utils/formatters';
import type { SaldoTerceiro, ResultadoPagamento } from '../../types/transaction';

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

export async function getSaldoTerceiros(requestId: string): Promise<SaldoTerceiro[]> {
  return withTiming('calcular saldo de terceiros', { requestId }, async () => {
    const supabase = getSupabaseClient();

    const { data: dividas, error: erroDividas } = await supabase
      .from('transactions')
      .select('third_party_id, third_party_share_amount, people(name)')
      .gt('third_party_share_amount', 0);

    if (erroDividas) throw new Error(`Erro ao buscar dívidas: ${erroDividas.message}`);

    const { data: pagamentos, error: erroPagamentos } = await supabase
      .from('debt_payments')
      .select('person_id, amount');

    if (erroPagamentos) throw new Error(`Erro ao buscar pagamentos: ${erroPagamentos.message}`);

    const saldosPorId = new Map<string, { nome: string; saldo: number }>();

    for (const linha of (dividas ?? []) as any[]) {
      const id: string | null = linha.third_party_id;
      const nome: string | undefined = linha.people?.name;
      if (!id || !nome) continue;
      const atual = saldosPorId.get(id) ?? { nome, saldo: 0 };
      atual.saldo += Number(linha.third_party_share_amount);
      saldosPorId.set(id, atual);
    }

    for (const pagamento of (pagamentos ?? []) as any[]) {
      const atual = saldosPorId.get(pagamento.person_id);
      if (!atual) continue;
      atual.saldo -= Number(pagamento.amount);
    }

    log('info', 'Saldos calculados', {
      requestId,
      qtd_dividas: dividas?.length ?? 0,
      qtd_pagamentos: pagamentos?.length ?? 0,
    });

    return Array.from(saldosPorId.values())
      .filter((s) => s.saldo > 0.009)
      .map((s) => ({ nome: s.nome, valor: Math.round(s.saldo * 100) / 100 }));
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

/**
 * 8.7 — Split de contas avançado: registra uma transação principal e cria
 * linhas de dívida para cada pessoa mencionada.
 *
 * Exemplo: "Jantar de 120 dividido em 3 com Maria e João" →
 *   - 1 transação de R$ 120,00
 *   - minhaParte = R$ 40,00 (total / numeroDePessoas)
 *   - 2 linhas de dívida: Maria R$ 40,00, João R$ 40,00
 *
 * SEGURANÇA:
 * - Pessoas são resolvidas em CÓDIGO (listarOuCriarPessoas), nunca via IA.
 * - my_share_amount = total / n (arredondado), nunca negativo.
 * - third_party_share_amount = total - minhaParte, dividido entre as pessoas.
 * - Todas as operações rodam em sequência (sem transação explícita do Supabase,
 *   mas com consistência eventual garantida pelo fluxo do handler).
 */
export async function salvarDividida(params: {
  descricao: string;
  total: number;
  categoryId: number;
  paymentMethod: string;
  ocorreuEm: string;
  pessoas: string[];
  requestId: string;
}): Promise<ResultadoSplit> {
  const { descricao, total, categoryId, paymentMethod, ocorreuEm, pessoas, requestId } = params;

  return withTiming('salvar despesa dividida', { requestId, total, qtdPessoas: pessoas.length }, async () => {
    if (!descricao || !descricao.trim()) throw new Error('Descrição da despesa dividida é obrigatória.');
    if (!Number.isFinite(total) || total <= 0) throw new Error('Total da despesa dividida inválido.');
    if (!pessoas || pessoas.length < 2) {
      throw new Error('São necessárias pelo menos 2 pessoas para dividir a conta.');
    }

    const supabase = getSupabaseClient();
    const mapaPessoas = await listarOuCriarPessoas(pessoas, requestId);

    // Calcula partes: n = pessoas citadas + o usuário.
    const n = pessoas.length + 1;
    const minhaParte = Math.round((total / n) * 100) / 100;
    const parteCadaOutro = Math.round((total - minhaParte) / pessoas.length * 100) / 100;

    // Registra a transação principal (com third_party_share_amount = total - minhaParte).
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
      })
      .select('id')
      .single();

    if (erroTransacao) throw new Error(`Erro ao registrar despesa dividida: ${erroTransacao.message}`);

    // Cria as dívidas individuais para cada outra pessoa.
    const partes: Array<{ nome: string; pessoaId: string; valor: number }> = [];
    const nomesResolvidos = [...mapaPessoas.entries()];

    for (const [nomeNormalizado, pessoaId] of nomesResolvidos) {
      // Pula se for o próprio usuário (não deveria aconteca, mas segurança).
      if (!pessoaId) continue;
      const nomeOriginal = pessoas.find((p) => p.trim().toLowerCase() === nomeNormalizado);
      if (!nomeOriginal) continue;

      const { error: erroDivida } = await supabase
        .from('transactions')
        .insert({
          description: `${descricao.trim()} (parte de ${nomeOriginal})`,
          total_amount: parteCadaOutro,
          category_id: categoryId,
          payment_method: paymentMethod,
          occurred_at: ocorreuEm,
          my_share_amount: parteCadaOutro,
          third_party_id: pessoaId,
          third_party_share_amount: parteCadaOutro,
        });

      if (erroDivida) throw new Error(`Erro ao registrar dívida de ${nomeOriginal}: ${erroDivida.message}`);

      partes.push({ nome: nomeOriginal, pessoaId, valor: parteCadaOutro });
    }

    log('info', 'Despesa dividida registrada', {
      requestId,
      transactionId: transacao.id,
      total,
      minhaParte,
      partes: partes.length,
    });

    return {
      transactionId: transacao.id as string,
      total,
      minhaParte,
      partes,
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