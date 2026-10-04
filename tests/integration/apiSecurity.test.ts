import { describe, it, expect, beforeEach } from 'vitest';
import { handleApiRequest, resetarLimitesApi } from '../../src/api/routes';
import { gerarTokenLogin, limparTokensLogin } from '../../src/api/loginTokens';
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

function mockReq(url: string, method = 'GET', bodyObj?: any, headers: Record<string, string> = {}): IncomingMessage {
  const stream = new Readable({
    read() {
      if (bodyObj !== undefined) {
        this.push(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj));
      }
      this.push(null);
    },
  });
  (stream as any).url = url;
  (stream as any).method = method;
  (stream as any).headers = headers;
  return stream as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; getBody: () => any; getStatus: () => number; getHeaders: () => Record<string, string> } {
  let statusCode = 200;
  let bodyData = '';
  const headers: Record<string, string> = {};
  const res: any = {
    writeHead: (code: number) => {
      statusCode = code;
    },
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    },
    end: (data?: any) => {
      if (data) bodyData += data;
    },
  };
  return {
    res: res as ServerResponse,
    getStatus: () => statusCode,
    getBody: () => (bodyData ? JSON.parse(bodyData) : {}),
    getHeaders: () => headers,
  };
}

describe('Blindagem de Segurança da API HTTP', () => {
  beforeEach(() => {
    resetarLimitesApi();
    limparTokensLogin();
  });

  it('permite rota pública /health sem token de autorização', async () => {
    const req = mockReq('/health', 'GET');
    const { res, getStatus, getBody, getHeaders } = mockRes();
    const tratou = await handleApiRequest(req, res);

    expect(tratou).toBe(true);
    expect(getStatus()).toBe(200);
    expect(getBody().status).toBe('online');
    expect(getHeaders()['x-content-type-options']).toBe('nosniff');
    expect(getHeaders()['x-frame-options']).toBe('DENY');
  });

  it('bloqueia requisição a /api/dashboard sem header Authorization com 401', async () => {
    const req = mockReq('/api/dashboard', 'GET');
    const { res, getStatus, getBody } = mockRes();
    const tratou = await handleApiRequest(req, res);

    expect(tratou).toBe(true);
    expect(getStatus()).toBe(401);
    expect(getBody().sucesso).toBe(false);
  });

  it('bloqueia token inválido com 401', async () => {
    const req = mockReq('/api/dashboard', 'GET', undefined, { authorization: 'Bearer token-falso' });
    const { res, getStatus } = mockRes();
    await handleApiRequest(req, res);

    expect(getStatus()).toBe(401);
  });

  it('valida token de login mágico gerado pelo Telegram e invalida no reuso', async () => {
    const { token } = gerarTokenLogin();
    const secret = process.env.API_SECRET_KEY!;

    // 1ª tentativa com token válido
    const req1 = mockReq('/api/auth/telegram-verify', 'POST', { token }, { authorization: `Bearer ${secret}` });
    const { res: res1, getStatus: getStatus1, getBody: getBody1 } = mockRes();
    await handleApiRequest(req1, res1);

    expect(getStatus1()).toBe(200);
    expect(getBody1().sucesso).toBe(true);

    // 2ª tentativa com o mesmo token (deve ser rejeitado: uso único)
    const req2 = mockReq('/api/auth/telegram-verify', 'POST', { token }, { authorization: `Bearer ${secret}` });
    const { res: res2, getStatus: getStatus2 } = mockRes();
    await handleApiRequest(req2, res2);

    expect(getStatus2()).toBe(401);
  });

  it('rejeita payload JSON excessivo com 400', async () => {
    const secret = process.env.API_SECRET_KEY!;
    const payloadGrande = 'a'.repeat(2 * 1024 * 1024); // 2MB
    const req = mockReq('/api/chat', 'POST', payloadGrande, {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    });
    const { res, getStatus } = mockRes();
    await handleApiRequest(req, res);

    expect(getStatus()).toBe(400);
  });
});
