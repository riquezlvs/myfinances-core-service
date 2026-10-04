import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import type { Account, AccountType, SafeToSpendSummary, ConsolidatedPositionSummary, ProjectedIncomeItem } from '../../types/account';
import type { PaymentMethod } from '../../types/transaction';
import { listarCartoes, calcularPeriodoFatura, getFaturaDoPeriodo } from '../cards/cardService';
import { obterRendasPrevistasNoPeriodo } from '../recurring/recurringService';

/**
 * Lista todas as contas ativas do usuário.
 */
export async function listarContas(requestId: string): Promise<Account[]> {
  return withTiming('listar contas', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('accounts')
      .select('*')
      .eq('is_active', true)
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw new Error(`Erro ao listar contas: ${error.message}`);
    return (data ?? []) as unknown as Account[];
  });
}

/**
 * Busca uma conta por ID.
 */
export async function obterContaPorId(id: string, requestId: string): Promise<Account | null> {
  const { data, error } = await getSupabaseClient()
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar conta por ID: ${error.message}`);
  return (data as unknown as Account) ?? null;
}

/**
 * Busca uma conta por nome (case insensitive).
 */
export async function obterContaPorNome(nome: string, requestId: string): Promise<Account | null> {
  const { data, error } = await getSupabaseClient()
    .from('accounts')
    .select('*')
    .ilike('name', nome.trim())
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar conta por nome: ${error.message}`);
  return (data as unknown as Account) ?? null;
}

/**
 * Cria ou atualiza uma conta (upsert pelo nome).
 */
export async function criarOuAtualizarConta(
  conta: {
    name: string;
    type: AccountType;
    balance?: number;
    cdi_rate?: number | null;
    start_date?: string | null;
    card_id?: string | null;
  },
  requestId: string
): Promise<Account> {
  return withTiming('criar ou atualizar conta', { requestId, nome: conta.name, tipo: conta.type }, async () => {
    const payload: any = {
      name: conta.name.trim(),
      type: conta.type,
      updated_at: new Date().toISOString(),
    };
    if (conta.balance !== undefined) payload.balance = conta.balance;
    if (conta.cdi_rate !== undefined) payload.cdi_rate = conta.cdi_rate;
    if (conta.start_date !== undefined) payload.start_date = conta.start_date;
    if (conta.card_id !== undefined) payload.card_id = conta.card_id;

    const { data, error } = await getSupabaseClient()
      .from('accounts')
      .upsert(payload, { onConflict: 'name' })
      .select('*')
      .single();

    if (error) throw new Error(`Erro ao salvar conta: ${error.message}`);
    return data as unknown as Account;
  });
}

/**
 * Ajusta o saldo de uma conta diretamente (conciliação / saldo inicial).
 */
export async function ajustarSaldo(
  nomeOuId: string,
  novoSaldo: number,
  requestId: string
): Promise<Account> {
  return withTiming('ajustar saldo da conta', { requestId, nomeOuId, novoSaldo }, async () => {
    const supabase = getSupabaseClient();
    let conta = await obterContaPorNome(nomeOuId, requestId);
    if (!conta) {
      conta = await obterContaPorId(nomeOuId, requestId);
    }
    if (!conta) {
      throw new Error(`Conta "${nomeOuId}" não encontrada.`);
    }

    const { data, error } = await supabase
      .from('accounts')
      .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
      .eq('id', conta.id)
      .select('*')
      .single();

    if (error) throw new Error(`Erro ao ajustar saldo: ${error.message}`);
    if (conta.type === 'fixed_income') {
      await sincronizarAtivoComConta(conta.id, novoSaldo, requestId);
    }
    log('info', 'Saldo de conta ajustado com sucesso', {
      requestId,
      conta: conta.name,
      saldoAnterior: conta.balance,
      novoSaldo,
    });
    return data as unknown as Account;
  });
}

/**
 * Sincroniza eventuais registros espelho de ativos em investment_assets
 * quando o saldo de uma conta de renda fixa/caixinha é alterado.
 */
export async function sincronizarAtivoComConta(
  accountId: string,
  novoSaldo: number,
  requestId: string
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: ativos, error } = await supabase
      .from('investment_assets')
      .select('id, ticker, asset_type, quantity, average_price')
      .eq('account_id', accountId);

    if (error || !ativos || ativos.length === 0) return;

    for (const a of ativos) {
      if (a.asset_type === 'other' || Number(a.quantity) === 1) {
        if (novoSaldo > 0) {
          await supabase
            .from('investment_assets')
            .update({
              average_price: novoSaldo,
              updated_at: new Date().toISOString(),
            })
            .eq('id', a.id);
        } else {
          await supabase
            .from('investment_assets')
            .delete()
            .eq('id', a.id);
        }
      }
    }
  } catch (err: any) {
    log('warn', 'Aviso ao sincronizar investment_assets com saldo da conta', {
      requestId,
      accountId,
      erro: err.message,
    });
  }
}

/**
 * Credita um valor no saldo da conta.
 */
export async function creditarSaldo(accountId: string, valor: number, requestId: string): Promise<number> {
  const conta = await obterContaPorId(accountId, requestId);
  if (!conta) throw new Error(`Conta com ID ${accountId} não encontrada.`);
  const novoSaldo = Math.round((Number(conta.balance) + valor) * 100) / 100;

  const { error } = await getSupabaseClient()
    .from('accounts')
    .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
    .eq('id', accountId);

  if (error) throw new Error(`Erro ao creditar saldo: ${error.message}`);
  if (conta.type === 'fixed_income') {
    await sincronizarAtivoComConta(accountId, novoSaldo, requestId);
  }
  return novoSaldo;
}

/**
 * Debita um valor do saldo da conta.
 */
export async function debitarSaldo(accountId: string, valor: number, requestId: string): Promise<number> {
  const conta = await obterContaPorId(accountId, requestId);
  if (!conta) throw new Error(`Conta com ID ${accountId} não encontrada.`);
  const novoSaldo = Math.round((Number(conta.balance) - valor) * 100) / 100;

  const { error } = await getSupabaseClient()
    .from('accounts')
    .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
    .eq('id', accountId);

  if (error) throw new Error(`Erro ao debitar saldo: ${error.message}`);
  if (conta.type === 'fixed_income') {
    await sincronizarAtivoComConta(accountId, novoSaldo, requestId);
  }
  return novoSaldo;
}

/**
 * Calcula o Safe-to-Spend dinâmico e projetado até o fechamento da fatura.
 * Resolve o problema de aparecer negativado quando a pessoa tem entradas certas
 * (como salário ou freela) antes do dia do fechamento do cartão.
 */
export async function calcularSafeToSpend(
  contaNomeOuId?: string,
  requestId: string = 'safe-to-spend'
): Promise<SafeToSpendSummary> {
  return withTiming('calcular safe-to-spend', { requestId, contaNomeOuId }, async () => {
    let conta: Account | null = null;
    if (contaNomeOuId) {
      conta = (await obterContaPorNome(contaNomeOuId, requestId)) ?? (await obterContaPorId(contaNomeOuId, requestId));
    }
    if (!conta) {
      const contas = await listarContas(requestId);
      conta = contas.find((c) => c.type === 'checking') ?? contas[0] ?? null;
    }

    const realBalance = conta ? Number(conta.balance) : 0;
    const accountName = conta ? conta.name : 'Conta Principal';

    // Calcula faturas abertas de cartões de crédito
    const cartoes = await listarCartoes(requestId);
    const cartoesCredito = cartoes.filter((c) => c.card_type === 'credit');

    let totalFaturasAbertas = 0;
    const primeiroCreditoId = cartoesCredito[0]?.id;
    let targetClosingDay = cartoesCredito[0]?.closing_day ?? 25;
    let targetClosingDateObj: Date = new Date();

    const hoje = new Date();

    // Encontra o próximo fechamento relevante
    let menorDistanciaDias = Infinity;

    for (const c of cartoesCredito) {
      const periodo = calcularPeriodoFatura(c.closing_day, hoje);
      const incluirSemCartao = c.id === primeiroCreditoId;
      const itens = await getFaturaDoPeriodo(c.id, periodo, incluirSemCartao, requestId);
      const totalCartao = itens.reduce((s, i) => s + Number(i.total_amount), 0);
      totalFaturasAbertas += totalCartao;

      // Calcula dias até o fechamento
      const diffMs = periodo.fechamento.getTime() - hoje.getTime();
      const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDias >= 0 && diffDias < menorDistanciaDias) {
        menorDistanciaDias = diffDias;
        targetClosingDay = c.closing_day;
        targetClosingDateObj = periodo.fechamento;
      }
    }

    totalFaturasAbertas = Math.round(totalFaturasAbertas * 100) / 100;
    const safeToSpend = Math.round((realBalance - totalFaturasAbertas) * 100) / 100;

    // Busca entradas certas e recorrentes programadas entre HOJE e a data de fechamento da fatura
    let projectedIncomes = 0;
    const projectedIncomesList: ProjectedIncomeItem[] = [];

    try {
      const rendasNoPeriodo = await obterRendasPrevistasNoPeriodo(hoje, targetClosingDateObj, requestId);
      for (const r of rendasNoPeriodo) {
        projectedIncomes += r.amount;
        projectedIncomesList.push({
          id: r.id,
          description: r.description,
          amount: r.amount,
          expectedDate: r.dataEfetivaFormatada,
          incomeType: r.income_type,
        });
      }

      // Também busca transações avulsas agendadas (entry_type = 'income' com data futura até o fechamento)
      const { data: transacoesFuturas } = await getSupabaseClient()
        .from('transactions')
        .select('id, description, total_amount, occurred_at')
        .eq('entry_type', 'income')
        .gt('occurred_at', hoje.toISOString())
        .lte('occurred_at', targetClosingDateObj.toISOString());

      if (transacoesFuturas && transacoesFuturas.length > 0) {
        for (const tf of transacoesFuturas) {
          const val = Number(tf.total_amount);
          projectedIncomes += val;
          projectedIncomesList.push({
            id: tf.id,
            description: tf.description,
            amount: val,
            expectedDate: String(tf.occurred_at).slice(0, 10),
            incomeType: 'freelance',
          });
        }
      }
    } catch (errPrev: any) {
      log('warn', 'Aviso ao calcular rendas previstas para o fechamento', { requestId, erro: errPrev.message });
    }

    projectedIncomes = Math.round(projectedIncomes * 100) / 100;
    // O Saldo Projetado no Fechamento = Saldo Real Atual + Entradas Previstas antes do Fechamento - Faturas
    const projectedSafeToSpend = Math.round((realBalance + projectedIncomes - totalFaturasAbertas) * 100) / 100;

    const coverageStatus: 'positive' | 'warning' | 'negative' =
      projectedSafeToSpend > 0 ? 'positive' : projectedSafeToSpend === 0 ? 'warning' : 'negative';

    const targetDateFormatted = `${String(targetClosingDateObj.getDate()).padStart(2, '0')}/${String(
      targetClosingDateObj.getMonth() + 1
    ).padStart(2, '0')}`;

    const explanationText =
      projectedIncomes > 0
        ? `R$ ${realBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em conta + R$ ${projectedIncomes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a receber antes do fechamento (dia ${targetClosingDay}) - R$ ${totalFaturasAbertas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de faturas = R$ ${projectedSafeToSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} projetado livre.`
        : undefined;

    return {
      accountName,
      realBalance,
      openCreditInvoices: totalFaturasAbertas,
      safeToSpend,
      projectedSafeToSpend,
      projectedIncomes,
      projectedIncomesList,
      targetClosingDay,
      targetClosingDate: targetDateFormatted,
      coverageStatus,
      explanationText,
    };
  });
}

/**
 * Posição consolidada do titular:
 * Unifica todas as contas de liquidez (checking) e todas as faturas abertas de cartões,
 * demonstrando que é a mesma pessoa e a mesma responsabilidade financeira.
 */
export async function obterPosicaoConsolidadaTitular(
  requestId: string = 'posicao-consolidada'
): Promise<ConsolidatedPositionSummary> {
  return withTiming('obter posicao consolidada titular', { requestId }, async () => {
    const contas = await listarContas(requestId);
    const contasLiquidas = contas.filter((c) => c.type === 'checking');
    const totalLiquidBalance = contasLiquidas.reduce((s, c) => s + Number(c.balance), 0);

    const cartoes = await listarCartoes(requestId);
    const cartoesCredito = cartoes.filter((c) => c.card_type === 'credit');

    let totalOpenCreditInvoices = 0;
    const cardsDetalhados: Array<{
      id: string;
      name: string;
      closing_day: number;
      due_day?: number;
      faturaAtual: number;
    }> = [];

    const hoje = new Date();
    let maxFechamento = hoje;

    for (const c of cartoesCredito) {
      const periodo = calcularPeriodoFatura(c.closing_day, hoje);
      if (periodo.fechamento > maxFechamento) {
        maxFechamento = periodo.fechamento;
      }
      const itens = await getFaturaDoPeriodo(c.id, periodo, false, requestId);
      const faturaAtual = Math.round(itens.reduce((s, i) => s + Number(i.total_amount), 0) * 100) / 100;
      totalOpenCreditInvoices += faturaAtual;

      cardsDetalhados.push({
        id: c.id,
        name: c.name,
        closing_day: c.closing_day,
        due_day: c.due_day ?? undefined,
        faturaAtual,
      });
    }

    let projectedIncomesUntilClosing = 0;
    try {
      const rendas = await obterRendasPrevistasNoPeriodo(hoje, maxFechamento, requestId);
      projectedIncomesUntilClosing = rendas.reduce((s, r) => s + r.amount, 0);
    } catch {}

    const immediateNetBalance = Math.round((totalLiquidBalance - totalOpenCreditInvoices) * 100) / 100;
    const projectedNetBalance = Math.round((totalLiquidBalance + projectedIncomesUntilClosing - totalOpenCreditInvoices) * 100) / 100;

    return {
      totalLiquidBalance: Math.round(totalLiquidBalance * 100) / 100,
      totalOpenCreditInvoices: Math.round(totalOpenCreditInvoices * 100) / 100,
      immediateNetBalance,
      projectedIncomesUntilClosing: Math.round(projectedIncomesUntilClosing * 100) / 100,
      projectedNetBalance,
      accounts: contasLiquidas.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        balance: Number(c.balance),
      })),
      cards: cardsDetalhados,
    };
  });
}

/**
 * Resolve automaticamente qual conta deve ser afetada por uma transação
 * baseado no método de pagamento, cartão ou nome explicitamente fornecido.
 */
export async function resolverContaParaTransacao(
  paymentMethod: PaymentMethod | null,
  cardId?: string | null,
  accountName?: string | null,
  requestId: string = 'resolver-conta'
): Promise<Account | null> {
  const contas = await listarContas(requestId);
  if (contas.length === 0) return null;

  // 1. Nome explícito citado pelo usuário
  if (accountName) {
    const porNome = contas.find((c) => c.name.toLowerCase().includes(accountName.toLowerCase().trim()));
    if (porNome) return porNome;
  }

  // 2. Vinculado a cartão específico
  if (cardId) {
    const porCartao = contas.find((c) => c.card_id === cardId);
    if (porCartao) return porCartao;
  }

  // 3. Benefício (VR/VA)
  if (paymentMethod === 'meal_voucher' || paymentMethod === 'food_voucher') {
    const contaBeneficio = contas.find((c) => c.type === 'benefit');
    if (contaBeneficio) return contaBeneficio;
  }

  // 4. Débito / PIX -> Conta corrente principal
  if (paymentMethod === 'pix' || paymentMethod === 'debit_card') {
    const contaCorrente = contas.find((c) => c.type === 'checking');
    if (contaCorrente) return contaCorrente;
  }

  // Fallback para primeira conta corrente ou primeira conta existente
  return contas.find((c) => c.type === 'checking') ?? contas[0];
}
