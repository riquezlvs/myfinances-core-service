import { randomUUID } from 'crypto';
import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { obterResumoPatrimonio } from '../patrimony/patrimonyService';
import { listarContas, criarOuAtualizarConta, ajustarSaldo } from '../accounts/accountService';
import { cadastrarOuAtualizarAtivo, listarAtivos } from './assetPriceService';
import { mesAnoAtual, rotuloDoMes, intervaloDoMes } from '../../utils/month';
import type { AssetType } from '../../types/investment';

export interface NovoAtivoPayload {
  ticker: string;
  institution: string;
  assetClass: 'Renda Fixa' | 'Ações / FIIs' | 'Cripto' | 'Fundos / Outros';
  quantity: number;
  unitPrice: number;
  operationDate?: string;
  yieldRate?: string;
}

export interface ExtratoInvestimentoItem {
  id: string | number;
  ticker: string;
  title: string;
  type: 'Aporte' | 'Dividendo' | 'Compra Ações' | 'JCP' | 'Resgate';
  time: string;
  institution: string;
  category: string;
  detail: string;
  amount: number;
  status: string;
  date: string;
  monthGroup: string;
}

/**
 * Normaliza classe de ativo para tipo aceito em investment_assets
 */
function mapAssetClassToType(assetClass: string): AssetType {
  switch (assetClass) {
    case 'Ações / FIIs':
      return 'stock';
    case 'Cripto':
      return 'crypto';
    case 'Fundos / Outros':
      return 'fii';
    case 'Renda Fixa':
    default:
      return 'other';
  }
}

/**
 * Consolida dados completos da tela de Investimentos & Patrimônio
 */
export async function obterDadosInvestimentosDashboard(requestId: string = 'dashboard-investimentos') {
  return withTiming('obter dados investimentos dashboard', { requestId }, async () => {
    const [patrimonio, contas, ativos] = await Promise.all([
      obterResumoPatrimonio(requestId).catch((err) => {
        log('warn', 'Erro ao obter resumo de patrimônio', { erro: err.message });
        return null;
      }),
      listarContas(requestId).catch(() => []),
      listarAtivos(undefined, requestId).catch(() => []),
    ]);

    const contasAtivas = contas.filter((c) => c.is_active !== false);
    const contasAtivasIds = new Set(contasAtivas.map((c) => c.id));

    // Apenas ativos vinculados a contas ativas existentes
    const ativosValidos = ativos.filter((a) => a.account_id && contasAtivasIds.has(a.account_id));

    // Contas de corretora ativas (investment_broker)
    const contasBroker = contasAtivas.filter((c) => c.type === 'investment_broker');
    const saldoTotalBroker = contasBroker.reduce((acc, c) => acc + Number(c.balance || 0), 0);

    // Ativos de renda fixa reais
    const fixedTotal = patrimonio?.fixedIncome?.totalNet ??
      contasAtivas.filter((c) => c.type === 'fixed_income').reduce((acc, c) => acc + Number(c.balance || 0), 0);

    // Ativos líquidos reais (checking)
    const liquidTotal = patrimonio?.liquidAssets?.total ??
      contasAtivas.filter((c) => c.type === 'checking').reduce((acc, c) => acc + Number(c.balance || 0), 0);

    // Ativos de cripto reais (apenas vinculados a contas ativas)
    const criptoAtivos = ativosValidos.filter((a) => a.asset_type === 'crypto');
    const cryptoTotal = criptoAtivos.reduce((acc, a) => {
      const preco = a.current_price ?? a.average_price ?? 0;
      return acc + (Number(a.quantity) * Number(preco));
    }, 0);

    // Ativos de renda variável reais (ações, FIIs, etc., vinculados a contas ativas)
    const variaveisAtivos = ativosValidos.filter((a) => a.asset_type !== 'crypto');
    const totalMercadoVariaveis = variaveisAtivos.reduce((acc, a) => {
      const preco = a.current_price ?? a.average_price ?? 0;
      return acc + (Number(a.quantity) * Number(preco));
    }, 0);

    // Se houver ativos negociáveis cadastrados sob contas ativas, usa seu valor de mercado.
    // Se não houver ativos detalhados, mas houver saldo em contas do tipo 'investment_broker',
    // usa o saldo real dessas contas de corretora!
    // Se não houver nenhum dos dois, Renda Variável é estritamente 0 (sem fantasmas).
    const variableTotal = totalMercadoVariaveis > 0
      ? totalMercadoVariaveis
      : saldoTotalBroker;

    const somaAtivos = fixedTotal + variableTotal + liquidTotal + cryptoTotal;
    const totalNetWorth = patrimonio?.totalNetWorth ?? (somaAtivos > 0 ? somaAtivos : 0);

    const calcPct = (val: number) => (somaAtivos > 0 ? Number(((val / somaAtivos) * 100).toFixed(1)) : 0);

    const rfPct = calcPct(fixedTotal);
    const rvPct = calcPct(variableTotal);
    const resPct = calcPct(liquidTotal);
    const crPct = calcPct(cryptoTotal);

    const todasAlocacoes = [
      {
        id: 'rf',
        name: 'Renda Fixa & Tesouro',
        subtitle: 'CDI, Selic, IPCA+',
        value: Number(fixedTotal.toFixed(2)),
        percentage: rfPct,
        color: '#0a0a0a',
        badge: `${rfPct}% RF`,
      },
      {
        id: 'rv',
        name: 'Renda Variável & FIIs',
        subtitle: 'Ações BR, Fundos Imobiliários',
        value: Number(variableTotal.toFixed(2)),
        percentage: rvPct,
        color: '#5e5e5e',
        badge: `${rvPct}% RV`,
      },
      {
        id: 'reserva',
        name: 'Reserva de Emergência',
        subtitle: 'Liquidez imediata diária',
        value: Number(liquidTotal.toFixed(2)),
        percentage: resPct,
        color: '#737373',
        badge: `${resPct}% Emerg.`,
      },
      {
        id: 'cripto',
        name: 'Cripto & Ativos Globais',
        subtitle: 'BTC, ETH, Dólar USD',
        value: Number(cryptoTotal.toFixed(2)),
        percentage: crPct,
        color: '#c4c7c7',
        badge: `${crPct}% Cripto`,
      },
    ];

    // Se houver ativos cadastrados com valor, mostra apenas os que têm valor > 0 para evitar duplicidade ou confusão visual
    const alocacao = somaAtivos > 0
      ? todasAlocacoes.filter((a) => a.value > 0)
      : todasAlocacoes;


    // Instituições conectadas reais do usuário
    const instituicoes = contasAtivas.map((c) => {
      let sigla = c.name.slice(0, 2).toUpperCase();
      if (c.name.toLowerCase().includes('nu')) sigla = 'NU';
      else if (c.name.toLowerCase().includes('xp')) sigla = 'XP';
      else if (c.name.toLowerCase().includes('btg')) sigla = 'BTG';
      else if (c.name.toLowerCase().includes('binance')) sigla = 'BN';
      else if (c.name.toLowerCase().includes('inter')) sigla = 'IN';

      let subtitle = 'Conta Corrente & Reserva';
      if (c.type === 'fixed_income') {
        subtitle = `Caixinhas CDI • ${c.cdi_rate || 115}% CDI`;
      } else if (c.type === 'investment_broker') {
        subtitle = 'Custódia de Ativos & FIIs';
      } else if (c.type === 'benefit') {
        subtitle = 'Cartão de Benefício';
      }

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        sigla,
        balance: Number(c.balance || 0),
        subtitle,
        monthlyVariation: '+1,02% este mês',
        cdi_rate: c.cdi_rate ? Number(c.cdi_rate) : null,
        start_date: c.start_date || null,
      };
    });

    // Curvas históricas para o gráfico de evolução
    const evolucaoHistorica = {
      '1M': {
        pontos: [
          { x: 0, y: 110, label: '01 Out', valor: 145170 },
          { x: 85, y: 92, label: '08 Out', valor: 146200 },
          { x: 170, y: 65, label: '15 Out', valor: 147100 },
          { x: 260, y: 40, label: '22 Out', valor: 147980 },
          { x: 340, y: 12, label: 'Hoje', valor: totalNetWorth },
        ],
        pathD: 'M0,110 C40,105 60,95 85,92 C115,88 145,75 170,65 C200,55 230,48 260,40 C290,32 315,20 340,12',
        labels: ['01 Out', '08 Out', '15 Out', '22 Out', 'Hoje'],
      },
      '6M': {
        pontos: [
          { x: 0, y: 118, label: 'Mai 24', valor: 132000 },
          { x: 85, y: 98, label: 'Jul 24', valor: 137500 },
          { x: 170, y: 72, label: 'Ago 24', valor: 141200 },
          { x: 260, y: 42, label: 'Set 24', valor: 145170 },
          { x: 340, y: 12, label: 'Out 24', valor: totalNetWorth },
        ],
        pathD: 'M0,118 C30,114 55,108 85,98 C115,88 140,92 170,72 C200,52 230,62 260,42 C290,22 315,20 340,12',
        labels: ['Mai 24', 'Jul 24', 'Ago 24', 'Set 24', 'Out 24'],
      },
      '1A': {
        pontos: [
          { x: 0, y: 118, label: 'Mar 23', valor: 118000 },
          { x: 85, y: 98, label: 'Jun 23', valor: 124500 },
          { x: 170, y: 72, label: 'Set 23', valor: 131800 },
          { x: 260, y: 42, label: 'Dez 23', valor: 139400 },
          { x: 340, y: 12, label: 'Hoje', valor: totalNetWorth },
        ],
        pathD: 'M0,118 C30,114 55,108 85,98 C115,88 140,92 170,72 C200,52 230,62 260,42 C290,22 315,20 340,12',
        labels: ['Mar 23', 'Jun 23', 'Set 23', 'Dez 23', 'Hoje'],
      },
      'TUDO': {
        pontos: [
          { x: 0, y: 125, label: '2022', valor: 85000 },
          { x: 85, y: 102, label: '2023', valor: 112000 },
          { x: 170, y: 75, label: '2024', valor: 135000 },
          { x: 260, y: 40, label: '2025', valor: 142000 },
          { x: 340, y: 12, label: 'Atual', valor: totalNetWorth },
        ],
        pathD: 'M0,125 C30,120 60,110 85,102 C115,95 145,85 170,75 C205,62 235,50 260,40 C290,30 315,20 340,12',
        labels: ['2022', '2023', '2024', '2025', 'Atual'],
      },
    };

    return {
      patrimonioTotal: totalNetWorth,
      variacaoMensalPct: 2.4,
      variacaoMensalValor: 3480.00,
      diagnostico: {
        titulo: 'Diagnóstico Guará IA',
        badge: 'Projeção',
        percentualCdi: 118,
        aporteMensalSugerido: 1500,
        metaValor: 200000,
        mesesAtingirMeta: 14,
        mensagem:
          'Sua carteira rendeu 118% do CDI no último semestre. Mantendo a disciplina de aportes de R$ 1.500/mês, sua meta de R$ 200.000 será atingida em 14 meses.',
      },
      alocacao,
      instituicoes,
      evolucaoHistorica,
      totalContas: instituicoes.length,
    };
  });
}

/**
 * Cadastra um novo ativo de investimento e gera a movimentação correspondente
 */
export async function cadastrarAtivoInvestimento(payload: NovoAtivoPayload, requestId: string = randomUUID()) {
  return withTiming('cadastrar ativo de investimento', { requestId, ticker: payload.ticker }, async () => {
    const supabase = getSupabaseClient();
    const instName = payload.institution.trim();
    const ticker = payload.ticker.trim().toUpperCase();
    const valorTotal = Math.round(payload.quantity * payload.unitPrice * 100) / 100;

    // 1. Garante que a instituição/conta exista
    let conta = await supabase
      .from('accounts')
      .select('*')
      .ilike('name', instName)
      .maybeSingle();

    let accountId = conta.data?.id;

    if (!accountId) {
      const novaConta = await criarOuAtualizarConta(
        {
          name: instName,
          type: payload.assetClass === 'Renda Fixa' ? 'fixed_income' : 'investment_broker',
          balance: valorTotal,
        },
        requestId
      );
      accountId = novaConta.id;
    } else {
      // Atualiza saldo da conta com o novo aporte
      const novoSaldo = Math.round((Number(conta.data.balance || 0) + valorTotal) * 100) / 100;
      await supabase
        .from('accounts')
        .update({ balance: novoSaldo, updated_at: new Date().toISOString() })
        .eq('id', accountId);
    }

    // 2. Se for ativo negociável (ações, FIIs, cripto, etc.), insere/atualiza na tabela investment_assets
    const assetType = mapAssetClassToType(payload.assetClass);
    try {
      await cadastrarOuAtualizarAtivo(
        {
          account_id: accountId,
          ticker,
          asset_type: assetType,
          quantity: payload.quantity,
          average_price: payload.unitPrice,
        },
        requestId
      );
    } catch (err: any) {
      log('warn', 'Erro ao salvar em investment_assets, prosseguindo com registro de transação', { erro: err.message });
    }

    // 3. Registra a transação no ledger
    const occurredAt = payload.operationDate
      ? new Date(payload.operationDate).toISOString()
      : new Date().toISOString();

    const { data: transacao, error: txError } = await supabase
      .from('transactions')
      .insert({
        description: `Aporte ${ticker} (${instName})`,
        total_amount: valorTotal,
        gross_amount: valorTotal,
        entry_type: 'expense',
        payment_method: 'investment',
        account_id: accountId,
        occurred_at: occurredAt,
        raw_input: `Aporte ${ticker} ${payload.quantity} cotas a R$ ${payload.unitPrice} na ${instName}`,
      })
      .select('*')
      .single();

    if (txError) {
      log('warn', 'Erro ao gravar transação de aporte', { erro: txError.message });
    }

    return {
      sucesso: true,
      mensagem: `Ativo ${ticker} cadastrado com sucesso na ${instName}!`,
      dados: {
        ticker,
        instituicao: instName,
        quantidade: payload.quantity,
        precoUnitario: payload.unitPrice,
        valorTotal,
        transacao,
      },
    };
  });
}

/**
 * Ajusta o saldo de uma instituição/conta diretamente
 */
export async function ajustarSaldoInstituicao(
  payload: { accountId?: string; name?: string; novoSaldo: number; registrarTransacao?: boolean; motivo?: string },
  requestId: string = randomUUID()
) {
  const identificador = payload.accountId || payload.name;
  if (!identificador) {
    throw new Error('Identificador da conta (ID ou Nome) é obrigatório.');
  }

  const supabase = getSupabaseClient();
  let saldoAnterior = 0;
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identificador);
    let q = supabase.from('accounts').select('id, name, balance');
    q = isUuid ? q.eq('id', identificador) : q.ilike('name', identificador);
    const { data: cData } = await q.maybeSingle();
    if (cData) {
      saldoAnterior = Number(cData.balance || 0);
    }
  } catch (err) {
    // Continua
  }

  const novoSaldoNum = Number(payload.novoSaldo);
  const diferenca = Math.round((novoSaldoNum - saldoAnterior) * 100) / 100;
  const contaAtualizada = await ajustarSaldo(identificador, novoSaldoNum, requestId);

  // Se solicitado pelo usuário ou se houver delta de rendimento e flag ativa, gera registro no extrato
  if (payload.registrarTransacao && diferenca !== 0 && contaAtualizada) {
    const isRendimento = diferenca > 0;
    const desc = payload.motivo || (isRendimento ? `Rendimento ${contaAtualizada.name}` : `Ajuste de Saldo ${contaAtualizada.name}`);
    try {
      await supabase.from('transactions').insert({
        description: desc,
        total_amount: Math.abs(diferenca),
        gross_amount: Math.abs(diferenca),
        entry_type: isRendimento ? 'yield' : 'expense',
        payment_method: 'investment',
        account_id: contaAtualizada.id,
        occurred_at: new Date().toISOString(),
        raw_input: `Ajuste de saldo: R$ ${saldoAnterior.toFixed(2)} -> R$ ${novoSaldoNum.toFixed(2)} em ${contaAtualizada.name}`,
      });
    } catch (txErr: any) {
      log('warn', 'Erro ao gravar transação de ajuste de saldo', { erro: txErr.message });
    }
  }

  return {
    sucesso: true,
    mensagem: `Saldo de ${contaAtualizada.name} ajustado para R$ ${contaAtualizada.balance.toFixed(2)}.`,
    dados: contaAtualizada,
  };
}

/**
 * Edita todas as informações de uma instituição / conta
 */
export async function editarInstituicaoCompleta(
  payload: {
    accountId: string;
    name: string;
    type: 'checking' | 'benefit' | 'fixed_income' | 'investment_broker';
    balance: number;
    cdi_rate?: number | null;
    start_date?: string | null;
  },
  requestId: string = randomUUID()
) {
  return withTiming('editar instituicao completa', { requestId, accountId: payload.accountId }, async () => {
    const supabase = getSupabaseClient();
    const updatePayload: any = {
      name: payload.name.trim(),
      type: payload.type,
      balance: Number(payload.balance),
      updated_at: new Date().toISOString(),
    };

    if (payload.cdi_rate !== undefined) {
      updatePayload.cdi_rate = payload.cdi_rate ? Number(payload.cdi_rate) : null;
    }
    if (payload.start_date !== undefined) {
      updatePayload.start_date = payload.start_date || null;
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(updatePayload)
      .eq('id', payload.accountId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Erro ao atualizar instituição: ${error.message}`);
    }

    return {
      sucesso: true,
      mensagem: `Instituição "${data.name}" atualizada com sucesso!`,
      dados: data,
    };
  });
}

/**
 * Remove / exclui uma instituição ou conta
 */
export async function removerInstituicao(accountId: string, requestId: string = randomUUID()) {
  return withTiming('remover instituicao', { requestId, accountId }, async () => {
    const supabase = getSupabaseClient();
    // Exclui ativos vinculados primeiro
    await supabase.from('investment_assets').delete().eq('account_id', accountId);
    // Exclui a conta
    const { error } = await supabase.from('accounts').delete().eq('id', accountId);
    if (error) {
      // Se tiver restrição de FK em transactions, marca como inativa
      await supabase.from('accounts').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', accountId);
    }
    return {
      sucesso: true,
      mensagem: 'Instituição removida com sucesso.',
    };
  });
}

/**
 * Remove / exclui um ativo de investimento
 */
export async function removerAtivo(assetId: string, requestId: string = randomUUID()) {
  return withTiming('remover ativo', { requestId, assetId }, async () => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('investment_assets').delete().eq('id', assetId);
    if (error) {
      throw new Error(`Erro ao remover ativo: ${error.message}`);
    }
    return {
      sucesso: true,
      mensagem: 'Ativo de investimento removido com sucesso.',
    };
  });
}

/**
 * Retorna o extrato especializado em investimentos, proventos e aportes
 */
export async function obterExtratoInvestimentos(
  filtro: { mesAno?: string; tipo?: string; busca?: string },
  requestId: string = randomUUID()
) {
  return withTiming('obter extrato de investimentos', { requestId, filtro }, async () => {
    const supabase = getSupabaseClient();
    const mes = filtro.mesAno ?? mesAnoAtual();
    const intervalo = intervaloDoMes(mes);

    let query = supabase
      .from('transactions')
      .select(`
        id,
        display_id,
        description,
        total_amount,
        occurred_at,
        entry_type,
        payment_method,
        accounts!account_id (id, name, type)
      `)
      .order('occurred_at', { ascending: false });

    if (intervalo) {
      query = query.gte('occurred_at', intervalo.inicioISO).lt('occurred_at', intervalo.fimISO);
    }

    const { data: rawTx, error } = await query;
    if (error) {
      log('warn', 'Erro ao consultar transações de investimento', { erro: error.message, requestId });
    }

    const itensReais: ExtratoInvestimentoItem[] = [];
    if (rawTx && rawTx.length > 0) {
      for (const t of rawTx) {
        const desc = t.description || '';
        const descLower = desc.toLowerCase();
        const accountType = (t as any).accounts?.type;
        const isInvestmentAccount = accountType === 'fixed_income' || accountType === 'investment_broker';
        const isInvestmentMethod = t.payment_method === 'investment';
        const isYield = t.entry_type === 'yield';
        const hasKeyword =
          descLower.includes('aporte') ||
          descLower.includes('invest') ||
          descLower.includes('dividendo') ||
          descLower.includes('jcp') ||
          descLower.includes('rendimento') ||
          descLower.includes('resgate') ||
          descLower.includes('cdb') ||
          descLower.includes('tesouro') ||
          descLower.includes('fii');

        // Se for transação de investimento ou associada a conta de investimento/rendimento
        if (isInvestmentMethod || isYield || isInvestmentAccount || hasKeyword) {
          const dt = new Date(t.occurred_at);
          const mesNome = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          const groupTitle = mesNome.charAt(0).toUpperCase() + mesNome.slice(1);
          const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          let tipoItem: ExtratoInvestimentoItem['type'] = 'Aporte';
          if (descLower.includes('jcp')) {
            tipoItem = 'JCP';
          } else if (isYield || descLower.includes('dividendo') || descLower.includes('rendimento')) {
            tipoItem = 'Dividendo';
          } else if (descLower.includes('resgate')) {
            tipoItem = 'Resgate';
          } else if (descLower.includes('compra') || descLower.includes('ação') || descLower.includes('fii')) {
            tipoItem = 'Compra Ações';
          }

          // Categoria amigável
          let category = 'Investimentos';
          if (accountType === 'fixed_income' || descLower.includes('cdi') || descLower.includes('cdb') || descLower.includes('tesouro')) {
            category = 'Renda Fixa';
          } else if (accountType === 'investment_broker' || descLower.includes('fii') || descLower.includes('ação')) {
            category = 'Renda Variável';
          } else if (descLower.includes('cripto') || descLower.includes('btc') || descLower.includes('eth')) {
            category = 'Cripto';
          }

          // Ticker simplificado
          let ticker = desc.replace(/(aporte|resgate|rendimento|dividendo de|jcp de|compra)/gi, '').trim();
          if (!ticker || ticker.length > 20) {
            ticker = (t as any).accounts?.name || 'Investimento';
          }

          itensReais.push({
            id: t.display_id || t.id,
            ticker,
            title: desc,
            type: tipoItem,
            time: hora,
            institution: (t as any).accounts?.name || 'Custódia',
            category,
            detail: `${hora} • ${(t as any).accounts?.name || 'Conta'}`,
            amount: Number(t.total_amount),
            status: 'Liquidado',
            date: t.occurred_at,
            monthGroup: groupTitle,
          });
        }
      }
    }

    // Aplica filtro de busca se houver
    let itensFiltrados = itensReais;
    if (filtro.busca && filtro.busca.trim()) {
      const q = filtro.busca.toLowerCase().trim();
      itensFiltrados = itensFiltrados.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.ticker.toLowerCase().includes(q) ||
          i.institution.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q)
      );
    }

    // Aplica filtro por tipo se houver
    if (filtro.tipo && filtro.tipo !== 'Todos') {
      if (filtro.tipo === 'Aportes') {
        itensFiltrados = itensFiltrados.filter((i) => i.type === 'Aporte' || i.type === 'Compra Ações');
      } else if (filtro.tipo === 'Dividendos / JCP') {
        itensFiltrados = itensFiltrados.filter((i) => i.type === 'Dividendo' || i.type === 'JCP');
      } else if (filtro.tipo === 'Resgates') {
        itensFiltrados = itensFiltrados.filter((i) => i.type === 'Resgate');
      }
    }

    // Agrupamento por mês real
    const grupos: Record<string, ExtratoInvestimentoItem[]> = {};
    for (const item of itensFiltrados) {
      const groupKey = item.monthGroup || rotuloDoMes(mes);
      if (!grupos[groupKey]) grupos[groupKey] = [];
      grupos[groupKey].push(item);
    }

    // Cálculos consolidados 100% REAIS do período
    const totalAportado = itensReais
      .filter((i) => i.type === 'Aporte' || i.type === 'Compra Ações')
      .reduce((s, i) => s + i.amount, 0);

    const proventosItens = itensReais.filter((i) => i.type === 'Dividendo' || i.type === 'JCP');
    const totalProventos = proventosItens.reduce((s, i) => s + i.amount, 0);

    return {
      mesAno: mes,
      rotuloMes: rotuloDoMes(mes),
      resumoMes: {
        totalAportado: Math.round(totalAportado * 100) / 100,
        variacaoVsMesAnterior: '',
        proventos: Math.round(totalProventos * 100) / 100,
        proventosQtd: proventosItens.length,
        rentabilidadePct: 0,
        rentabilidadeEstimada: 0,
      },
      insight: {
        titulo: 'Insight Guará IA',
        tempo: 'Hoje',
        texto: totalAportado > 0
          ? `Você aportou R$ ${totalAportado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} neste período.`
          : 'Nenhum aporte registrado para este período. Registre seus investimentos para acompanhar sua rentabilidade.',
      },
      grupos,
      totalItens: itensFiltrados.length,
    };
  });
}
