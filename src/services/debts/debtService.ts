import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { buscarPessoaId } from '../people/peopleService';
import { formatarReal } from '../../utils/formatters';
import type { SaldoTerceiro, ResultadoPagamento } from '../../types/transaction';

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