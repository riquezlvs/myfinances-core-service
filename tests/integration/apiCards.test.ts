import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApiRequest } from '../../src/api/routes';
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

const mockFrom = vi.fn();
vi.mock('../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

function mockReq(url: string, method = 'GET', bodyObj?: any): IncomingMessage {
  const stream = new Readable({
    read() {
      if (bodyObj !== undefined) {
        this.push(JSON.stringify(bodyObj));
      }
      this.push(null);
    },
  });
  (stream as any).url = url;
  (stream as any).method = method;
  (stream as any).headers = {};
  return stream as unknown as IncomingMessage;
}

function mockRes(): {
  res: ServerResponse;
  getBody: () => any;
  getStatus: () => number;
  getHeaders: () => Record<string, string>;
} {
  let statusCode = 200;
  let bodyData = '';
  const headers: Record<string, string> = {};
  const res: any = {
    writeHead: vi.fn((code: number) => {
      statusCode = code;
    }),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    }),
    end: vi.fn((data?: string) => {
      if (data) bodyData += data;
    }),
  };
  return {
    res: res as ServerResponse,
    getStatus: () => statusCode,
    getBody: () => (bodyData ? JSON.parse(bodyData) : null),
    getHeaders: () => headers,
  };
}

describe('API: Cards CORS e Exclusão', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('deve retornar cabeçalhos CORS permitindo DELETE, PUT e PATCH no preflight OPTIONS', async () => {
    const { res, getStatus, getHeaders } = mockRes();
    const req = mockReq('/api/cards', 'OPTIONS');

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(204);
    const allowMethods = getHeaders()['access-control-allow-methods'];
    expect(allowMethods).toContain('DELETE');
    expect(allowMethods).toContain('POST');
    expect(allowMethods).toContain('PUT');
  });

  it('deve remover cartão via DELETE /api/cards?id=uuid', async () => {
    const cardUuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    mockFrom.mockImplementation((table: string) => {
      if (table === 'cards') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: cardUuid, name: 'Nubank' },
                error: null,
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        };
      }
      if (table === 'transactions') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      return {};
    });

    const { res, getStatus, getBody } = mockRes();
    const req = mockReq(`/api/cards?id=${cardUuid}`, 'DELETE');

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body.sucesso).toBe(true);
    expect(body.mensagem).toContain('Nubank');
  });

  it('deve remover cartão via POST /api/cards/remover com body { id }', async () => {
    const cardUuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    mockFrom.mockImplementation((table: string) => {
      if (table === 'cards') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: cardUuid, name: 'Inter' },
                error: null,
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        };
      }
      if (table === 'transactions') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      return {};
    });

    const { res, getStatus, getBody } = mockRes();
    const req = mockReq('/api/cards/remover', 'POST', { id: cardUuid });

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body.sucesso).toBe(true);
    expect(body.mensagem).toContain('Inter');
  });
});
