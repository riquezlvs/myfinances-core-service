import { describe, it, expect } from 'vitest';
import { calcularParcelas } from '../../../src/services/transactions/installments';

describe('calcularParcelas', () => {
  it('deve dividir o valor em N parcelas iguais somando exatamente o total', () => {
    const parcelas = calcularParcelas(100, 3, '2026-09-05T12:00:00.000Z');

    expect(parcelas).toHaveLength(3);
    const soma = parcelas.reduce((acc, p) => acc + p.amount, 0);
    expect(soma).toBe(100);

    // 100 / 3 = 33.33 + 33.33 + 33.34
    expect(parcelas[0].amount).toBe(33.33);
    expect(parcelas[1].amount).toBe(33.33);
    expect(parcelas[2].amount).toBe(33.34);
  });

  it('deve numerar parcelas de 1 até N com sufixo correspondente', () => {
    const parcelas = calcularParcelas(60, 4, '2026-09-05T12:00:00.000Z');

    expect(parcelas.map((p) => p.installmentNumber)).toEqual([1, 2, 3, 4]);
    expect(parcelas.map((p) => p.installmentTotal)).toEqual([4, 4, 4, 4]);
    expect(parcelas.map((p) => p.descriptionSuffix)).toEqual(['(1/4)', '(2/4)', '(3/4)', '(4/4)']);
  });

  it('deve agrupar todas as parcelas sob o mesmo installmentGroupId', () => {
    const parcelas = calcularParcelas(90, 3, '2026-09-05T12:00:00.000Z');

    const grupos = new Set(parcelas.map((p) => p.installmentGroupId));
    expect(grupos.size).toBe(1);
  });

  it('deve incrementar o mês a cada parcela', () => {
    const parcelas = calcularParcelas(120, 3, '2026-01-15T10:00:00.000Z');

    expect(new Date(parcelas[0].occurredAt).getUTCMonth()).toBe(0); // jan
    expect(new Date(parcelas[1].occurredAt).getUTCMonth()).toBe(1); // fev
    expect(new Date(parcelas[2].occurredAt).getUTCMonth()).toBe(2); // mar
  });

  it('deve clampar dia para o último dia do mês (31/01 em 3x -> 28/02)', () => {
    const parcelas = calcularParcelas(300, 3, '2026-01-31T12:00:00.000Z');

    expect(new Date(parcelas[0].occurredAt).getUTCDate()).toBe(31);
    expect(new Date(parcelas[1].occurredAt).getUTCDate()).toBe(28); // fev 2026 não é bissexto
    expect(new Date(parcelas[2].occurredAt).getUTCDate()).toBe(31);
  });

  it('deve atravessar anos corretamente (compra em dezembro)', () => {
    const parcelas = calcularParcelas(30, 3, '2026-12-10T08:00:00.000Z');

    expect(new Date(parcelas[0].occurredAt).getUTCFullYear()).toBe(2026);
    expect(new Date(parcelas[0].occurredAt).getUTCMonth()).toBe(11);
    expect(new Date(parcelas[1].occurredAt).getUTCFullYear()).toBe(2027);
    expect(new Date(parcelas[1].occurredAt).getUTCMonth()).toBe(0);
    expect(new Date(parcelas[2].occurredAt).getUTCFullYear()).toBe(2027);
    expect(new Date(parcelas[2].occurredAt).getUTCMonth()).toBe(1);
  });

  it('deve preservar hora/minuto/segundo da data original', () => {
    const parcelas = calcularParcelas(50, 2, '2026-09-05T14:30:45.000Z');

    for (const p of parcelas) {
      const d = new Date(p.occurredAt);
      expect(d.getUTCHours()).toBe(14);
      expect(d.getUTCMinutes()).toBe(30);
      expect(d.getUTCSeconds()).toBe(45);
    }
  });

  it('deve lançar erro se installmentTotal < 2', () => {
    expect(() => calcularParcelas(100, 1, '2026-09-05T12:00:00.000Z')).toThrow(
      'calcularParcelas exige installmentTotal >= 2.'
    );
  });
});