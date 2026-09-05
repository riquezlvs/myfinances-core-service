import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming } from '../../utils/logger';

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