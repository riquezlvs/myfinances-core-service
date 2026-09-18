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
import { formatarReal, formatarMetodo, formatarDataCurta } from '../utils/formatters';
import { extrairNomeEValorDeFrase } from '../utils/textParsers';
import { mesAnoAtual, rotuloDoMes, mesAnoNaJanela } from '../utils/month';
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
