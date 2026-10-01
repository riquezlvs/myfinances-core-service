import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { creditarSaldo, obterContaPorId } from '../accounts/accountService';
import { obterCategoriaPadrao } from '../categories/categoryCache';

import { cadastrarNovaRecorrencia } from '../recurring/recurringService';

export interface NovaReceitaInput {
  description: string;
  amount: number;
  accountId?: string | null;
  occurredAt?: string | null;
  categoryId?: number | null;
  incomeType?: 'salary' | 'freelance' | 'benefit' | 'other' | null;
  paymentMethod?: 'pix' | 'debit_card' | 'credit_card' | null;
  location?: string | null;
  isRecurring?: boolean;
  dayOfMonth?: number;
  weekendRule?: 'anticipate' | 'postpone' | 'exact';
}

export interface ReceitaRegistrada {
  displayId: number;
  description: string;
  totalAmount: number;
  occurredAt: string;
  entryType: 'income';
  accountName?: string;
  novoSaldo?: number;
}

/**
 * Registra uma receita avulsa ou recorrente diretamente no ledger financeiro.
 * Se a data for hoje ou passada, credita o saldo da conta imediatamente.
 * Se for marcada como recorrente, cadastra também a regra em recurring_transactions.
 */
export async function registrarReceitaAvulsa(
  dados: NovaReceitaInput,
  requestId: string = 'registrar-receita'
): Promise<ReceitaRegistrada> {
  return withTiming('registrar receita avulsa', { requestId, description: dados.description }, async () => {
    const supabase = getSupabaseClient();
    const dataOcorrencia = dados.occurredAt ? new Date(dados.occurredAt) : new Date();
    const agora = new Date();
    const isFutura = dataOcorrencia.getTime() > agora.getTime() + 60000; // 1 min tolerância
    const isRecurring = Boolean(dados.isRecurring);

    // 1. Resolve conta e nome se fornecido
    let accountName: string | undefined;
    if (dados.accountId) {
      const conta = await obterContaPorId(dados.accountId, requestId);
      if (conta) {
        accountName = conta.name;
      }
    }

    // 2. Resolve categoria padrão se não informada
    const categoryId = dados.categoryId ?? (await obterCategoriaPadrao(requestId, 'income'));

    // 3. Insere na tabela transactions
    const { data, error } = await supabase
      .from('transactions')
      .insert({
        description: dados.description,
        total_amount: Math.abs(dados.amount),
        entry_type: 'income',
        occurred_at: dataOcorrencia.toISOString(),
        account_id: dados.accountId || null,
        payment_method: dados.paymentMethod || 'pix',
        category_id: categoryId,
        location: dados.location || null,
        is_recurring: isRecurring,
      })
      .select('display_id, description, total_amount, occurred_at')
      .single();

    if (error) {
      log('error', 'Erro ao salvar transação de receita', { requestId, erro: error.message });
      throw new Error(`Erro ao salvar receita: ${error.message}`);
    }

    // 4. Se for recorrente, registra também a regra permanente em recurring_transactions
    if (isRecurring) {
      const diaNum = dados.dayOfMonth || dataOcorrencia.getUTCDate();
      await cadastrarNovaRecorrencia(
        {
          description: dados.description,
          total_amount: Math.abs(dados.amount),
          day_of_month: diaNum,
          entry_type: 'income',
          account_id: dados.accountId || null,
          category_id: categoryId,
          income_type: dados.incomeType || 'salary',
          weekend_rule: dados.weekendRule || 'anticipate',
        },
        requestId
      ).catch((errRec: any) => {
        log('warn', 'Erro ao salvar regra permanente de receita recorrente', {
          requestId,
          erro: errRec.message,
        });
      });
    }

    let novoSaldo: number | undefined;

    // 3. Se a receita já ocorreu (hoje ou passada) e temos uma conta, credita o saldo
    if (!isFutura && dados.accountId) {
      try {
        novoSaldo = await creditarSaldo(dados.accountId, Math.abs(dados.amount), requestId);
      } catch (errCredit: any) {
        log('warn', 'Erro ao creditar saldo na conta após registrar receita', {
          requestId,
          accountId: dados.accountId,
          erro: errCredit.message,
        });
      }
    }

    log('info', 'Receita registrada com sucesso', {
      requestId,
      displayId: data.display_id,
      valor: data.total_amount,
      isFutura,
    });

    return {
      displayId: data.display_id,
      description: data.description,
      totalAmount: Number(data.total_amount),
      occurredAt: data.occurred_at,
      entryType: 'income',
      accountName,
      novoSaldo,
    };
  });
}
