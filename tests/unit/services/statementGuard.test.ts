import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validarExtrato } from '../../../src/services/gemini/guards/statementGuard';

describe('validarExtrato', () => {
  const categoryMap: Record<number, string> = {
    1: 'Alimentação',
    2: 'Transporte',
    3: 'Outros',
  };

  it('deve validar e formatar itens comuns de fatura', () => {
    const raw = {
      card_name_hint: 'Nubank',
      statement_date: '2026-09',
      items: [
        {
          description: 'Restaurante Bom Sabor',
          amount: 85.5,
          category_id: 1,
          date: '2026-09-02',
          installment_current: null,
          installment_total: null,
          is_payment_or_credit: false,
        },
        {
          description: 'Passagem Aérea',
          amount: 450,
          category_id: 2,
          date: '2026-09-03',
          installment_current: 2,
          installment_total: 6,
          is_payment_or_credit: false,
        },
      ],
    };

    const resultado = validarExtrato(raw, categoryMap, 'req-1');

    expect(resultado.card_name_hint).toBe('Nubank');
    expect(resultado.items).toHaveLength(2);
    expect(resultado.items[0]!.description).toBe('Restaurante Bom Sabor');
    expect(resultado.items[0]!.amount).toBe(85.5);
    expect(resultado.items[1]!.installment_current).toBe(2);
    expect(resultado.items[1]!.installment_total).toBe(6);
  });

  it('deve ignorar pagamentos de fatura e créditos', () => {
    const raw = {
      card_name_hint: 'Itaú',
      statement_date: '2026-09',
      items: [
        {
          description: 'Pagamento de fatura recebido',
          amount: 1500,
          category_id: 3,
          date: '2026-09-01',
          is_payment_or_credit: true,
        },
        {
          description: 'Supermercado Pão de Açúcar',
          amount: 120.4,
          category_id: 1,
          date: '2026-09-05',
          is_payment_or_credit: false,
        },
      ],
    };

    const resultado = validarExtrato(raw, categoryMap, 'req-1');

    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0]!.description).toBe('Supermercado Pão de Açúcar');
    expect(resultado.avisos.length).toBeGreaterThan(0);
    expect(resultado.avisos[0]).toContain('Pagamento de fatura recebido');
  });

  it('deve aplicar fallback para categoria desconhecida', () => {
    const raw = {
      items: [
        {
          description: 'Loja Desconhecida',
          amount: 50,
          category_id: 999, // não existe no categoryMap
          date: '2026-09-05',
          is_payment_or_credit: false,
        },
      ],
    };

    const resultado = validarExtrato(raw, categoryMap, 'req-1');

    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0]!.category_id).toBe(1);
  });
});
