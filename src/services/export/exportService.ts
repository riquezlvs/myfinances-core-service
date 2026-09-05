import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming } from '../../utils/logger';

/**
 * Serviço de exportação de dados em CSV.
 * Gera o CSV em memória (buffer) para envio via bot.sendDocument().
 */

function escapeCsv(valor: unknown): string {
  const str = String(valor ?? '');
  if (/[",\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function linhasParaCsv(header: string[], linhas: unknown[][]): string {
  const todas = [header, ...linhas];
  return todas.map((linha) => linha.map(escapeCsv).join(';')).join('\r\n');
}

export interface LinhaGastoExport {
  display_id: number;
  description: string;
  total_amount: number;
  my_share_amount: number | null;
  payment_method: string;
  occurred_at: string;
  category: string | null;
  is_recurring: boolean;
}

/** Exporta os gastos do mês atual em CSV. */
export async function exportarGastosDoMesCSV(
  requestId: string
): Promise<{ nome: string; buffer: Buffer; linhas: number }> {
  return withTiming('exportar gastos do mês em CSV', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

    const { data, error } = await getSupabaseClient()
      .from('transactions')
      .select(
        'display_id, description, total_amount, my_share_amount, payment_method, occurred_at, is_recurring, categories(name)'
      )
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes)
      .order('occurred_at', { ascending: true });

    if (error) throw new Error(`Erro ao exportar gastos: ${error.message}`);

    const linhas = (data ?? []).map((g: any) => [
      g.display_id,
      g.description,
      Number(g.total_amount).toFixed(2).replace('.', ','),
      g.my_share_amount != null ? Number(g.my_share_amount).toFixed(2).replace('.', ',') : '',
      g.payment_method,
      g.occurred_at,
      g.categories?.name ?? '',
      g.is_recurring ? 'sim' : 'não',
    ]);

    const csv = linhasParaCsv(
      ['ID', 'Descrição', 'Valor Total', 'Minha Parte', 'Método', 'Data', 'Categoria', 'Recorrente'],
      linhas
    );

    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    return {
      nome: `gastos-${ano}-${mes}.csv`,
      buffer: Buffer.from('\uFEFF' + csv, 'utf8'), // BOM para Excel abrir acentos corretamente
      linhas: linhas.length,
    };
  });
}

/** Exporta as dívidas (saldos de terceiros) em CSV. */
export async function exportarDividasCSV(
  requestId: string
): Promise<{ nome: string; buffer: Buffer; linhas: number }> {
  return withTiming('exportar dívidas em CSV', { requestId }, async () => {
    const { data: dividas, error: erroDividas } = await getSupabaseClient()
      .from('transactions')
      .select('third_party_id, third_party_share_amount, people(name)')
      .gt('third_party_share_amount', 0);

    if (erroDividas) throw new Error(`Erro ao exportar dívidas: ${erroDividas.message}`);

    const { data: pagamentos, error: erroPagamentos } = await getSupabaseClient()
      .from('debt_payments')
      .select('person_id, amount');

    if (erroPagamentos) throw new Error(`Erro ao exportar pagamentos: ${erroPagamentos.message}`);

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

    const linhas = Array.from(saldosPorId.values())
      .filter((s) => s.saldo > 0.009)
      .map((s) => [s.nome, s.saldo.toFixed(2).replace('.', ',')]);

    const csv = linhasParaCsv(['Pessoa', 'Saldo Devido'], linhas);

    return {
      nome: 'dividas.csv',
      buffer: Buffer.from('\uFEFF' + csv, 'utf8'),
      linhas: linhas.length,
    };
  });
}
