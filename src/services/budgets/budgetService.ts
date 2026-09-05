import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { getCategoryMap } from '../categories/categoryCache';

/**
 * Fase 6 — Orçamento por categoria: define/lista/remove metas mensais e
 * verifica o status de consumo ao registrar novos gastos (alertas em 80% e 100%).
 */

export type NivelMeta = 'ok' | 'aviso80' | 'limite100';

export interface StatusMeta {
  categoria: string;
  gastoAtual: number;
  limite: number;
  percentual: number;
  nivel: NivelMeta;
}

interface BudgetRow {
  monthly_limit: number;
  categories: { name: string } | null;
}

/** Normaliza para comparação sem acentos ("alimentacao" === "Alimentação"). */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function classificarNivel(gastoAtual: number, limite: number): NivelMeta {
  if (gastoAtual >= limite) return 'limite100';
  if (gastoAtual >= limite * 0.8) return 'aviso80';
  return 'ok';
}

/** Soma os gastos do mês corrente de uma categoria. */
async function somarGastoDoMes(categoryId: number, requestId: string): Promise<number> {
  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
  const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

  const { data, error } = await getSupabaseClient()
    .from('transactions')
    .select('total_amount')
    .eq('category_id', categoryId)
    .gte('occurred_at', primeiroDia)
    .lt('occurred_at', primeiroDiaProxMes);

  if (error) throw new Error(`Erro ao somar gastos da categoria: ${error.message}`);
  return (data ?? []).reduce((soma, t) => soma + Number((t as any).total_amount), 0);
}

/**
 * Verifica o status da meta da categoria de um gasto recém-registrado.
 * Retorna null se a categoria não tem meta definida. Best-effort: erros
 * de consulta são logados mas não derrubam o fluxo de registro.
 */
export async function verificarMeta(categoryId: number, requestId: string): Promise<StatusMeta | null> {
  try {
    return await withTiming('verificar meta da categoria', { requestId, categoryId }, async () => {
      // Otimização de latência: meta e soma do mês rodam em paralelo
      // (latência = max das duas, em vez da soma sequencial).
      const [metaResult, gastoAtual] = await Promise.all([
        getSupabaseClient()
          .from('budgets')
          .select('monthly_limit, categories(name)')
          .eq('category_id', categoryId)
          .maybeSingle(),
        somarGastoDoMes(categoryId, requestId),
      ]);

      const { data, error } = metaResult;
      if (error) throw new Error(`Erro ao buscar meta: ${error.message}`);
      if (!data) return null;

      const row = data as unknown as BudgetRow;
      const limite = Number(row.monthly_limit);
      const percentual = limite > 0 ? (gastoAtual / limite) * 100 : 0;

      return {
        categoria: row.categories?.name ?? 'Outros',
        gastoAtual,
        limite,
        percentual,
        nivel: classificarNivel(gastoAtual, limite),
      };
    });
  } catch (err) {
    log('warn', 'Falha ao verificar meta (alerta ignorado)', {
      requestId,
      categoryId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Define (ou atualiza) a meta mensal de uma categoria pelo nome. */
export async function definirMeta(
  nomeCategoria: string,
  limite: number,
  requestId: string
): Promise<{ categoria: string; limite: number } | null> {
  return withTiming('definir meta', { requestId, nomeCategoria, limite }, async () => {
    const categoryMap = await getCategoryMap(requestId);
    const entrada = Object.entries(categoryMap).find(
      ([, nome]) => normalizar(nome) === normalizar(nomeCategoria)
    );
    if (!entrada) return null;

    const categoryId = Number(entrada[0]);
    const { error } = await getSupabaseClient()
      .from('budgets')
      .upsert({ category_id: categoryId, monthly_limit: limite }, { onConflict: 'category_id' });

    if (error) throw new Error(`Erro ao salvar meta: ${error.message}`);
    return { categoria: entrada[1], limite };
  });
}

/** Lista todas as metas com o consumo atual do mês (ordenado por % usada). */
export async function listarMetas(requestId: string): Promise<StatusMeta[]> {
  return withTiming('listar metas', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const primeiroDiaProxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString();

    const { data: budgets, error } = await getSupabaseClient()
      .from('budgets')
      .select('monthly_limit, categories(name)')
      .order('monthly_limit', { ascending: false });

    if (error) throw new Error(`Erro ao listar metas: ${error.message}`);

    const { data: gastos, error: erroGastos } = await getSupabaseClient()
      .from('transactions')
      .select('category_id, total_amount')
      .gte('occurred_at', primeiroDia)
      .lt('occurred_at', primeiroDiaProxMes);

    if (erroGastos) throw new Error(`Erro ao somar gastos do mês: ${erroGastos.message}`);

    const categoryMap = await getCategoryMap(requestId);
    const gastoPorCategoria = new Map<number, number>();
    for (const g of (gastos ?? []) as any[]) {
      gastoPorCategoria.set(
        Number(g.category_id),
        (gastoPorCategoria.get(Number(g.category_id)) ?? 0) + Number(g.total_amount)
      );
    }

    return (budgets ?? [])
      .map((b: any) => {
        const limite = Number(b.monthly_limit);
        const nome = b.categories?.name ?? 'Outros';
        const categoryId = Number(
          Object.entries(categoryMap).find(([, n]) => n === nome)?.[0] ?? 0
        );
        const gastoAtual = gastoPorCategoria.get(categoryId) ?? 0;
        return {
          categoria: nome,
          gastoAtual,
          limite,
          percentual: limite > 0 ? (gastoAtual / limite) * 100 : 0,
          nivel: classificarNivel(gastoAtual, limite),
        } satisfies StatusMeta;
      })
      .sort((a, b) => b.percentual - a.percentual);
  });
}

/** Remove a meta de uma categoria pelo nome. Retorna a categoria removida ou null. */
export async function removerMeta(
  nomeCategoria: string,
  requestId: string
): Promise<string | null> {
  return withTiming('remover meta', { requestId, nomeCategoria }, async () => {
    const categoryMap = await getCategoryMap(requestId);
    const entrada = Object.entries(categoryMap).find(
      ([, nome]) => normalizar(nome) === normalizar(nomeCategoria)
    );
    if (!entrada) return null;

    const { error } = await getSupabaseClient()
      .from('budgets')
      .delete()
      .eq('category_id', Number(entrada[0]));

    if (error) throw new Error(`Erro ao remover meta: ${error.message}`);
    return entrada[1];
  });
}