import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import type { YieldCalculationResult } from '../../types/investment';
import type { Account } from '../../types/account';

/**
 * Tabela regressiva de IR para Renda Fixa (Brasil).
 */
export function obterAliquotaIr(diasCorridos: number): number {
  if (diasCorridos <= 180) return 0.225; // 22,5%
  if (diasCorridos <= 360) return 0.20;  // 20%
  if (diasCorridos <= 720) return 0.175; // 17,5%
  return 0.15;                          // 15%
}

/**
 * Tabela regressiva de IOF para os primeiros 29 dias.
 */
const TABELA_IOF = [
  0.96, 0.93, 0.90, 0.86, 0.83, 0.80, 0.76, 0.73, 0.70, 0.66,
  0.63, 0.60, 0.56, 0.53, 0.50, 0.46, 0.43, 0.40, 0.36, 0.33,
  0.30, 0.26, 0.23, 0.20, 0.16, 0.13, 0.10, 0.06, 0.03, 0.00
];

export function obterAliquotaIof(diasCorridos: number): number {
  if (diasCorridos <= 0) return 0.96;
  if (diasCorridos <= 29) return TABELA_IOF[diasCorridos - 1] ?? 0;
  return 0;
}

/**
 * Calcula quantidade de dias úteis (desconsidera sábados e domingos).
 */
export function calcularDiasUteis(inicio: Date, fim: Date): number {
  let dias = 0;
  const atual = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const dataFinal = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());

  while (atual < dataFinal) {
    atual.setDate(atual.getDate() + 1);
    const diaSemana = atual.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) {
      dias++;
    }
  }
  return dias;
}

/**
 * Busca a última taxa CDI diária oficial na API do Banco Central (SGS Série 12).
 * Retorna o valor em decimal por dia útil (ex: 0.0401% -> 0.000401).
 * Fallback: 10.40% a.a. / 252 dias úteis (~0.000392).
 */
export async function obterTaxaCdiDiaria(requestId: string = 'bacen-cdi'): Promise<number> {
  return withTiming('buscar taxa CDI no Bacen', { requestId }, async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json',
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const dados = (await res.json()) as Array<{ data: string; valor: string }>;
        if (dados.length > 0 && dados[0].valor) {
          const taxaPct = parseFloat(dados[0].valor);
          if (!isNaN(taxaPct) && taxaPct > 0) {
            log('info', 'Taxa CDI diária obtida do Bacen', { requestId, data: dados[0].data, taxaPct });
            return taxaPct / 100;
          }
        }
      }
    } catch (err: any) {
      log('warn', 'Falha ao buscar taxa CDI no Bacen, aplicando taxa fallback', {
        requestId,
        motivo: err.message,
      });
    }

    // Fallback: CDI anual ~10.40% -> (1 + 0.1040)^(1/252) - 1 ≈ 0.000392
    return 0.000392;
  });
}

/**
 * Calcula os rendimentos de uma Caixinha/CDB com taxa indexada ao CDI.
 * Ex: Nubank 115% CDI sobre saldo.
 */
export function calcularRendimentoCdi(
  saldo: number,
  cdiRatePct: number, // Ex: 115 para 115% do CDI
  dataInicio: Date,
  dataFim: Date = new Date(),
  taxaDiDiaria: number = 0.000392
): YieldCalculationResult {
  const diasUteis = Math.max(1, calcularDiasUteis(dataInicio, dataFim));
  const diffMs = dataFim.getTime() - dataInicio.getTime();
  const diasCorridos = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  // Taxa efetiva do período com juros compostos:
  // (1 + (taxaDiDiaria * (cdiRatePct / 100)))^diasUteis - 1
  const taxaDiariaAjustada = taxaDiDiaria * (cdiRatePct / 100);
  const fatorRendimento = Math.pow(1 + taxaDiariaAjustada, diasUteis) - 1;

  const grossAmount = Math.round(saldo * fatorRendimento * 100) / 100;

  // Dedução de IOF (se resgatado antes de 30 dias)
  const aliquotaIof = obterAliquotaIof(diasCorridos);
  const valorIof = Math.round(grossAmount * aliquotaIof * 100) / 100;
  const baseCalculoIr = Math.max(0, grossAmount - valorIof);

  // Dedução de IR regressivo
  const aliquotaIr = obterAliquotaIr(diasCorridos);
  const valorIr = Math.round(baseCalculoIr * aliquotaIr * 100) / 100;

  const totalImpostos = Math.round((valorIof + valorIr) * 100) / 100;
  const netAmount = Math.max(0, Math.round((grossAmount - totalImpostos) * 100) / 100);

  return {
    grossAmount,
    taxAmount: totalImpostos,
    netAmount,
    effectiveRatePct: Math.round(fatorRendimento * 10000) / 100,
    daysPassed: diasCorridos,
    taxRatePct: Math.round(aliquotaIr * 1000) / 10,
  };
}

/**
 * Atualiza automaticamente os rendimentos de todas as caixinhas ativas.
 */
export async function atualizarRendimentosCaixinhas(
  requestId: string
): Promise<Array<{ accountId: string; accountName: string; rendimentoBruto: number; imposto: number; rendimentoLiquido: number }>> {
  return withTiming('atualizar rendimentos caixinhas', { requestId }, async () => {
    const supabase = getSupabaseClient();
    const { data: contas, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('type', 'fixed_income')
      .eq('is_active', true)
      .gt('balance', 0);

    if (error) throw new Error(`Erro ao buscar caixinhas: ${error.message}`);
    if (!contas || contas.length === 0) return [];

    const taxaDiDiaria = await obterTaxaCdiDiaria(requestId);
    const resultados = [];

    for (const rawConta of contas) {
      const conta = rawConta as unknown as Account;
      const cdiRate = Number(conta.cdi_rate) || 100;
      const dataInicio = conta.start_date ? new Date(conta.start_date) : new Date(Date.now() - 30 * 86400000);
      const saldo = Number(conta.balance);

      const rendimento = calcularRendimentoCdi(saldo, cdiRate, dataInicio, new Date(), taxaDiDiaria);

      if (rendimento.grossAmount > 0) {
        const novoSaldo = Math.round((saldo + rendimento.netAmount) * 100) / 100;

        // Atualiza saldo da conta
        await supabase
          .from('accounts')
          .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
          .eq('id', conta.id);

        // Registra transação de rendimento
        await supabase.from('transactions').insert({
          description: `Rendimento ${conta.name} (${cdiRate}% CDI)`,
          total_amount: rendimento.netAmount,
          gross_amount: rendimento.grossAmount,
          tax_amount: rendimento.taxAmount,
          entry_type: 'yield',
          account_id: conta.id,
          category_id: 1, // Geral
          payment_method: 'pix',
          occurred_at: new Date().toISOString(),
        });

        resultados.push({
          accountId: conta.id,
          accountName: conta.name,
          rendimentoBruto: rendimento.grossAmount,
          imposto: rendimento.taxAmount,
          rendimentoLiquido: rendimento.netAmount,
        });
      }
    }

    log('info', 'Rendimentos de caixinhas atualizados com sucesso', {
      requestId,
      totalProcessadas: resultados.length,
    });

    return resultados;
  });
}
