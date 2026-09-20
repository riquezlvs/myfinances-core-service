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

export interface PessoaComSaldo {
  id: string;
  name: string;
  created_at?: string;
  initials: string;
  saldoDevedor: number;
  totalOriginal: number;
  totalPago: number;
  status: 'Em aberto' | 'Zerado';
  itensInclusos?: Array<{
    displayId?: number;
    description: string;
    amount: number;
    occurredAt?: string;
  }>;
}

export async function listarPessoasComSaldos(
  busca?: string,
  requestId?: string,
  mesAno?: string
): Promise<PessoaComSaldo[]> {
  const reqId = requestId || 'req-people-list';
  return withTiming('listar pessoas com saldos', { requestId: reqId, busca, mesAno }, async () => {
    const supabase = getSupabaseClient();

    // 1. Busca todas as pessoas cadastradas
    let query = supabase.from('people').select('id, name, created_at').order('name', { ascending: true });
    if (busca && busca.trim()) {
      query = query.ilike('name', `%${busca.trim()}%`);
    }
    const { data: pessoas, error: erroPessoas } = await query;
    if (erroPessoas) throw new Error(`Erro ao buscar pessoas: ${erroPessoas.message}`);

    if (!pessoas || pessoas.length === 0) {
      return [];
    }

    // 2. Busca todas as transações com dívida/split
    let queryDividas = supabase
      .from('transactions')
      .select('display_id, description, third_party_id, third_party_share_amount, occurred_at')
      .gt('third_party_share_amount', 0)
      .order('occurred_at', { ascending: false });

    const { data: transacoesDividas, error: erroDividas } = await queryDividas;
    if (erroDividas) throw new Error(`Erro ao buscar dívidas: ${erroDividas.message}`);

    // 3. Busca todos os pagamentos de dívidas
    const { data: pagamentos, error: erroPagamentos } = await supabase
      .from('debt_payments')
      .select('person_id, amount, paid_at, created_at');

    if (erroPagamentos) throw new Error(`Erro ao buscar pagamentos de dívidas: ${erroPagamentos.message}`);

    // Agrupa pagamentos por person_id (total e filtrado se houver mesAno)
    const pagamentosPorId = new Map<string, number>();
    for (const p of pagamentos ?? []) {
      const atual = pagamentosPorId.get(p.person_id) ?? 0;
      pagamentosPorId.set(p.person_id, atual + Number(p.amount));
    }

    // Agrupa transações por third_party_id
    const dividasPorId = new Map<string, any[]>();
    for (const d of transacoesDividas ?? []) {
      if (!d.third_party_id) continue;
      const lista = dividasPorId.get(d.third_party_id) ?? [];
      lista.push(d);
      dividasPorId.set(d.third_party_id, lista);
    }

    // Monta resposta com cálculo de saldo para cada pessoa
    return pessoas.map((p: any) => {
      const todasDividas = dividasPorId.get(p.id) ?? [];
      
      // Se mesAno informado (ex: "2026-09"), filtra itens cujo occurred_at comece com mesAno
      const dividasFiltradas = mesAno
        ? todasDividas.filter((d: any) => d.occurred_at && d.occurred_at.startsWith(mesAno))
        : todasDividas;

      const totalOriginal = todasDividas.reduce(
        (acc: number, curr: any) => acc + Number(curr.third_party_share_amount || 0),
        0
      );
      const totalMesOriginal = dividasFiltradas.reduce(
        (acc: number, curr: any) => acc + Number(curr.third_party_share_amount || 0),
        0
      );

      const totalPago = pagamentosPorId.get(p.id) ?? 0;
      const saldoDevedor = Math.max(0, Math.round((totalOriginal - totalPago) * 100) / 100);

      // Iniciais para o avatar
      const nomes = (p.name || '').trim().split(/\s+/);
      let initials = 'P';
      if (nomes.length === 1 && nomes[0]) {
        initials = nomes[0].slice(0, 2).toUpperCase();
      } else if (nomes.length > 1) {
        initials = (nomes[0][0] + nomes[nomes.length - 1][0]).toUpperCase();
      }

      const itensInclusos = (mesAno ? dividasFiltradas : todasDividas).map((d: any) => ({
        displayId: d.display_id,
        description: d.description,
        amount: Number(d.third_party_share_amount || 0),
        occurredAt: d.occurred_at,
      }));

      return {
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        initials,
        saldoDevedor,
        totalOriginal: mesAno ? totalMesOriginal : totalOriginal,
        totalPago,
        status: saldoDevedor > 0 ? ('Em aberto' as const) : ('Zerado' as const),
        itensInclusos,
      };
    });
  });
}

export async function cadastrarNovaPessoa(
  nome: string,
  requestId?: string
): Promise<{ id: string; name: string }> {
  const reqId = requestId || 'req-create-person';
  return withTiming('cadastrar nova pessoa', { requestId: reqId, nome }, async () => {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo) throw new Error('O nome da pessoa é obrigatório.');
    if (nomeLimpo.length > 60) throw new Error('O nome não pode exceder 60 caracteres.');

    const supabase = getSupabaseClient();
    const id = await resolveThirdPartyId(nomeLimpo, reqId);
    return { id, name: nomeLimpo };
  });
}