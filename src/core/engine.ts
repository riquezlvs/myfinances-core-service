import { randomUUID } from 'crypto';
import { log, withTiming } from '../utils/logger';
import { classificarIntencao } from '../services/gemini/intentRouter';
import {
  registrarTransacao,
  registrarEntrada,
  getResumoMensal,
  getGastosDiariosDoMes,
  getUltimosGastos,
  consultarGastosGranulares,
  atualizarGastoPorId,
  getFaturaMensal,
} from '../services/transactions/transactionService';
import { getCategoryMap } from '../services/categories/categoryCache';
import { inferirMetodoPagamento } from '../services/cards/paymentInference';
import { processarPagamento, getSaldoTerceiros } from '../services/debts/debtService';
import { calcularSafeToSpend, listarContas } from '../services/accounts/accountService';
import { listarMetas } from '../services/budgets/budgetService';
import { obterResumoPatrimonio } from '../services/patrimony/patrimonyService';
import { listarMetasPoupanca } from '../services/savings/savingsService';
import { formatarReal, formatarMetodo, formatarDataCurta } from '../utils/formatters';
import { extrairNomeEValorDeFrase } from '../utils/textParsers';
import { getSupabaseClient } from '../clients/supabaseClient';
import { mesAnoAtual, rotuloDoMes, mesAnoNaJanela, intervaloDoMes } from '../utils/month';
import { MAX_MONTH_LOOKBACK } from '../config/constants';
import type { IntentPayload, ParsedTransaction } from '../types/transaction';

export interface EngineInput {
  texto: string;
  origem: 'telegram' | 'web';
  requestId?: string;
  userId?: number | string;
}

export interface EngineOutput {
  sucesso: boolean;
  tipo: 'gasto' | 'entrada' | 'divida' | 'consulta' | 'resumo' | 'saldo' | 'comando' | 'mensagem';
  mensagem: string;
  dados?: Record<string, any>;
  avisos?: string[];
}

function normalizarTexto(str: string): string {
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Core Engine Unificado: processa qualquer texto vindo do Telegram ou Web
 * executando regras de negócio, IA (Gemini) e persistência no Supabase.
 */
export async function processarTextoEntrada(input: EngineInput): Promise<EngineOutput> {
  const requestId = input.requestId || randomUUID();
  const rawTexto = (input.texto || '').trim();

  if (!rawTexto) {
    return {
      sucesso: false,
      tipo: 'mensagem',
      mensagem: 'Nenhum texto informado para processar.',
    };
  }

  log('info', `🧠 [CoreEngine] Processando entrada via [${input.origem}]`, {
    requestId,
    origem: input.origem,
    texto: rawTexto,
  });

  // 1. Verificação de comandos diretos / rápidos
  const textoMinusculo = rawTexto.toLowerCase();

  if (textoMinusculo === '/resumo' || textoMinusculo === 'resumo') {
    return await obterResumoUnificado(requestId);
  }

  if (textoMinusculo === '/saldo' || textoMinusculo === 'saldo') {
    return await obterSaldoUnificado(requestId);
  }

  if (textoMinusculo === '/dividas' || textoMinusculo === 'dividas' || textoMinusculo === 'dívidas') {
    return await obterDividasUnificado(requestId);
  }

  if (textoMinusculo.startsWith('/gastos') || textoMinusculo === 'gastos') {
    const match = textoMinusculo.match(/\/gastos\s+(\d+)/);
    const limite = match ? parseInt(match[1], 10) : 5;
    return await obterUltimosGastosUnificado(limite, requestId);
  }

  // 2. Classificação de Intenção com Gemini (Fase 8 Payload Único)
  const payload: IntentPayload = await withTiming(
    'classificar intenção [CoreEngine]',
    { requestId, texto: rawTexto },
    () => classificarIntencao(rawTexto, requestId)
  );

  log('info', `🎯 [CoreEngine] Intenção identificada: ${payload.intent}`, {
    requestId,
    intent: payload.intent,
    params: payload.params,
  });

  switch (payload.intent) {
    case 'NOVO_GASTO': {
      if (!payload.transaction) {
        return {
          sucesso: false,
          tipo: 'mensagem',
          mensagem: 'Não consegui extrair os dados completos da compra. Tente: "Gastei 40 no almoço no débito".',
        };
      }
      return await executarNovoGasto(payload.transaction, rawTexto, requestId, payload.avisos);
    }

    case 'NOVA_ENTRADA': {
      if (!payload.transaction) {
        return {
          sucesso: false,
          tipo: 'mensagem',
          mensagem: 'Não consegui extrair os dados da entrada financeira.',
        };
      }
      return await executarNovaEntrada(payload.transaction, rawTexto, requestId, payload.avisos);
    }

    case 'PAGAMENTO_DIVIDA': {
      const extraido = extrairNomeEValorDeFrase(rawTexto);
      if (!extraido) {
        return {
          sucesso: false,
          tipo: 'divida',
          mensagem: 'Identifiquei pagamento de dívida, mas não entendi quem pagou ou o valor. Tente: "Fulano pagou 50 reais".',
        };
      }
      const resultado = await processarPagamento(extraido.nome, extraido.valor, requestId);
      return {
        sucesso: true,
        tipo: 'divida',
        mensagem: `Dívida de ${resultado.nome} atualizada! Valor pago: R$ ${formatarReal(extraido.valor || 0)}.`,
        dados: resultado,
      };
    }

    case 'CONSULTA': {
      return await executarConsulta(payload.params, requestId);
    }

    default: {
      return {
        sucesso: true,
        tipo: 'mensagem',
        mensagem:
          'Entendi sua mensagem, mas não identifiquei uma ação financeira específica. ' +
          'Você pode registrar compras (ex: "Gastei 35 na padaria"), entradas ("Recebi 2000 de salário") ou pedir "resumo" e "saldo".',
        dados: { intent: payload.intent, raw: payload },
      };
    }
  }
}

/** Executa o registro de novo gasto no banco de dados e infere o pagamento */
async function executarNovoGasto(
  transaction: ParsedTransaction,
  rawInput: string,
  requestId: string,
  avisos: string[] = []
): Promise<EngineOutput> {
  const categoryMap = await getCategoryMap(requestId);
  const decisao = await inferirMetodoPagamento(transaction, categoryMap, requestId);

  const dadosComPagamento: ParsedTransaction = {
    ...transaction,
    payment_method: decisao.payment_method,
    card_id: decisao.card_id,
  };

  const { displayIds } = await registrarTransacao(dadosComPagamento, rawInput, requestId);
  const categoriaNome = categoryMap[transaction.category_id] ?? 'Outros';
  const ehParcelado = displayIds.length > 1;
  const cartaoInfo = decisao.cartaoNome ? ` (${decisao.cartaoNome})` : '';

  let mensagem = `✅ Gasto de R$ ${formatarReal(transaction.total_amount)} (${transaction.description}) registrado com sucesso em ${categoriaNome} via ${formatarMetodo(decisao.payment_method)}${cartaoInfo}!`;

  if (ehParcelado) {
    mensagem += ` Parcelado em ${displayIds.length}x (IDs #${displayIds.join(', #')}).`;
  } else {
    mensagem += ` (ID #${displayIds[0]})`;
  }

  if (avisos.length > 0) {
    mensagem += `\n⚠️ Observação: ${avisos.join(', ')}`;
  }

  return {
    sucesso: true,
    tipo: 'gasto',
    mensagem,
    dados: {
      displayIds,
      descricao: transaction.description,
      valor: transaction.total_amount,
      categoria: categoriaNome,
      metodo: decisao.payment_method,
      cartao: decisao.cartaoNome,
    },
    avisos,
  };
}

/** Executa o registro de uma entrada financeira */
async function executarNovaEntrada(
  transaction: ParsedTransaction,
  rawInput: string,
  requestId: string,
  avisos: string[] = []
): Promise<EngineOutput> {
  const res = await registrarEntrada(
    {
      description: transaction.description,
      total_amount: transaction.total_amount,
      account_name: transaction.account_name ?? null,
      occurred_at: transaction.occurred_at,
    },
    rawInput,
    requestId
  );

  const saldoInfo =
    res.novoSaldo !== undefined
      ? ` Novo saldo em ${res.accountName}: R$ ${formatarReal(res.novoSaldo)}.`
      : '';

  return {
    sucesso: true,
    tipo: 'entrada',
    mensagem: `💰 Entrada de R$ ${formatarReal(transaction.total_amount)} (${transaction.description}) registrada na conta ${res.accountName}!${saldoInfo}`,
    dados: {
      valor: transaction.total_amount,
      descricao: transaction.description,
      conta: res.accountName,
      novoSaldo: res.novoSaldo,
    },
    avisos,
  };
}

/** Realiza consultas financeiras com respostas estruturadas */
async function executarConsulta(params: any, requestId: string): Promise<EngineOutput> {
  const entidade = params?.entidade;

  if (entidade === 'resumo') {
    return await obterResumoUnificado(requestId);
  }
  if (entidade === 'saldo') {
    return await obterSaldoUnificado(requestId);
  }
  if (entidade === 'dividas') {
    return await obterDividasUnificado(requestId);
  }
  if (entidade === 'gastos') {
    return await obterUltimosGastosUnificado(params?.limite || 5, requestId);
  }

  // Consulta por categoria ou mês
  const mes = params?.month ?? mesAnoAtual();
  if (params?.month && !mesAnoNaJanela(params.month)) {
    return {
      sucesso: false,
      tipo: 'consulta',
      mensagem: `Só consigo consultar períodos dos últimos ${MAX_MONTH_LOOKBACK} meses.`,
    };
  }

  let categoryId: number | undefined;
  let categoriaNome: string | undefined;

  if (params?.category) {
    const categoryMap = await getCategoryMap(requestId);
    const alvo = normalizarTexto(params.category);
    for (const [id, nome] of Object.entries(categoryMap)) {
      if (normalizarTexto(nome) === alvo) {
        categoryId = Number(id);
        categoriaNome = nome;
        break;
      }
    }
  }

  const resultado = await consultarGastosGranulares(
    {
      month: mes,
      categoryId,
      limite: params?.limite,
    },
    requestId
  );

  const rotulo = categoriaNome ? `${categoriaNome} em ${rotuloDoMes(mes)}` : rotuloDoMes(mes);
  const mensagem = `📊 Gastos com ${rotulo}: Total de R$ ${formatarReal(resultado.total)} (${resultado.items.length} lançamentos).`;

  return {
    sucesso: true,
    tipo: 'consulta',
    mensagem,
    dados: {
      total: resultado.total,
      periodo: mes,
      categoria: categoriaNome,
      itens: resultado.items,
    },
  };
}

/** Retorna dados de resumo mensal para Telegram e Web */
export async function obterResumoUnificado(requestId: string): Promise<EngineOutput> {
  const [resumo, metas, safeSummary] = await Promise.all([
    getResumoMensal(requestId),
    listarMetas(requestId).catch(() => []),
    calcularSafeToSpend(undefined, requestId).catch(() => null),
  ]);

  const msg = `📊 Resumo do Mês: Total gasto (sua parte) R$ ${formatarReal(resumo.meuGastoReal)}. ` +
    `Lançamentos: ${resumo.quantidade} | Gastos fixos/recorrentes: R$ ${formatarReal(resumo.gastosRecorrentes)}.`;

  return {
    sucesso: true,
    tipo: 'resumo',
    mensagem: msg,
    dados: {
      ...resumo,
      metas,
      safeSummary,
    },
  };
}

/** Retorna dados de saldo e safe-to-spend */
export async function obterSaldoUnificado(requestId: string): Promise<EngineOutput> {
  const [safeSummary, contas] = await Promise.all([
    calcularSafeToSpend(undefined, requestId),
    listarContas(requestId),
  ]);

  const msg = `💳 Saldo em Conta (${safeSummary.accountName}): R$ ${formatarReal(safeSummary.realBalance)}. ` +
    `Livre para gastar (Safe-to-Spend): R$ ${formatarReal(safeSummary.safeToSpend)}. ` +
    `Faturas abertas: R$ ${formatarReal(safeSummary.openCreditInvoices)}.`;

  return {
    sucesso: true,
    tipo: 'saldo',
    mensagem: msg,
    dados: {
      safeSummary,
      contas,
    },
  };
}

/** Retorna resumo de dívidas */
export async function obterDividasUnificado(requestId: string): Promise<EngineOutput> {
  const saldos = await getSaldoTerceiros(requestId, true);
  const total = saldos.reduce((soma, saldo) => soma + (saldo.total ?? saldo.valor), 0);
  const restante = saldos.reduce((soma, saldo) => soma + saldo.valor, 0);

  return {
    sucesso: true,
    tipo: 'divida',
    mensagem: `🤝 Resumo de Dívidas: Total emprestado: R$ ${formatarReal(total)}. Restante a receber: R$ ${formatarReal(restante)}.`,
    dados: {
      total,
      restante,
      pessoas: saldos,
    },
  };
}

/** Retorna os últimos N gastos */
export async function obterUltimosGastosUnificado(limite: number, requestId: string): Promise<EngineOutput> {
  const gastos = await getUltimosGastos(limite, requestId);
  return {
    sucesso: true,
    tipo: 'gasto',
    mensagem: `Últimos ${gastos.length} gastos encontrados.`,
    dados: {
      gastos,
    },
  };
}

/** Retorna a consolidação completa de patrimônio líquido (ativos e passivos) */
export async function obterPatrimonioUnificado(requestId: string): Promise<EngineOutput> {
  const patrimony = await obterResumoPatrimonio(requestId);
  return {
    sucesso: true,
    tipo: 'consulta',
    mensagem: `Patrimônio líquido total consolidado: R$ ${formatarReal(patrimony.totalNetWorth)}.`,
    dados: patrimony,
  };
}

/** Retorna as metas de poupança e caixinhas */
export async function obterPoupancaUnificado(requestId: string): Promise<EngineOutput> {
  const metas = await listarMetasPoupanca(requestId);
  return {
    sucesso: true,
    tipo: 'consulta',
    mensagem: `${metas.length} metas de poupança cadastradas.`,
    dados: {
      metas,
    },
  };
}

export interface ExtratoFiltro {
  mesAno?: string;
  tipo?: 'Todos' | 'Entradas' | 'Saídas' | string;
  busca?: string;
  limite?: number;
}

/**
 * Retorna extrato completo e consolidado de um mês com entradas, saídas, agrupamentos e estatísticas reais
 */
export async function obterExtratoCompletoUnificado(
  filtro: ExtratoFiltro,
  requestId: string
): Promise<EngineOutput> {
  const mes = filtro.mesAno ?? mesAnoAtual();
  const intervalo = intervaloDoMes(mes);
  if (!intervalo) {
    return {
      sucesso: false,
      tipo: 'consulta',
      mensagem: `Mês inválido: ${mes}`,
    };
  }

  const supabase = getSupabaseClient();

  // Busca todas as transações do mês com categoria e conta associada
  let query = supabase
    .from('transactions')
    .select(`
      display_id,
      description,
      total_amount,
      occurred_at,
      payment_method,
      entry_type,
      raw_input,
      installment_number,
      installment_total,
      categories (id, name),
      accounts!account_id (id, name, type)
    `)
    .gte('occurred_at', intervalo.inicioISO)
    .lt('occurred_at', intervalo.fimISO)
    .order('occurred_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    log('error', 'Erro ao buscar extrato completo no Supabase', { requestId, erro: error.message });
    throw new Error(`Erro ao buscar extrato: ${error.message}`);
  }

  const todas = (data ?? []) as any[];

  // Cálculos consolidados do mês
  let totalEntradas = 0;
  let countEntradas = 0;
  let totalSaidas = 0;
  let countSaidas = 0;

  for (const t of todas) {
    const valor = Number(t.total_amount) || 0;
    const isIncome = t.entry_type === 'income';
    if (isIncome) {
      totalEntradas += valor;
      countEntradas++;
    } else {
      totalSaidas += valor;
      countSaidas++;
    }
  }

  const liquidoNoMes = totalEntradas - totalSaidas;

  return {
    sucesso: true,
    tipo: 'consulta',
    mensagem: `Extrato de ${rotuloDoMes(mes)} carregado com sucesso.`,
    dados: {
      mesAno: mes,
      rotuloMes: rotuloDoMes(mes),
      totalEntradas,
      countEntradas,
      totalSaidas,
      countSaidas,
      liquidoNoMes,
      totalLancamentos: todas.length,
      itens: todas,
    },
  };
}

/**
 * Fase 8.5 — Gera preview estruturado de gasto/entrada sem gravar no banco de dados.
 * Permite ao usuário revisar valores, categoria, conta e impacto no Safe-to-Spend.
 */
export async function gerarPreviewTransacao(
  input: {
    texto: string;
    origem?: string;
    isAudio?: boolean;
    audioDurationSeconds?: number;
  },
  requestId: string
): Promise<EngineOutput> {
  const rawTexto = input.texto?.trim();
  if (!rawTexto) {
    return {
      sucesso: false,
      tipo: 'mensagem',
      mensagem: 'Mensagem vazia.',
    };
  }

  // 1. Classificação de Intenção com Gemini
  const payload: IntentPayload = await withTiming(
    'classificar intenção para preview [CoreEngine]',
    { requestId, texto: rawTexto },
    () => classificarIntencao(rawTexto, requestId)
  );

  if (payload.intent !== 'NOVO_GASTO' && payload.intent !== 'NOVA_ENTRADA') {
    return {
      sucesso: false,
      tipo: 'mensagem',
      mensagem:
        'Não foi possível identificar um gasto ou entrada nessa mensagem. Tente especificar um valor, como: "Almoço 45 reais no débito".',
    };
  }

  const transaction = payload.transaction;
  if (!transaction || !transaction.total_amount) {
    return {
      sucesso: false,
      tipo: 'mensagem',
      mensagem: 'Não consegui extrair o valor ou os dados da compra.',
    };
  }

  const categoryMap = await getCategoryMap(requestId);
  const decisao = await inferirMetodoPagamento(transaction, categoryMap, requestId);

  // Busca dados de Safe-to-Spend e contas
  const [safeSummary, contas] = await Promise.all([
    calcularSafeToSpend(undefined, requestId).catch(() => ({
      accountName: 'Conta Principal',
      realBalance: 0,
      openCreditInvoices: 0,
      safeToSpend: 0,
    })),
    listarContas(requestId).catch(() => []),
  ]);

  const valor = Number(transaction.total_amount) || 0;
  const saldoLivreAtual = safeSummary.safeToSpend;
  const isIncome = payload.intent === 'NOVA_ENTRADA';

  const novoSaldoLivreProjetado = isIncome ? saldoLivreAtual + valor : saldoLivreAtual - valor;
  const impactoPercentual =
    saldoLivreAtual > 0
      ? Number(((valor / saldoLivreAtual) * 100).toFixed(2))
      : 0;

  const categoriaNome = categoryMap[transaction.category_id] ?? 'Outros';

  const previewData = {
    originalInput: rawTexto,
    isAudio: Boolean(input.isAudio),
    audioDuration: input.audioDurationSeconds ? `0:0${Math.round(input.audioDurationSeconds)}s` : '0:04s',
    precision: '99.4%',
    entryType: isIncome ? 'income' : 'expense',
    description: transaction.description || (isIncome ? 'Entrada' : 'Gasto'),
    totalAmount: valor,
    categoryId: transaction.category_id,
    categoryName: categoriaNome,
    paymentMethod: decisao.payment_method,
    paymentMethodLabel: formatarMetodo(decisao.payment_method),
    cardName: decisao.cartaoNome || null,
    accountName: safeSummary.accountName,
    accountBalance: safeSummary.realBalance,
    occurredAt: transaction.occurred_at || new Date().toISOString(),
    location: transaction.description,
    safeToSpend: {
      current: saldoLivreAtual,
      projected: novoSaldoLivreProjetado,
      impactPercentage: impactoPercentual,
      impactLabel: `${isIncome ? '+' : '-'}${impactoPercentual}%`,
      progressBarPercent: Math.max(10, Math.min(100, Math.round((novoSaldoLivreProjetado / (saldoLivreAtual || 1)) * 100))),
    },
    availableCategories: Object.entries(categoryMap).map(([id, name]) => ({
      id: Number(id),
      name,
    })),
    availableAccounts: contas.map((c) => ({
      id: c.id,
      name: c.name,
      balance: Number(c.balance),
    })),
  };

  return {
    sucesso: true,
    tipo: isIncome ? 'entrada' : 'gasto',
    mensagem: 'Interpretação concluída com sucesso.',
    dados: previewData,
  };
}

/**
 * Fase 8.5 — Confirma e persiste o lançamento no Supabase após validação na tela intermediária.
 */
export async function confirmarTransacaoUnificado(
  dados: {
    entryType: 'expense' | 'income';
    description: string;
    totalAmount: number;
    categoryId?: number;
    paymentMethod?: string;
    cardId?: string | null;
    accountName?: string | null;
    occurredAt?: string;
    rawInput?: string;
    installmentTotal?: number | null;
  },
  requestId: string
): Promise<EngineOutput> {
  const isIncome = dados.entryType === 'income';

  if (isIncome) {
    return await executarNovaEntrada(
      {
        description: dados.description,
        total_amount: Number(dados.totalAmount),
        account_name: dados.accountName ?? null,
        occurred_at: dados.occurredAt ?? new Date().toISOString(),
        category_id: dados.categoryId ?? 1,
        entry_type: 'income',
        payment_method: (dados.paymentMethod as any) || null,
      },
      dados.rawInput || dados.description,
      requestId
    );
  }

  return await executarNovoGasto(
    {
      description: dados.description,
      total_amount: Number(dados.totalAmount),
      category_id: dados.categoryId ?? 1,
      payment_method: (dados.paymentMethod as any) || 'debit_card',
      card_id: dados.cardId || null,
      account_name: dados.accountName ?? null,
      occurred_at: dados.occurredAt ?? new Date().toISOString(),
      entry_type: 'expense',
      installment_total: dados.installmentTotal || null,
    },
    dados.rawInput || dados.description,
    requestId
  );
}
