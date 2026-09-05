import { vi } from 'vitest';

/**
 * Cria um mock do cliente Supabase com os builders/filtros encadeados
 * usados por src/services.
 *
 * Exemplo de uso:
 *   const supabase = createSupabaseMock({
 *     selectData: [{ display_id: 1 }],
 *   });
 */
interface SupabaseMockConfig {
  selectData?: unknown[] | null;
  rpcResults?: Record<string, unknown>;
  error?: { message: string } | null;
}

export function createSupabaseMock(config: SupabaseMockConfig = {}) {
  const fromMock = vi.fn(() => {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };

    builder.then = (onFulfilled?: (v: unknown) => unknown) =>
      Promise.resolve({ data: config.selectData ?? [], error: config.error ?? null }).then(onFulfilled);

    return builder;
  });

  const rpcMock = vi.fn((fn: string) => {
    const resultado = config.rpcResults?.[fn] ?? null;
    return Promise.resolve({ data: resultado, error: config.error ?? null });
  });

  return { from: fromMock, rpc: rpcMock };
}

export type SupabaseClientMock = ReturnType<typeof createSupabaseMock>;