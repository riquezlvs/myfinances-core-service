import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApiRequest } from '../../src/api/routes';
import type { IncomingMessage, ServerResponse } from 'http';

const mockFrom = vi.fn();
vi.mock('../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

function mockReq(url: string, method = 'GET'): IncomingMessage {
  return {
    url,
    method,
    headers: {},
  } as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; getBody: () => any; getStatus: () => number } {
  let statusCode = 200;
  let bodyData = '';
  const res: any = {
    writeHead: vi.fn((code: number) => {
      statusCode = code;
    }),
    setHeader: vi.fn(),
    end: vi.fn((data?: string) => {
      if (data) bodyData += data;
    }),
  };
  return {
    res: res as ServerResponse,
    getStatus: () => statusCode,
    getBody: () => (bodyData ? JSON.parse(bodyData) : null),
  };
}

describe('API: GET /api/extrato com ID e Query Params', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('deve buscar transação individual com query param ?id=101', async () => {
    const singleTx = {
      id: 'tx-uuid-1',
      display_id: 101,
      description: 'Café Expresso',
      total_amount: 12.5,
      occurred_at: '2026-09-15T10:00:00Z',
      payment_method: 'pix',
      entry_type: 'expense',
      observation: 'Café com cliente',
      categories: { id: 1, name: 'Alimentação' },
      accounts: { id: 'acc-1', name: 'Nubank', type: 'checking' },
    };

    const maybeSingleMock = vi.fn().mockResolvedValue({ data: singleTx, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return { select: selectMock };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = mockReq('/api/extrato?id=101');
    const { res, getBody, getStatus } = mockRes();

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);

    const body = getBody();
    expect(body.sucesso).toBe(true);
    expect(body.dados.totalLancamentos).toBe(1);
    expect(body.dados.itens).toHaveLength(1);
    expect(body.dados.itens[0].display_id).toBe(101);
    expect(body.dados.itens[0].description).toBe('Café Expresso');
    expect(eqMock).toHaveBeenCalledWith('display_id', 101);
  });

  it('deve buscar transação individual via path /api/extrato/102', async () => {
    const singleTx = {
      id: 'tx-uuid-2',
      display_id: 102,
      description: 'Almoço',
      total_amount: 45.0,
      occurred_at: '2026-09-16T12:30:00Z',
      payment_method: 'pix',
      entry_type: 'expense',
      categories: { id: 1, name: 'Alimentação' },
      accounts: { id: 'acc-1', name: 'Nubank', type: 'checking' },
    };

    const maybeSingleMock = vi.fn().mockResolvedValue({ data: singleTx, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return { select: selectMock };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = mockReq('/api/extrato/102');
    const { res, getBody, getStatus } = mockRes();

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);

    const body = getBody();
    expect(body.sucesso).toBe(true);
    expect(body.dados.itens[0].display_id).toBe(102);
    expect(eqMock).toHaveBeenCalledWith('display_id', 102);
  });

  it('deve fazer fallback com sucesso caso a coluna observation não exista no banco', async () => {
    const singleTxFallback = {
      id: 'tx-uuid-3',
      display_id: 103,
      description: 'Supermercado',
      total_amount: 320.0,
      occurred_at: '2026-09-18T18:00:00Z',
      payment_method: 'credit_card',
      entry_type: 'expense',
      categories: { id: 2, name: 'Mercado' },
      accounts: { id: 'acc-1', name: 'Nubank', type: 'checking' },
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return {
          select: vi.fn().mockImplementation((fields: string) => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(async () => {
                callCount++;
                if (fields.includes('observation')) {
                  // Simula erro 400 do PostgREST quando coluna não existe
                  return { data: null, error: { message: 'column transactions.observation does not exist' } };
                }
                return { data: singleTxFallback, error: null };
              }),
            }),
          })),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = mockReq('/api/extrato?id=103');
    const { res, getBody, getStatus } = mockRes();

    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);

    const body = getBody();
    expect(body.sucesso).toBe(true);
    expect(body.dados.itens).toHaveLength(1);
    expect(body.dados.itens[0].display_id).toBe(103);
    expect(body.dados.itens[0].observation).toBeNull();
  });
});
