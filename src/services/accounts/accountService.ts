import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import type { Account, AccountType, SafeToSpendSummary } from '../../types/account';
import type { PaymentMethod } from '../../types/transaction';
import { listarCartoes, calcularPeriodoFatura, getFaturaDoPeriodo } from '../cards/cardService';

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
  return novoSaldo;
}

/**
 * Calcula o Safe-to-Spend (Saldo Real vs Saldo Livre).
 * Saldo Livre = Saldo da Conta Corrente Principal - Total das Faturas Abertas no Crédito.
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

    for (const c of cartoesCredito) {
      const periodo = calcularPeriodoFatura(c.closing_day);
      const incluirSemCartao = c.id === primeiroCreditoId;
      const itens = await getFaturaDoPeriodo(c.id, periodo, incluirSemCartao, requestId);
      const totalCartao = itens.reduce((s, i) => s + Number(i.total_amount), 0);
      totalFaturasAbertas += totalCartao;
    }

    totalFaturasAbertas = Math.round(totalFaturasAbertas * 100) / 100;
    const safeToSpend = Math.round((realBalance - totalFaturasAbertas) * 100) / 100;

    return {
      accountName,
      realBalance,
      openCreditInvoices: totalFaturasAbertas,
      safeToSpend,
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
