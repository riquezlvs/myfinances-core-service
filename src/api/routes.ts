import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { log } from '../utils/logger';
import { getSupabaseClient } from '../clients/supabaseClient';
import {
  processarTextoEntrada,
  obterResumoUnificado,
  obterSaldoUnificado,
  obterUltimosGastosUnificado,
  obterPatrimonioUnificado,
  obterPoupancaUnificado,
  obterExtratoCompletoUnificado,
  gerarPreviewTransacao,
  confirmarTransacaoUnificado,
} from '../core/engine';
import { obterDadosGraficosDashboard, apagarTransacaoComGrupo } from '../services/transactions/transactionService';
import { obterCartoesDetalhados, cadastrarNovoCartao, removerCartao, processarPagamentoFatura } from '../services/cards/cardService';
import {
  obterDadosInvestimentosDashboard,
  cadastrarAtivoInvestimento,
  ajustarSaldoInstituicao,
  editarInstituicaoCompleta,
  removerInstituicao,
  removerAtivo,
  obterExtratoInvestimentos,
} from '../services/investments/investmentService';
import { listarPessoasComSaldos, cadastrarNovaPessoa } from '../services/people/peopleService';
import { getSaldoTerceiros, registrarPagamentoNoBanco, processarPagamento, salvarDividida } from '../services/debts/debtService';
import { obterPosicaoConsolidadaTitular } from '../services/accounts/accountService';
import { registrarReceitaAvulsa } from '../services/incomes/incomeService';
import {
  listarTodasRecorrencias,
  cadastrarNovaRecorrencia,
  desativarRecorrenciaPorId,
} from '../services/recurring/recurringService';


import { MAX_IMAGE_FILE_SIZE_BYTES } from '../config/constants';
import { interpretarExtrato } from '../services/gemini/statementParser';
import { calcularSafeToSpend, listarContas } from '../services/accounts/accountService';
import { getCategoryMap } from '../services/categories/categoryCache';
import { listarCartoes } from '../services/cards/cardService';
import { formatarMetodo } from '../utils/formatters';

/**
 * Utilitário para adicionar cabeçalhos CORS a todas as respostas HTTP
 */
function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Lê e parseia o corpo JSON de uma requisição HTTP (suporta até MAX_IMAGE_FILE_SIZE_BYTES para imagens)
 */
async function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // Prevenção contra payloads gigantes (> 15MB)
      if (body.length > MAX_IMAGE_FILE_SIZE_BYTES) {
        req.socket.destroy();
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Responde a requisição com JSON
 */
function sendJson(res: ServerResponse, statusCode: number, data: any) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * Roteador HTTP unificado para a API consumida pelo frontend
 */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const requestId = randomUUID();

  // Tratamento de CORS Preflight
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  // Rota: POST /api/chat/preview ou /api/transacoes/interpretar (Preview sem salvar no banco)
  if ((url === '/api/chat/preview' || url === '/api/transacoes/interpretar') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const mensagem = body?.message || body?.texto;

      if (!mensagem || typeof mensagem !== 'string') {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "message" ou "texto" é obrigatório.',
        });
        return true;
      }

      const resultado = await gerarPreviewTransacao(
        {
          texto: mensagem,
          origem: 'web',
          isAudio: Boolean(body?.isAudio),
          audioDurationSeconds: body?.audioDurationSeconds,
        },
        requestId
      );

      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao gerar preview de transação', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao interpretar mensagem.',
      });
      return true;
    }
  }

  // Rota: POST /api/chat/confirm ou /api/transacoes/confirmar (Confirmação final e gravação no Supabase)
  if ((url === '/api/chat/confirm' || url === '/api/transacoes/confirmar') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const resultado = await confirmarTransacaoUnificado(body, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao confirmar transação', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao confirmar transação.',
      });
      return true;
    }
  }

  // Rota: POST /api/chat/image-preview (Preview multimodal de imagem / extrato / comprovante)
  if ((url === '/api/chat/image-preview' || url === '/api/transacoes/imagem') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      let imageBase64: string = body?.imageBase64 || body?.image || body?.base64;
      const mimeType: string = body?.mimeType || 'image/jpeg';
      const legenda: string | undefined = body?.caption || body?.legenda || undefined;

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "imageBase64" é obrigatório.',
        });
        return true;
      }

      // Remove prefixo data:image/...;base64, se presente
      if (imageBase64.includes(';base64,')) {
        imageBase64 = imageBase64.split(';base64,')[1]!;
      }

      const buffer = Buffer.from(imageBase64, 'base64');
      const extrato = await interpretarExtrato(buffer, mimeType, requestId, legenda);

      if (!extrato.items.length) {
        sendJson(res, 422, {
          sucesso: false,
          tipo: 'mensagem',
          mensagem: 'Não foi possível identificar nenhuma despesa ou comprovante nítido nesta imagem.',
        });
        return true;
      }

      const [categoryMap, safeSummary, contas, cartoes] = await Promise.all([
        getCategoryMap(requestId),
        calcularSafeToSpend(undefined, requestId).catch(() => ({
          accountName: 'Conta Principal',
          realBalance: 0,
          openCreditInvoices: 0,
          safeToSpend: 0,
        })),
        listarContas(requestId).catch(() => []),
        listarCartoes(requestId).catch(() => []),
      ]);

      // Tenta associar cartão pelo hint ou legenda
      let cartaoEscolhido = cartoes.find((c) => c.card_type === 'credit' && c.is_default) || cartoes[0];
      const textoParaBuscaCartao = `${legenda ?? ''} ${extrato.card_name_hint ?? ''}`.toLowerCase();
      if (textoParaBuscaCartao.trim()) {
        const match = cartoes.find((c) => {
          const nomeC = c.name.toLowerCase();
          return textoParaBuscaCartao.includes(nomeC) || (extrato.card_name_hint && nomeC.includes(extrato.card_name_hint.toLowerCase()));
        });
        if (match) {
          cartaoEscolhido = match;
        }
      }

      const saldoLivreAtual = safeSummary.safeToSpend;
      const primeiroItem = extrato.items[0]!;
      const valor = primeiroItem.amount;
      const novoSaldoLivreProjetado = saldoLivreAtual - valor;
      const impactoPercentual = saldoLivreAtual > 0 ? Number(((valor / saldoLivreAtual) * 100).toFixed(2)) : 0;
      const categoriaNome = categoryMap[primeiroItem.category_id] ?? 'Outros';

      let descricaoFinal = primeiroItem.description;
      if (legenda && extrato.items.length === 1) {
        descricaoFinal = legenda;
      }

      const previewData = {
        originalInput: legenda || `Comprovante: ${extrato.card_name_hint || descricaoFinal}`,
        isAudio: false,
        origin: 'image',
        precision: '99.2% (IA Visão)',
        entryType: 'expense' as const,
        description: descricaoFinal,
        totalAmount: valor,
        categoryId: primeiroItem.category_id,
        categoryName: categoriaNome,
        paymentMethod: cartaoEscolhido ? 'credit_card' : 'debit_card',
        paymentMethodLabel: cartaoEscolhido ? `Cartão • ${cartaoEscolhido.name}` : 'Débito',
        cardName: cartaoEscolhido?.name || extrato.card_name_hint || null,
        accountName: safeSummary.accountName,
        accountBalance: safeSummary.realBalance,
        occurredAt: primeiroItem.date.includes('T') ? primeiroItem.date : `${primeiroItem.date}T12:00:00-03:00`,
        location: descricaoFinal,
        safeToSpend: {
          current: saldoLivreAtual,
          projected: novoSaldoLivreProjetado,
          impactPercentage: impactoPercentual,
          impactLabel: `-${impactoPercentual}%`,
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

      const todosItens = extrato.items.map((it) => ({
        description: it.description,
        totalAmount: it.amount,
        categoryId: it.category_id,
        categoryName: categoryMap[it.category_id] ?? 'Outros',
        occurredAt: it.date,
        installmentNumber: it.installment_current,
        installmentTotal: it.installment_total,
      }));

      sendJson(res, 200, {
        sucesso: true,
        tipo: 'gasto',
        mensagem: 'Imagem analisada com sucesso pelo Guará IA.',
        dados: previewData,
        multiplos: extrato.items.length > 1 ? todosItens : undefined,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao interpretar imagem de extrato/comprovante', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao processar imagem.',
      });
      return true;
    }
  }

  // Rota: POST /api/chat
  if (url === '/api/chat' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const mensagem = body?.message || body?.texto;

      if (!mensagem || typeof mensagem !== 'string') {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "message" ou "texto" é obrigatório no corpo da requisição.',
        });
        return true;
      }

      // Suporte para quando o frontend enviar preview: true
      if (body?.preview) {
        const resultado = await gerarPreviewTransacao(
          {
            texto: mensagem,
            origem: 'web',
            isAudio: Boolean(body?.isAudio),
            audioDurationSeconds: body?.audioDurationSeconds,
          },
          requestId
        );
        sendJson(res, 200, resultado);
        return true;
      }

      const resultado = await processarTextoEntrada({
        texto: mensagem,
        origem: 'web',
        requestId,
      });

      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao processar /api/chat', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro interno ao processar mensagem.',
      });
      return true;
    }
  }

  // Rota: GET /api/dashboard
  if (url === '/api/dashboard' && method === 'GET') {
    try {
      const [resumo, saldo, gastos, patrimonio, poupanca, graficos, consolidado] = await Promise.all([
        obterResumoUnificado(requestId),
        obterSaldoUnificado(requestId),
        obterUltimosGastosUnificado(10, requestId),
        obterPatrimonioUnificado(requestId).catch(() => null),
        obterPoupancaUnificado(requestId).catch(() => null),
        obterDadosGraficosDashboard(requestId).catch((err) => {
          log('warn', 'Erro ao obter dados gráficos do dashboard', { erro: err.message });
          return null;
        }),
        obterPosicaoConsolidadaTitular(requestId).catch(() => null),
      ]);

      sendJson(res, 200, {
        sucesso: true,
        data: {
          resumo: resumo.dados,
          saldo: saldo.dados,
          recentes: gastos.dados?.gastos || [],
          patrimonio: patrimonio?.dados || null,
          poupanca: poupanca?.dados?.metas || [],
          graficos: graficos || null,
          consolidado: consolidado || null,
        },
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter dados de /api/dashboard', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: 'Erro ao carregar métricas do dashboard.',
      });
      return true;
    }
  }

  // Rota: GET /api/extrato
  if (url.startsWith('/api/extrato') && method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const mesAno = parsedUrl.searchParams.get('mes') || parsedUrl.searchParams.get('mesAno') || undefined;
      const idParam = parsedUrl.searchParams.get('id') || undefined;

      if (idParam) {
        const supabase = getSupabaseClient();
        const numericId = parseInt(idParam, 10);
        let txData: any = null;

        let queryWithRel = supabase
          .from('transactions')
          .select(`
            id,
            display_id,
            description,
            total_amount,
            occurred_at,
            payment_method,
            entry_type,
            raw_input,
            installment_number,
            installment_total,
            installment_group_id,
            observation,
            account_id,
            category_id,
            is_recurring,
            categories (id, name),
            accounts (id, name, type)
          `);

        if (!isNaN(numericId) && String(numericId) === idParam.trim()) {
          queryWithRel = queryWithRel.eq('display_id', numericId);
        } else {
          queryWithRel = queryWithRel.eq('id', idParam.trim());
        }

        const { data: dataWithRelations, error: errRel } = await queryWithRel.maybeSingle();

        if (!errRel && dataWithRelations) {
          txData = dataWithRelations;
        } else {
          let simpleQuery = supabase
            .from('transactions')
            .select(`
              id,
              display_id,
              description,
              total_amount,
              occurred_at,
              payment_method,
              entry_type,
              raw_input,
              installment_number,
              installment_total,
              installment_group_id,
              observation,
              account_id,
              category_id,
              is_recurring,
              categories (id, name)
            `);

          if (!isNaN(numericId) && String(numericId) === idParam.trim()) {
            simpleQuery = simpleQuery.eq('display_id', numericId);
          } else {
            simpleQuery = simpleQuery.eq('id', idParam.trim());
          }

          const { data: simpleData } = await simpleQuery.maybeSingle();
          txData = simpleData;
        }

        sendJson(res, 200, {
          sucesso: true,
          dados: {
            mesAno: mesAno || '',
            rotuloMes: '',
            totalEntradas: txData?.entry_type === 'income' ? Number(txData.total_amount) : 0,
            countEntradas: txData?.entry_type === 'income' ? 1 : 0,
            totalSaidas: txData?.entry_type === 'expense' ? Number(txData.total_amount) : 0,
            countSaidas: txData?.entry_type === 'expense' ? 1 : 0,
            liquidoNoMes: 0,
            totalLancamentos: txData ? 1 : 0,
            itens: txData ? [txData] : [],
          },
        });
        return true;
      }

      const resultado = await obterExtratoCompletoUnificado({ mesAno }, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter dados de /api/extrato', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: 'Erro ao carregar dados do extrato.',
      });
      return true;
    }
  }

  // Rota: GET /api/categories (Lista categorias disponíveis no sistema)
  if (url === '/api/categories' && method === 'GET') {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) throw error;
      sendJson(res, 200, {
        sucesso: true,
        dados: data || [],
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao listar categorias', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao carregar categorias.',
      });
      return true;
    }
  }

  // Rota: GET /api/accounts (Lista contas e carteiras disponíveis no sistema)
  if (url === '/api/accounts' && method === 'GET') {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, type, balance')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      sendJson(res, 200, {
        sucesso: true,
        dados: data || [],
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao listar contas', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao carregar contas.',
      });
      return true;
    }
  }

  // Rota: GET /api/accounts/summary (Posição consolidada da pessoa: contas + faturas)
  if (url === '/api/accounts/summary' && method === 'GET') {
    try {
      const summary = await obterPosicaoConsolidadaTitular(requestId);
      sendJson(res, 200, {
        sucesso: true,
        dados: summary,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter sumário consolidado de contas', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: 'Erro ao obter sumário consolidado de contas.',
      });
      return true;
    }
  }

  // Rota: POST /api/incomes (Cadastro direto de receitas avulsas: freela, terceiros, extras)
  if (url === '/api/incomes' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.description || body?.amount === undefined) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Descrição e valor são obrigatórios.',
        });
        return true;
      }

      const resultado = await registrarReceitaAvulsa({
        description: body.description,
        amount: Number(body.amount),
        accountId: body.accountId || body.account_id,
        occurredAt: body.occurredAt || body.occurred_at,
        categoryId: body.categoryId || body.category_id,
        incomeType: body.incomeType || body.income_type,
        paymentMethod: body.paymentMethod || body.payment_method,
        isRecurring: body.isRecurring !== undefined ? Boolean(body.isRecurring) : (body.is_recurring !== undefined ? Boolean(body.is_recurring) : undefined),
        dayOfMonth: body.dayOfMonth || body.day_of_month,
        weekendRule: body.weekendRule || body.weekend_rule,
      }, requestId);

      sendJson(res, 201, {
        sucesso: true,
        dados: resultado,
        mensagem: 'Receita cadastrada com sucesso!',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao cadastrar receita avulsa', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao registrar receita.',
      });
      return true;
    }
  }

  // Rota: GET /api/recurring (Lista despesas fixas ou receitas recorrentes)
  if (url.startsWith('/api/recurring') && method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const typeParam = parsedUrl.searchParams.get('type') as 'expense' | 'income' | null;
      const recorrencias = await listarTodasRecorrencias(typeParam || undefined, requestId);
      sendJson(res, 200, {
        sucesso: true,
        dados: recorrencias,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao listar recorrências', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: 'Erro ao listar recorrências.',
      });
      return true;
    }
  }

  // Rota: POST /api/recurring (Cadastra nova recorrência)
  if (url === '/api/recurring' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.description || body?.total_amount === undefined || !body?.day_of_month) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Descrição, valor e dia do mês são obrigatórios.',
        });
        return true;
      }

      const rec = await cadastrarNovaRecorrencia({
        description: body.description,
        total_amount: Number(body.total_amount),
        day_of_month: Number(body.day_of_month),
        entry_type: body.entry_type || 'expense',
        payment_method: body.payment_method,
        category_id: body.category_id,
        account_id: body.account_id,
        income_type: body.income_type,
        weekend_rule: body.weekend_rule,
      }, requestId);

      sendJson(res, 201, {
        sucesso: true,
        dados: rec,
        mensagem: 'Recorrência cadastrada com sucesso!',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao cadastrar recorrência', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao cadastrar recorrência.',
      });
      return true;
    }
  }

  // Rota: DELETE /api/recurring ou POST /api/recurring/remover
  if (
    (url === '/api/recurring/remover' && method === 'POST') ||
    (url.startsWith('/api/recurring') && method === 'DELETE')
  ) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      let id = parsedUrl.searchParams.get('id');
      if (!id && method === 'POST') {
        const body = await parseJsonBody(req);
        id = body?.id;
      }
      if (!id && url.startsWith('/api/recurring/')) {
        id = url.split('/api/recurring/')[1]?.split('?')[0];
      }

      if (!id) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'ID da recorrência é obrigatório.',
        });
        return true;
      }

      await desativarRecorrenciaPorId(id, requestId);
      sendJson(res, 200, {
        sucesso: true,
        mensagem: 'Recorrência desativada com sucesso.',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao remover recorrência', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao desativar recorrência.',
      });
      return true;
    }
  }

  // Rota: POST /api/transactions/excluir ou DELETE /api/transactions
  if (
    (url === '/api/transactions/excluir' && method === 'POST') ||
    (url.startsWith('/api/transactions') && method === 'DELETE')
  ) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      let displayId = parsedUrl.searchParams.get('display_id') || parsedUrl.searchParams.get('id');

      if (!displayId && method === 'POST') {
        const body = await parseJsonBody(req);
        displayId = body?.display_id || body?.id;
      }

      const numId = parseInt(String(displayId), 10);
      if (isNaN(numId)) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "display_id" ou "id" numérico é obrigatório.',
        });
        return true;
      }

      const resultado = await apagarTransacaoComGrupo(numId, requestId);
      sendJson(res, 200, {
        sucesso: true,
        mensagem: 'Lançamento excluído com sucesso do banco de dados!',
        dados: resultado,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao excluir transação', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao excluir transação no banco de dados.',
      });
      return true;
    }
  }

  // Rota: PUT ou POST /api/transactions/editar (Atualização real de lançamento)
  if (
    (url === '/api/transactions/editar' && method === 'POST') ||
    (url.startsWith('/api/transactions') && (method === 'PUT' || method === 'PATCH'))
  ) {
    try {
      const body = await parseJsonBody(req);
      const parsedUrl = new URL(url, 'http://localhost');
      const displayId = body?.display_id || body?.id || parsedUrl.searchParams.get('display_id') || parsedUrl.searchParams.get('id');

      const numId = parseInt(String(displayId), 10);
      if (isNaN(numId)) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "display_id" numérico é obrigatório para atualização.',
        });
        return true;
      }

      const supabase = getSupabaseClient();
      const updatePayload: Record<string, any> = {};

      if (body.description !== undefined) updatePayload.description = String(body.description).trim();
      if (body.total_amount !== undefined) updatePayload.total_amount = Number(body.total_amount);
      if (body.occurred_at !== undefined) updatePayload.occurred_at = body.occurred_at;
      if (body.payment_method !== undefined) updatePayload.payment_method = body.payment_method;
      if (body.entry_type !== undefined) updatePayload.entry_type = body.entry_type;
      if (body.observation !== undefined) updatePayload.observation = body.observation;
      if (body.category_id !== undefined) updatePayload.category_id = Number(body.category_id);

      const { data, error } = await supabase
        .from('transactions')
        .update(updatePayload)
        .eq('display_id', numId)
        .select(`
          display_id,
          description,
          total_amount,
          occurred_at,
          payment_method,
          entry_type,
          observation,
          categories (id, name)
        `)
        .maybeSingle();

      if (error) throw error;

      sendJson(res, 200, {
        sucesso: true,
        mensagem: 'Transação atualizada com sucesso no banco de dados!',
        dados: data,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao atualizar transação', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao atualizar transação no banco de dados.',
      });
      return true;
    }
  }

  // Rota: POST /api/debts/split (Divisão de despesa com pessoas reais)
  if (url === '/api/debts/split' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { display_id, pessoas } = body || {};

      if (!pessoas || !Array.isArray(pessoas) || pessoas.length === 0) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Informe a lista de pessoas para divisão.',
        });
        return true;
      }

      const supabase = getSupabaseClient();
      let tx: any = null;

      if (display_id) {
        const { data: t } = await supabase
          .from('transactions')
          .select('description, total_amount, category_id, payment_method, occurred_at')
          .eq('display_id', parseInt(String(display_id), 10))
          .maybeSingle();
        tx = t;
      }

      const descricao = body.description || tx?.description || 'Despesa dividida';
      const total = Number(body.total_amount || tx?.total_amount || 0);
      const categoryId = Number(body.category_id || tx?.category_id || 1);
      const paymentMethod = body.payment_method || tx?.payment_method || 'pix';
      const ocorreuEm = body.occurred_at || tx?.occurred_at || new Date().toISOString();

      const resultado = await salvarDividida({
        descricao,
        total,
        categoryId,
        paymentMethod,
        ocorreuEm,
        pessoas: pessoas.map((p: any) => typeof p === 'string' ? p : p.name || p.nome),
        requestId,
      });

      sendJson(res, 200, {
        sucesso: true,
        mensagem: 'Divisão com amigos salva no banco de dados!',
        dados: resultado,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao processar divisão com amigos', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao salvar divisão com amigos.',
      });
      return true;
    }
  }

  // Rota: GET /api/cards (Lista cartões com faturas calculadas e gastos)
  if (url === '/api/cards' && method === 'GET') {
    try {
      const cartoes = await obterCartoesDetalhados(requestId);
      sendJson(res, 200, {
        sucesso: true,
        dados: cartoes,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter lista de cartões', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao carregar cartões.',
      });
      return true;
    }
  }

  // Rota: POST /api/cards (Cadastra ou atualiza cartão)
  if (url === '/api/cards' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.name || !body?.closing_day) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Campos "name" e "closing_day" são obrigatórios.',
        });
        return true;
      }

      const cartao = await cadastrarNovoCartao(
        {
          id: body.id ? String(body.id) : undefined,
          name: String(body.name),
          closing_day: Number(body.closing_day),
          due_day: body.due_day ? Number(body.due_day) : undefined,
          credit_limit: body.credit_limit ? Number(body.credit_limit) : 0,
          card_type: body.card_type || 'credit',
          card_holder: body.card_holder ? String(body.card_holder) : undefined,
          last_four_digits: body.last_four_digits ? String(body.last_four_digits) : undefined,
          color_theme: body.color_theme ? String(body.color_theme) : 'titanium',
          is_virtual: Boolean(body.is_virtual),
        },
        requestId
      );

      sendJson(res, 201, {
        sucesso: true,
        dados: cartao,
        mensagem: 'Cartão salvo com sucesso!',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao cadastrar cartão', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao cadastrar cartão.',
      });
      return true;
    }
  }

  // Rota: POST /api/cards/remover ou DELETE /api/cards (Remover cartão)
  if (
    (url === '/api/cards/remover' && method === 'POST') ||
    (url.startsWith('/api/cards') && method === 'DELETE')
  ) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      let cardId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('name');
      
      if (!cardId && method === 'POST') {
        const body = await parseJsonBody(req);
        cardId = body?.id || body?.name;
      }

      if (!cardId) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Identificador do cartão ("id" ou "name") é obrigatório.',
        });
        return true;
      }

      const nomeRemovido = await removerCartao(String(cardId), requestId);
      sendJson(res, 200, {
        sucesso: true,
        mensagem: nomeRemovido ? `Cartão "${nomeRemovido}" removido com sucesso!` : 'Cartão removido com sucesso!',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao remover cartão', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao remover cartão.',
      });
      return true;
    }
  // Rota: POST /api/cards/pay-invoice ou /api/cartoes/pagar-fatura (Pagamento de fatura com saldo da conta)
  if (
    (url === '/api/cards/pay-invoice' || url === '/api/cartoes/pagar-fatura') &&
    method === 'POST'
  ) {
    try {
      const body = await parseJsonBody(req);
      const cardId = body?.cardId || body?.card_id;
      const accountId = body?.accountId || body?.account_id;
      const amount = Number(body?.amount || body?.valor);

      if (!cardId || !accountId || !amount || amount <= 0) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Campos "cardId", "accountId" e "amount" (> 0) são obrigatórios.',
        });
        return true;
      }

      const resultado = await processarPagamentoFatura(
        {
          cardId: String(cardId),
          accountId: String(accountId),
          amount,
          paidAt: body?.paidAt || body?.paid_at,
        },
        requestId
      );

      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao processar pagamento de fatura', { requestId, erro: err.message });
      sendJson(res, 400, {
        sucesso: false,
        mensagem: err.message || 'Erro ao processar pagamento de fatura.',
      });
      return true;
    }
  }

  // Rota: GET /api/investimentos (Consolidação de carteira, alocação e evolução)
  if (url === '/api/investimentos' && method === 'GET') {
    try {
      const dados = await obterDadosInvestimentosDashboard(requestId);
      sendJson(res, 200, {
        sucesso: true,
        dados,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter dados de investimentos', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao carregar dados de investimentos.',
      });
      return true;
    }
  }

  // Rota: POST /api/investimentos/ativos (Adicionar novo ativo de investimento)
  if (url === '/api/investimentos/ativos' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.ticker || !body?.institution || !body?.quantity || !body?.unitPrice) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Ticker, instituição, quantidade e preço unitário são obrigatórios.',
        });
        return true;
      }

      const resultado = await cadastrarAtivoInvestimento(body, requestId);
      sendJson(res, 201, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao cadastrar ativo de investimento', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao cadastrar ativo de investimento.',
      });
      return true;
    }
  }

  // Rota: POST /api/investimentos/ajustar-saldo (Ajuste rápido de saldo de instituição)
  if (url === '/api/investimentos/ajustar-saldo' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (body?.novoSaldo === undefined) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "novoSaldo" é obrigatório.',
        });
        return true;
      }

      const resultado = await ajustarSaldoInstituicao(body, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao ajustar saldo de instituição', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao ajustar saldo.',
      });
      return true;
    }
  }

  // Rota: POST /api/investimentos/editar-instituicao (Editar todas as informações da instituição)
  if (url === '/api/investimentos/editar-instituicao' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.accountId || !body?.name) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'Os campos "accountId" e "name" são obrigatórios.',
        });
        return true;
      }

      const resultado = await editarInstituicaoCompleta(body, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao editar instituição', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao editar instituição.',
      });
      return true;
    }
  }

  // Rota: POST /api/investimentos/remover-instituicao (Excluir instituição/conta)
  if (url === '/api/investimentos/remover-instituicao' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.accountId) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "accountId" é obrigatório.',
        });
        return true;
      }

      const resultado = await removerInstituicao(body.accountId, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao remover instituição', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao remover instituição.',
      });
      return true;
    }
  }

  // Rota: POST /api/investimentos/remover-ativo (Excluir ativo)
  if (url === '/api/investimentos/remover-ativo' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.assetId) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "assetId" é obrigatório.',
        });
        return true;
      }

      const resultado = await removerAtivo(body.assetId, requestId);
      sendJson(res, 200, resultado);
      return true;
    } catch (err: any) {
      log('error', 'Erro ao remover ativo', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao remover ativo.',
      });
      return true;
    }
  }

  // Rota: GET /api/investimentos/extrato (Extrato especializado em investimentos)
  if (url.startsWith('/api/investimentos/extrato') && method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const mesAno = parsedUrl.searchParams.get('mes') || undefined;
      const tipo = parsedUrl.searchParams.get('tipo') || undefined;
      const busca = parsedUrl.searchParams.get('busca') || undefined;

      const dados = await obterExtratoInvestimentos({ mesAno, tipo, busca }, requestId);
      sendJson(res, 200, {
        sucesso: true,
        dados,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter extrato de investimentos', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao carregar extrato de investimentos.',
      });
      return true;
    }
  }

  // Rota: GET /api/people (Lista pessoas no banco com seus saldos devedores)
  if (url.startsWith('/api/people') && method === 'GET') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const busca = parsedUrl.searchParams.get('busca') || parsedUrl.searchParams.get('q') || undefined;
      const mesAno = parsedUrl.searchParams.get('mes') || parsedUrl.searchParams.get('mesAno') || undefined;

      const pessoas = await listarPessoasComSaldos(busca, requestId, mesAno);
      sendJson(res, 200, {
        sucesso: true,
        dados: pessoas,
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao listar pessoas', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao listar pessoas do banco de dados.',
      });
      return true;
    }
  }

  // Rota: POST /api/people (Cadastra nova pessoa no banco)
  if (url === '/api/people' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "name" é obrigatório.',
        });
        return true;
      }

      const pessoa = await cadastrarNovaPessoa(body.name, requestId);
      sendJson(res, 201, {
        sucesso: true,
        dados: pessoa,
        mensagem: 'Pessoa cadastrada com sucesso no banco de dados!',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao cadastrar pessoa', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao cadastrar pessoa no banco.',
      });
      return true;
    }
  }

  // Rota: POST /api/debts/pay (Registra baixa/pagamento de dívida de pessoa)
  if (url === '/api/debts/pay' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { personId, nome, valor } = body || {};

      if (!valor || isNaN(Number(valor)) || Number(valor) <= 0) {
        sendJson(res, 400, {
          sucesso: false,
          mensagem: 'O campo "valor" deve ser um número positivo.',
        });
        return true;
      }

      const valorNumerico = Number(valor);

      if (personId) {
        await registrarPagamentoNoBanco(personId, valorNumerico, requestId);
        sendJson(res, 200, {
          sucesso: true,
          mensagem: `Pagamento de R$ ${valorNumerico.toFixed(2)} registrado com sucesso!`,
        });
        return true;
      }

      if (nome) {
        const resultado = await processarPagamento(nome, valorNumerico, requestId);
        sendJson(res, 200, {
          sucesso: true,
          dados: resultado,
          mensagem: 'Pagamento processado com sucesso!',
        });
        return true;
      }

      sendJson(res, 400, {
        sucesso: false,
        mensagem: 'É necessário informar "personId" ou "nome".',
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao registrar pagamento de dívida', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao registrar pagamento.',
      });
      return true;
    }
  }

  // Rota: GET /api/debts/summary (Resumo consolidado do topo de Quem Me Deve)
  if (url === '/api/debts/summary' && method === 'GET') {
    try {
      const saldos = await getSaldoTerceiros(requestId, true);
      const totalAReceber = saldos.reduce((acc, s) => acc + (s.valor || 0), 0);
      const pendentesCount = saldos.filter((s) => s.valor > 0).length;

      // Busca cartões para comparativo de fatura
      const cartoes = await obterCartoesDetalhados(requestId).catch(() => []);
      const cartaoPrincipal = cartoes.find((c: any) => c.is_default) || cartoes[0];
      const faturaCartao = cartaoPrincipal?.faturaAtual || 0;
      const percentualFatura = faturaCartao > 0 ? Math.round((totalAReceber / faturaCartao) * 100) : 0;

      sendJson(res, 200, {
        sucesso: true,
        dados: {
          totalAReceber,
          faturaCartao,
          nomeCartao: cartaoPrincipal?.name || 'Cartão Principal',
          percentualFatura,
          pendentesCount,
          totalPago: 350.0, // base estimada ou agregada
          devedores: saldos,
        },
      });
      return true;
    } catch (err: any) {
      log('error', 'Erro ao obter resumo de dívidas', { requestId, erro: err.message });
      sendJson(res, 500, {
        sucesso: false,
        mensagem: err.message || 'Erro ao obter resumo de cobranças.',
      });
      return true;
    }
  }

  // Rota: GET /health
  if (url === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'online', service: 'guara-core-service', timestamp: new Date().toISOString() });
    return true;
  }

  // Não é uma rota gerenciada pela API
  return false;
}
