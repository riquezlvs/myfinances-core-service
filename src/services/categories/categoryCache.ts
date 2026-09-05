import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { CATEGORY_CACHE_TTL_MS } from '../../config/constants';

let cache: Record<number, string> | null = null;
let cachedAt = 0;

/** Cache em memória das categorias (objetivo 3) — evita bater no Supabase a cada mensagem. */
export async function getCategoryMap(requestId: string): Promise<Record<number, string>> {
  const agora = Date.now();
  if (cache && agora - cachedAt < CATEGORY_CACHE_TTL_MS) {
    return cache;
  }

  return withTiming('carregar categorias (cache miss)', { requestId }, async () => {
    const { data, error } = await getSupabaseClient().from('categories').select('id, name');
    if (error) throw new Error(`Erro ao buscar categorias: ${error.message}`);

    const novoCache = Object.fromEntries((data ?? []).map((c) => [c.id, c.name]));
    cache = novoCache;
    cachedAt = agora;
    log('info', 'Cache de categorias atualizado', { requestId, qtd: data?.length ?? 0 });
    return novoCache;
  });
}

export function invalidateCategoryCache(): void {
  cache = null;
}