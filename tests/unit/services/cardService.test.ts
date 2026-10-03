import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcularPeriodoFatura,
  gerarCiclosFatura,
  listarCartoes,
  definirCartao,
  getFaturaDoPeriodo,
  removerCartao,
  extrairCicloDasNotas,
  obterFaturasDetalhadasDoCartao,
  processarPagamentoFatura,
  estornarPagamentoFatura,
} from '../../../src/services/cards/cardService';

const mockFrom = vi.fn();
vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('../../../src/services/accounts/accountService', () => ({
  obterContaPorId: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'Conta Principal', balance: 5000 }),
  obterContaPorNome: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'Conta Principal', balance: 5000 }),
  debitarSaldo: vi.fn().mockResolvedValue(4000),
  creditarSaldo: vi.fn().mockResolvedValue(5000),
}));

function builder(opts: { data?: unknown; error?: unknown; single?: unknown; maybeSingle?: unknown } = {}) {
  const b: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: opts.maybeSingle ?? null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: opts.single ?? null, error: null })),
  };
  b.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null }).then(onFulfilled);
  return b;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe('calcularPeriodoFatura (função pura)', () => {
  it('quando hoje <= closing_day: fatura começou no fechamento anterior', () => {
    // Hoje: 10/09/2026, fechamento dia 20 → fatura: 21/08 → 20/09.
    const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 10));

    expect(periodo.inicio.getDate()).toBe(21);
    expect(periodo.inicio.getMonth()).toBe(7); // agosto
    expect(periodo.fim.getDate()).toBe(21);
    expect(periodo.fim.getMonth()).toBe(8); // setembro (fim é exclusivo)
    expect(periodo.fechamento.getDate()).toBe(20);
    expect(periodo.fechamento.getMonth()).toBe(8);
  });

  it('quando hoje > closing_day: fatura fecha no mês seguinte', () => {
    // Hoje: 25/09/2026, fechamento dia 20 → fatura: 21/09 → 20/10.
    const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 25));

    expect(periodo.inicio.getDate()).toBe(21);
    expect(periodo.inicio.getMonth()).toBe(8);
    expect(periodo.fim.getMonth()).toBe(9); // outubro
    expect(periodo.fim.getDate()).toBe(21);
    expect(periodo.fechamento.getMonth()).toBe(9);
    expect(periodo.fechamento.getDate()).toBe(20);
  });

  it('no próprio dia do fechamento, a fatura fecha hoje', () => {
    const periodo = calcularPeriodoFatura(15, new Date(2026, 8, 15));
    expect(periodo.fechamento.getDate()).toBe(15);
    expect(periodo.fechamento.getMonth()).toBe(8);
  });

  it('fechamento dia 1: período vai de dia 2 do mês atual ao dia 1 do próximo', () => {
    // Hoje 10/09, fechamento dia 1 → fatura atual: 02/09 → 01/10.
    const periodo = calcularPeriodoFatura(1, new Date(2026, 8, 10));
    expect(periodo.inicio.getDate()).toBe(2);
    expect(periodo.inicio.getMonth()).toBe(8);
    expect(periodo.fim.getDate()).toBe(2);
    expect(periodo.fim.getMonth()).toBe(9);
    expect(periodo.fechamento.getDate()).toBe(1);
    expect(periodo.fechamento.getMonth()).toBe(9);
  });

  it('fechamento dia 31 em mês de 31 dias (janeiro): fecha no dia 31 e novo ciclo inicia no dia 1', () => {
    // Hoje: 15/01/2026, fechamento dia 31
    const periodo = calcularPeriodoFatura(31, new Date(2026, 0, 15));
    expect(periodo.fechamento.getDate()).toBe(31);
    expect(periodo.fechamento.getMonth()).toBe(0); // janeiro
    expect(periodo.inicio.getDate()).toBe(1); // 31 de dez + 1 = 1 de jan
    expect(periodo.inicio.getMonth()).toBe(0);
    expect(periodo.fim.getDate()).toBe(1); // 1 de fev
    expect(periodo.fim.getMonth()).toBe(1);
  });

  it('fechamento dia 31 em mês curto (fevereiro): clampa para 28 e fecha no último dia', () => {
    // 2026 não é bissexto: fevereiro tem 28 dias
    // Hoje: 10/02/2026, fechamento dia 31
    const periodo = calcularPeriodoFatura(31, new Date(2026, 1, 10));
    expect(periodo.fechamento.getDate()).toBe(28);
    expect(periodo.fechamento.getMonth()).toBe(1); // fevereiro
    expect(periodo.inicio.getDate()).toBe(1); // 31 de jan + 1 = 1 de fev
    expect(periodo.inicio.getMonth()).toBe(1);
  });

  it('fechamento dia 31 em mês de 30 dias (abril): clampa para 30', () => {
    // Hoje: 15/04/2026, fechamento dia 31
    const periodo = calcularPeriodoFatura(31, new Date(2026, 3, 15));
    expect(periodo.fechamento.getDate()).toBe(30);
    expect(periodo.fechamento.getMonth()).toBe(3); // abril
    expect(periodo.inicio.getDate()).toBe(1); // 31 de mar + 1 = 1 de abr
    expect(periodo.inicio.getMonth()).toBe(3);
  });
});

describe('listarCartoes / definirCartao / removerCartao', () => {
  it('deve listar cartões ordenados por fechamento', async () => {
    mockFrom.mockImplementationOnce(() =>
      builder({
        data: [
          { id: 'c1', name: 'nubank', closing_day: 20 },
          { id: 'c2', name: 'inter', closing_day: 5 },
        ],
      })
    );

    const cartoes = await listarCartoes('req-1');
    expect(cartoes).toHaveLength(2);
    expect(cartoes[0].name).toBe('nubank');
  });

  it('deve fazer upsert do cartão e retornar o registro', async () => {
    const b = builder({
      single: { id: 'c1', name: 'nubank', closing_day: 20, card_type: 'credit', is_default: true },
    });
    mockFrom.mockImplementationOnce(() => b);

    const cartao = await definirCartao('nubank', 20, 'req-1');

    expect(cartao.name).toBe('nubank');
    expect(cartao.is_default).toBe(true);
    expect(b.upsert).toHaveBeenCalledWith(
      { name: 'nubank', closing_day: 20, card_type: 'credit' },
      { onConflict: 'name' }
    );
  });

  it('8.2 — deve gravar vale-refeição com o tipo informado', async () => {
    const b = builder({
      single: {
        id: 'c2',
        name: 'alelo',
        closing_day: 5,
        card_type: 'meal_voucher',
        is_default: true,
      },
    });
    mockFrom.mockImplementationOnce(() => b);

    const cartao = await definirCartao('alelo', 5, 'req-1', 'meal_voucher');

    expect(cartao.card_type).toBe('meal_voucher');
    expect(b.upsert).toHaveBeenCalledWith(
      { name: 'alelo', closing_day: 5, card_type: 'meal_voucher' },
      { onConflict: 'name' }
    );
  });

  it('8.2 — primeiro cartão do tipo se torna o principal automaticamente', async () => {
    const bUpsert = builder({
      single: {
        id: 'c3',
        name: 'sodexo',
        closing_day: 10,
        card_type: 'food_voucher',
        is_default: false,
      },
    });
    const bPrincipal = builder({ maybeSingle: null }); // nenhum principal do tipo ainda
    const bUpdate = builder(); // update is_default = true
    mockFrom.mockImplementationOnce(() => bUpsert);
    mockFrom.mockImplementationOnce(() => bPrincipal);
    mockFrom.mockImplementationOnce(() => bUpdate);

    const cartao = await definirCartao('sodexo', 10, 'req-1', 'food_voucher');

    expect(cartao.is_default).toBe(true);
    expect(bUpdate.update).toHaveBeenCalledWith({ is_default: true });
  });

  it('deve remover cartão pelo nome', async () => {
    const b = builder({ maybeSingle: { name: 'nubank' } });
    mockFrom.mockImplementationOnce(() => b);

    const removido = await removerCartao('nubank', 'req-1');
    expect(removido).toBe('nubank');
    expect(b.eq).toHaveBeenCalledWith('name', 'nubank');
  });

  it('deve retornar null ao remover cartão inexistente', async () => {
    mockFrom.mockImplementationOnce(() => builder({ maybeSingle: null }));

    const removido = await removerCartao('fantasma', 'req-1');
    expect(removido).toBeNull();
  });
});

describe('getFaturaDoPeriodo', () => {
  const periodo = calcularPeriodoFatura(20, new Date(2026, 8, 10));

  it('cartão padrão inclui gastos credit_card sem card_id (or)', async () => {
    const b = builder({ data: [{ display_id: 1, total_amount: 100 }] });
    mockFrom.mockImplementationOnce(() => b);

    const itens = await getFaturaDoPeriodo('c1', periodo, true, 'req-1');

    expect(itens).toHaveLength(1);
    expect(b.or).toHaveBeenCalledWith('card_id.eq.c1,card_id.is.null');
    // Período respeitado: gte no início, lt no fim.
    expect(b.gte).toHaveBeenCalledWith('occurred_at', periodo.inicio.toISOString());
    expect(b.lt).toHaveBeenCalledWith('occurred_at', periodo.fim.toISOString());
  });

  it('cartão não-padrão filtra apenas pelo próprio card_id', async () => {
    const b = builder({ data: [] });
    mockFrom.mockImplementationOnce(() => b);

    await getFaturaDoPeriodo('c2', periodo, false, 'req-1');

    expect(b.or).not.toHaveBeenCalled();
    expect(b.eq).toHaveBeenCalledWith('card_id', 'c2');
  });

  it('deve propagar erro do Supabase', async () => {
    mockFrom.mockImplementationOnce(() => builder({ error: { message: 'boom' } }));

    await expect(getFaturaDoPeriodo('c1', periodo, true, 'req-1')).rejects.toThrow(
      'Erro ao buscar fatura do cartão: boom'
    );
  });
});

describe('gerarCiclosFatura (Multi-ciclos e próximas faturas)', () => {
  it('quando hoje <= closing_day, gera ciclo atual aberto e faturas futuras', () => {
    const agora = new Date(2026, 9, 10);
    const ciclos = gerarCiclosFatura(25, 5, agora);

    expect(ciclos.length).toBeGreaterThanOrEqual(4);
    const cicloAtual = ciclos.find((c) => c.id === '2026-10');
    expect(cicloAtual).toBeDefined();
    expect(cicloAtual?.statusPadrao).toBe('aberta');
    expect(cicloAtual?.rotulo).toBe('Outubro');

    const cicloSeguinte = ciclos.find((c) => c.id === '2026-11');
    expect(cicloSeguinte).toBeDefined();
    expect(cicloSeguinte?.statusPadrao).toBe('futura');
    expect(cicloSeguinte?.rotulo).toBe('Novembro');
  });

  it('quando hoje > closing_day, marca o ciclo que fechou como fechada e o próximo como aberta', () => {
    const agora = new Date(2026, 9, 28);
    const ciclos = gerarCiclosFatura(25, 5, agora);

    const cicloOutubro = ciclos.find((c) => c.id === '2026-10');
    expect(cicloOutubro).toBeDefined();
    expect(cicloOutubro?.statusPadrao).toBe('fechada');

    const cicloNovembro = ciclos.find((c) => c.id === '2026-11');
    expect(cicloNovembro).toBeDefined();
    expect(cicloNovembro?.statusPadrao).toBe('aberta');
  });
});

describe('extrairCicloDasNotas', () => {
  it('deve extrair o ciclo a partir da tag [ciclo:YYYY-MM]', () => {
    expect(extrairCicloDasNotas('Pagamento de fatura • Nubank [ciclo:2026-09]')).toBe('2026-09');
    expect(extrairCicloDasNotas('Fatura paga [ciclo:2026-10]')).toBe('2026-10');
  });

  it('deve retornar null se não houver tag no texto ou se notes for nulo', () => {
    expect(extrairCicloDasNotas('Pagamento simples sem tag')).toBeNull();
    expect(extrairCicloDasNotas(null)).toBeNull();
    expect(extrairCicloDasNotas(undefined)).toBeNull();
  });
});

describe('obterFaturasDetalhadasDoCartao com billing_cycle', () => {
  it('pagamento feito em Outubro com billing_cycle 2026-09 deve abater a fatura de Setembro', async () => {
    // 02/10/2026
    const agora = new Date(2026, 9, 2);
    const card = {
      id: 'card-1',
      name: 'Nubank',
      closing_day: 25,
      due_day: 5,
      card_type: 'credit' as const,
      is_default: true,
      credit_limit: 5000,
    };

    // Compras em Setembro (fechamento 25/09)
    const comprasMock = builder({
      data: [
        {
          display_id: 101,
          description: 'Mercado Setembro',
          total_amount: 350.0,
          occurred_at: '2026-09-10T12:00:00Z',
          installment_number: null,
          installment_total: null,
          card_id: 'card-1',
        },
      ],
    });

    // Pagamento realizado em 02/10/2026 com billing_cycle explicitamente 2026-09
    const pagamentosMock = builder({
      data: [
        {
          id: 'pay-setembro-1',
          amount: 350.0,
          paid_at: '2026-10-02T15:00:00Z',
          account_id: 'acc-1',
          billing_cycle: '2026-09',
          notes: 'Pagamento de fatura • Nubank [ciclo:2026-09]',
        },
      ],
    });

    mockFrom.mockImplementationOnce(() => comprasMock);
    mockFrom.mockImplementationOnce(() => pagamentosMock);

    const faturas = await obterFaturasDetalhadasDoCartao(card, true, 'req-test', agora);

    const faturaSetembro = faturas.find((f) => f.id === '2026-09');
    expect(faturaSetembro).toBeDefined();
    expect(faturaSetembro?.totalCompras).toBe(350);
    expect(faturaSetembro?.totalPago).toBe(350);
    expect(faturaSetembro?.valorFatura).toBe(0);
    expect(faturaSetembro?.status).toBe('paga');
    expect(faturaSetembro?.itens[0]?.payment_id).toBe('pay-setembro-1');

    // Fatura de Outubro não deve ter sido abatida pelo pagamento de Setembro
    const faturaOutubro = faturas.find((f) => f.id === '2026-10');
    expect(faturaOutubro).toBeDefined();
    expect(faturaOutubro?.totalPago).toBe(0);
  });
});

describe('estornarPagamentoFatura', () => {
  it('deve devolver o saldo para a conta, excluir o pagamento e a transação', async () => {
    const paymentRow = {
      id: 'pay-errado-1',
      card_id: 'card-1',
      account_id: 'acc-1',
      amount: 450.0,
      paid_at: '2026-10-02T10:00:00Z',
      notes: 'Pagamento de fatura • Nubank',
    };

    // 1. Busca pagamento por paymentId
    const bFindPayment = builder({ maybeSingle: paymentRow });
    // 2. Busca cartão
    const bFindCard = builder({ maybeSingle: { id: 'card-1', name: 'Nubank' } });
    // 3. Delete transaction
    const bDelTx = builder();
    // 4. Delete invoice_payments
    const bDelPay = builder({ error: null });

    mockFrom.mockImplementationOnce(() => bFindPayment);
    mockFrom.mockImplementationOnce(() => bFindCard);
    mockFrom.mockImplementationOnce(() => bDelTx);
    mockFrom.mockImplementationOnce(() => bDelPay);

    const res = await estornarPagamentoFatura({ paymentId: 'pay-errado-1' }, 'req-estorno');

    expect(res.sucesso).toBe(true);
    expect(res.amountEstornado).toBe(450.0);
    expect(res.cardName).toBe('Nubank');
    expect(res.accountName).toBe('Conta Principal');
    expect(res.novoSaldoConta).toBe(5000);
  });
});

describe('processarPagamentoFatura com patrimônio', () => {
  it('deve debitar diretamente de conta de patrimônio (fixed_income) sem transferência prévia', async () => {
    const caixinhaId = 'a0000000-0000-0000-0000-000000000001';
    const { obterContaPorId, obterContaPorNome } = await import('../../../src/services/accounts/accountService');
    const contaMock = {
      id: caixinhaId,
      name: 'Nubank Caixinha Reserva',
      type: 'fixed_income',
      balance: 10000,
    };
    (obterContaPorId as any).mockResolvedValueOnce(contaMock);
    (obterContaPorNome as any).mockResolvedValueOnce(contaMock);

    // 1. Busca cartão
    const bCard = builder({ maybeSingle: { id: 'card-1', name: 'Nubank', closing_day: 25, due_day: 5, credit_limit: 5000 } });
    // 2. Insert invoice_payments
    const bPay = builder();
    // 3. Select category
    const bCat = builder({ single: { id: 1 } });
    // 4. Insert transactions
    const bTx = builder();
    // 5. obterFaturasDetalhadasDoCartao -> transações
    const bTransacoes = builder({ data: [] });
    // 6. obterFaturasDetalhadasDoCartao -> pagamentos
    const bPagamentos = builder({ data: [] });

    mockFrom.mockImplementationOnce(() => bCard);
    mockFrom.mockImplementationOnce(() => bPay);
    mockFrom.mockImplementationOnce(() => bCat);
    mockFrom.mockImplementationOnce(() => bTx);
    mockFrom.mockImplementationOnce(() => bTransacoes);
    mockFrom.mockImplementationOnce(() => bPagamentos);

    const res = await processarPagamentoFatura(
      {
        cardId: 'card-1',
        accountId: caixinhaId,
        amount: 800,
        billingCycle: '2026-09',
      },
      'req-patrimonio'
    );

    expect(res.sucesso).toBe(true);
    expect(res.isPatrimonio).toBe(true);
    expect(res.accountType).toBe('fixed_income');
    expect(res.accountName).toBe('Nubank Caixinha Reserva');
    expect(res.mensagem).toContain('direto do seu patrimônio');
  });
});