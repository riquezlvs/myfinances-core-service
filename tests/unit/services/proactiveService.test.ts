import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  montarMensagemLembrete,
  enviarLembreteMensal,
  iniciarCronLembreteMensal,
} from '../../../src/services/recurring/proactiveService';

// Mocks: Supabase (via serviços), cron e bot.
const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

import cron from 'node-cron';
const mockSchedule = vi.mocked(cron.schedule);

function builder(opts: { data?: unknown; error?: unknown } = {}) {
  const b: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  b.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null }).then(onFulfilled);
  return b;
}

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as any;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSchedule.mockReset();
});

describe('montarMensagemLembrete', () => {
  it('deve montar mensagem com fatura e dívidas', () => {
    const msg = montarMensagemLembrete(
      [
        { display_id: 1, description: 'Mercado', total_amount: 250, occurred_at: '2026-09-02T12:00:00Z' },
        { display_id: 2, description: 'Netflix', total_amount: 39.9, occurred_at: '2026-09-05T12:00:00Z' },
      ],
      [{ nome: 'Irmã', valor: 70 }]
    );

    expect(msg).toContain('Lembrete mensal');
    expect(msg).toContain('Mercado');
    expect(msg).toContain('Total: R$ 289,90');
    expect(msg).toContain('Irmã: R$ 70,00');
  });

  it('deve lidar com mês sem fatura e sem dívidas', () => {
    const msg = montarMensagemLembrete([], []);

    expect(msg).toContain('Nenhum lançamento no cartão');
    expect(msg).toContain('Ninguém te deve nada');
  });

  it('deve resumir a fatura quando há mais de 5 lançamentos', () => {
    const itens = Array.from({ length: 8 }, (_, i) => ({
      display_id: i + 1,
      description: `Gasto ${i + 1}`,
      total_amount: 10,
      occurred_at: '2026-09-02T12:00:00Z',
    }));

    const msg = montarMensagemLembrete(itens, []);
    expect(msg).toContain('e mais 3 lançamento(s)');
    expect(msg).toContain('Total: R$ 80,00');
  });
});

describe('enviarLembreteMensal', () => {
  it('deve buscar fatura + dívidas e enviar a mensagem', async () => {
    mockFrom
      .mockImplementationOnce(() =>
        builder({ data: [{ display_id: 1, description: 'Mercado', total_amount: 250, occurred_at: '2026-09-02T12:00:00Z' }] })
      )
      .mockImplementationOnce(() => builder({ data: [] })) // pagamentos (getSaldoTerceiros)
      .mockImplementationOnce(() =>
        builder({ data: [{ third_party_id: 'p1', third_party_share_amount: 70, people: { name: 'Irmã' } }] })
      );

    const bot = criarBotMock();
    await enviarLembreteMensal(999, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, texto] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe(999);
    expect(texto).toContain('Lembrete mensal');
    expect(texto).toContain('Mercado');
  });
});

describe('iniciarCronLembreteMensal', () => {
  it('deve agendar o cron mensal (dia 1º às 08:00) e engolir erros', async () => {
    mockSchedule.mockReturnValue({ stop: vi.fn() } as any);

    iniciarCronLembreteMensal();

    expect(mockSchedule).toHaveBeenCalledWith('0 8 1 * *', expect.any(Function));

    // O callback não deve propagar exceções (senão derruba o processo).
    const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
    mockFrom.mockImplementation(() => builder({ error: { message: 'boom' } }));
    await expect(callback()).resolves.toBeUndefined();
  });
});