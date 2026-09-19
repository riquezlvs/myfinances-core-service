import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { log } from '../utils/logger';
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
import { obterDadosGraficosDashboard } from '../services/transactions/transactionService';
import { obterCartoesDetalhados, cadastrarNovoCartao, removerCartao } from '../services/cards/cardService';
import {
  obterDadosInvestimentosDashboard,
  cadastrarAtivoInvestimento,
  ajustarSaldoInstituicao,
  obterExtratoInvestimentos,
} from '../services/investments/investmentService';

/**
 * Utilitário para adicionar cabeçalhos CORS a todas as respostas HTTP
 */
function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Lê e parseia o corpo JSON de uma requisição HTTP
 */
async function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // Prevenção contra payloads gigantes (> 1MB)
      if (body.length > 1e6) {
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
      const [resumo, saldo, gastos, patrimonio, poupanca, graficos] = await Promise.all([
        obterResumoUnificado(requestId),
        obterSaldoUnificado(requestId),
        obterUltimosGastosUnificado(10, requestId),
        obterPatrimonioUnificado(requestId).catch(() => null),
        obterPoupancaUnificado(requestId).catch(() => null),
        obterDadosGraficosDashboard(requestId).catch((err) => {
          log('warn', 'Erro ao obter dados gráficos do dashboard', { erro: err.message });
          return null;
        }),
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

  // Rota: GET /health
  if (url === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'online', service: 'guara-core-service', timestamp: new Date().toISOString() });
    return true;
  }

  // Não é uma rota gerenciada pela API
  return false;
}
