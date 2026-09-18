import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { log } from '../utils/logger';
import { processarTextoEntrada, obterResumoUnificado, obterSaldoUnificado, obterUltimosGastosUnificado } from '../core/engine';

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
      const [resumo, saldo, gastos] = await Promise.all([
        obterResumoUnificado(requestId),
        obterSaldoUnificado(requestId),
        obterUltimosGastosUnificado(10, requestId),
      ]);

      sendJson(res, 200, {
        sucesso: true,
        data: {
          resumo: resumo.dados,
          saldo: saldo.dados,
          recentes: gastos.dados?.gastos || [],
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

  // Rota: GET /health
  if (url === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'online', service: 'guara-core-service', timestamp: new Date().toISOString() });
    return true;
  }

  // Não é uma rota gerenciada pela API
  return false;
}
