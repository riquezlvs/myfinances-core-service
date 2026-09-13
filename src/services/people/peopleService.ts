import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';

export async function buscarPessoaId(nome: string, requestId: string): Promise<string | null> {
  return withTiming('buscar pessoa (RPC find_person)', { requestId, nome }, async () => {
    const { data, error } = await getSupabaseClient().rpc('find_person', { p_name: nome });
    if (error) throw new Error(`Erro ao buscar pessoa "${nome}": ${error.message}`);
    return (data as string | null) ?? null;
  });
}

export async function resolveThirdPartyId(nome: string, requestId: string): Promise<string> {
  return withTiming('resolver pessoa (RPC get_or_create_person)', { requestId, nome }, async () => {
    const { data, error } = await getSupabaseClient().rpc('get_or_create_person', { p_name: nome });
    if (error || !data) {
      throw new Error(`Erro ao resolver pessoa "${nome}": ${error?.message ?? 'sem retorno da RPC'}`);
    }
    return data as string;
  });
}

/**
 * 8.7 — Resolve várias pessoas em batch: busca pelo nome normalizado e
 * cria as que não existem em uma única operação (INSERT ... ON CONFLICT).
 * Retorna um mapa normalizado → UUID para vincular ao split de contas.
 *
 * SEGURANÇA: nomes são trimados e limitados a 60 caracteres em código.
 * A IA nunca fornece IDs — apenas nomes de pessoas.
 */
export async function listarOuCriarPessoas(
  nomes: string[],
  requestId: string
): Promise<Map<string, string>> {
  return withTiming('listar ou criar pessoas (batch)', { requestId, qtd: nomes.length }, async () => {
    const supabase = getSupabaseClient();
    const distintos = [...new Set(nomes.map((n) => n.trim()).filter(Boolean))];

    if (distintos.length === 0) {
      throw new Error('Nenhuma pessoa informada para o split.');
    }
    for (const nome of distintos) {
      if (nome.length > 60) throw new Error(`Nome de pessoa muito longo: "${nome.slice(0, 20)}..."`);
    }

    // Busca pessoas existentes (case-insensitive).
    const { data: existentes, error: erroBusca } = await supabase
      .from('people')
      .select('id, name')
      .in(
        'name',
        distintos.map((n) => n.toLowerCase())
      );

    if (erroBusca) throw new Error(`Erro ao buscar pessoas: ${erroBusca.message}`);

    const mapa = new Map<string, string>();
    for (const row of (existentes ?? []) as any[]) {
      mapa.set(String(row.name).toLowerCase(), row.id);
    }

    // Cria as que faltam em batch.
    const faltam = distintos.filter((n) => !mapa.has(n.toLowerCase()));
    if (faltam.length > 0) {
      const { data: criados, error: erroInsert } = await supabase
        .from('people')
        .insert(faltam.map((name) => ({ name })))
        .select('id, name');

      if (erroInsert) throw new Error(`Erro ao criar pessoas: ${erroInsert.message}`);
      for (const row of (criados ?? []) as any[]) {
        mapa.set(String(row.name).toLowerCase(), row.id);
      }
    }

    log('info', 'Pessoas resolvidas para split', {
      requestId,
      solicitados: distintos.length,
      criados: faltam.length,
    });

    return mapa;
  });
}