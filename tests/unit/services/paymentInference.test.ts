// tests/unit/services/paymentInference.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cartao } from '../../../src/services/cards/cardService';

vi.mock('../../../src/services/cards/cardService', () => ({
  obterCartaoPrincipal: vi.fn(),
}));

import {
  inferirMetodoPagamento,
  categoriaEhBeneficio,
  cardTypeParaPaymentMethod,
} from '../../../src/services/cards/paymentInference';
import { obterCartaoPrincipal } from '../../../src/services/cards/cardService';
import type { ParsedTransaction } from '../../../src/types/transaction';

const mockObterPrincipal = vi.mocked(obterCartaoPrincipal);

function transacao(parcial: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    description: 'Almoço',
    total_amount: 50,
    category_id: 1,
    payment_method: null,
    occurred_at: new Date().toISOString(),
    my_share_amount: null,
    third_party_name: null,
    installment_total: null,
    ...parcial,
  } as ParsedTransaction;
}

function cartao(id: string, nome: string, tipo: Cartao['card_type']): Cartao {
  return { id, name: nome, card_type: tipo, closing_day: 20, is_default: true };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paymentInference — utilitários puros', () => {
  it('categoriaEhBeneficio reconhece alimentação/restaurantes/supermercado', () => {
    expect(categoriaEhBeneficio('Alimentação')).toBe(true);
    expect(categoriaEhBeneficio('Restaurantes')).toBe(true);
    expect(categoriaEhBeneficio('Supermercado')).toBe(true);
    expect(categoriaEhBeneficio('Transporte')).toBe(false);
    expect(categoriaEhBeneficio('Lazer')).toBe(false);
  });

  it('cardTypeParaPaymentMethod mapeia credit → credit_card e mantém vouchers', () => {
    expect(cardTypeParaPaymentMethod('credit')).toBe('credit_card');
    expect(cardTypeParaPaymentMethod('meal_voucher')).toBe('meal_voucher');
    expect(cardTypeParaPaymentMethod('food_voucher')).toBe('food_voucher');
  });
});

describe('paymentInference — inferirMetodoPagamento (decisão em código, nunca IA)', () => {
  it('respeita o método citado pela IA (origem ia) e não preenche card_id', async () => {
    const decisao = await inferirMetodoPagamento(
      transacao({ payment_method: 'pix' }),
      { 1: 'Alimentação' },
      'r1'
    );

    expect(decisao.payment_method).toBe('pix');
    expect(decisao.card_id).toBeNull();
    expect(decisao.aviso).toBeUndefined();
    expect(mockObterPrincipal).not.toHaveBeenCalled();
  });

  it('categoria de benefício sem método citado → vale principal (card_id preenchido em código)', async () => {
    mockObterPrincipal.mockResolvedValue(cartao('vr1', 'Alelo', 'meal_voucher'));

    const decisao = await inferirMetodoPagamento(
      transacao({ category_id: 1 }),
      { 1: 'Alimentação' },
      'r2'
    );

    expect(mockObterPrincipal).toHaveBeenCalledWith('meal_voucher', 'r2');
    expect(decisao.payment_method).toBe('meal_voucher');
    expect(decisao.card_id).toBe('vr1');
    expect(decisao.cartaoNome).toBe('Alelo');
    expect(decisao.aviso).toContain('Alelo');
  });

  it('sem vale principal → tenta vale-alimentação como segunda opção', async () => {
    mockObterPrincipal
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cartao('va1', 'Sodexo VA', 'food_voucher'));

    const decisao = await inferirMetodoPagamento(
      transacao({ category_id: 2 }),
      { 2: 'Supermercado' },
      'r3'
    );

    expect(mockObterPrincipal).toHaveBeenNthCalledWith(1, 'meal_voucher', 'r3');
    expect(mockObterPrincipal).toHaveBeenNthCalledWith(2, 'food_voucher', 'r3');
    expect(decisao.payment_method).toBe('food_voucher');
    expect(decisao.card_id).toBe('va1');
  });

  it('categoria comum sem método citado → cartão de crédito principal', async () => {
    mockObterPrincipal.mockResolvedValue(cartao('cc1', 'Nubank', 'credit'));

    const decisao = await inferirMetodoPagamento(
      transacao({ category_id: 3 }),
      { 3: 'Transporte' },
      'r4'
    );

    expect(mockObterPrincipal).toHaveBeenCalledWith('credit', 'r4');
    expect(decisao.payment_method).toBe('credit_card');
    expect(decisao.card_id).toBe('cc1');
  });

  it('sem cartão elegível → fallback neutro pix com aviso ao usuário', async () => {
    mockObterPrincipal.mockResolvedValue(null);

    const decisao = await inferirMetodoPagamento(
      transacao({ category_id: 3 }),
      { 3: 'Transporte' },
      'r5'
    );

    expect(decisao.payment_method).toBe('pix');
    expect(decisao.card_id).toBeNull();
    expect(decisao.aviso).toContain('Pix');
  });

  it('categoria inexistente no categoryMap não quebra (trata como comum)', async () => {
    mockObterPrincipal.mockResolvedValue(cartao('cc1', 'Nubank', 'credit'));

    const decisao = await inferirMetodoPagamento(
      transacao({ category_id: 999 }),
      {},
      'r6'
    );

    expect(mockObterPrincipal).toHaveBeenCalledWith('credit', 'r6');
    expect(decisao.payment_method).toBe('credit_card');
  });
});
