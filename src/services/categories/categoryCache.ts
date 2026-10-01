import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { CATEGORY_CACHE_TTL_MS } from '../../config/constants';

let cache: Record<number, string> | null = null;
let cachedAt = 0;
// Fase de otimização: promise in-flight evita cache stampede — chamadas
// concorrentes em cache miss compartilham UMA query ao Supabase, em vez
// de disparar N consultas idênticas em paralelo.
let inflight: Promise<Record<number, string>> | null = null;

/** Cache em memória das categorias (objetivo 3) — evita bater no Supabase a cada mensagem. */
export async function getCategoryMap(requestId: string): Promise<Record<number, string>> {
  const agora = Date.now();
  if (cache && agora - cachedAt < CATEGORY_CACHE_TTL_MS) {
    return cache;
  }

  // Já existe um carregamento em andamento: aguarda o mesmo resultado.
  if (inflight) return inflight;

  inflight = withTiming('carregar categorias (cache miss)', { requestId }, async () => {
    const { data, error } = await getSupabaseClient().from('categories').select('id, name');
    if (error) throw new Error(`Erro ao buscar categorias: ${error.message}`);

    const novoCache = Object.fromEntries((data ?? []).map((c) => [c.id, c.name]));
    cache = novoCache;
    cachedAt = agora;
    log('info', 'Cache de categorias atualizado', { requestId, qtd: data?.length ?? 0 });
    return novoCache;
  });

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function invalidateCategoryCache(): void {
  cache = null;
  cachedAt = 0;
}

/**
 * Retorna uma categoria padrão adequada quando não especificada.
 * Prioriza categorias semânticas ('Receitas', 'Renda', 'Salário', 'Rendimentos', 'Outros')
 * ou o primeiro ID disponível no catálogo para evitar erros de NOT NULL no banco.
 */
export async function obterCategoriaPadrao(
  requestId: string,
  entryType: 'expense' | 'income' = 'expense'
): Promise<number> {
  try {
    const catMap = await getCategoryMap(requestId);
    const entries = Object.entries(catMap);
    if (entries.length === 0) return 1;

    if (entryType === 'income') {
      const matchReceita = entries.find(([_, name]) =>
        /receita|renda|salário|salario|rendimento|outros/i.test(name)
      );
      if (matchReceita) return Number(matchReceita[0]);
    } else {
      const matchOutros = entries.find(([_, name]) => /outros/i.test(name));
      if (matchOutros) return Number(matchOutros[0]);
    }

    return Number(entries[0][0]);
  } catch {
    return 1;
  }
}