import { describe, it, expect } from 'vitest';
import { formatarReal, formatarDataCurta, formatarPagamento } from '../../../src/utils/formatters';
import type { ResultadoPagamento } from '../../../src/types/transaction';

describe('formatarReal', () => {
  it('deve formatar número inteiro com duas casas decimais', () => {
    expect(formatarReal(25)).toBe('25,00');
  });

  it('deve formatar valor com separador de milhar', () => {
    expect(formatarReal(1234.5)).toBe('1.234,50');
  });

  it('deve formatar decimal com vírgula', () => {
    expect(formatarReal(10.1)).toBe('10,10');
  });

  it('deve formatar zero', () => {
    expect(formatarReal(0)).toBe('0,00');
  });

  it('deve formatar centavos', () => {
    expect(formatarReal(0.05)).toBe('0,05');
  });
});

describe('formatarDataCurta', () => {
  it('deve formatar ISO como dd/mm', () => {
    expect(formatarDataCurta('2026-09-05T12:00:00.000Z')).toBe('05/09');
  });

  it('deve preencher com zero dia e mês de um dígito', () => {
    expect(formatarDataCurta('2026-03-07T12:00:00.000Z')).toBe('07/03');
  });
});

describe('formatarPagamento', () => {
  it('deve formatar pessoa não encontrada', () => {
    const resultado: ResultadoPagamento = { status: 'pessoa_nao_encontrada', nome: 'João' };
    expect(formatarPagamento(resultado)).toBe(
      '❓ Não encontrei ninguém chamado "João" nos seus registros.'
    );
  });

  it('deve formatar sem dívida', () => {
    const resultado: ResultadoPagamento = { status: 'sem_divida', nome: 'Maria' };
    expect(formatarPagamento(resultado)).toBe('✅ Maria já não tem nenhuma dívida em aberto.');
  });

  it('deve formatar quitado', () => {
    const resultado: ResultadoPagamento = { status: 'quitado', nome: 'Irmã', valorPago: 25.5 };
    expect(formatarPagamento(resultado)).toBe(
      '✅ Quitado! Irmã pagou R$ 25,50 e não deve mais nada.'
    );
  });

  it('deve formatar quitado com aviso de valor ajustado', () => {
    const resultado: ResultadoPagamento = {
      status: 'quitado',
      nome: 'Irmã',
      valorPago: 25.5,
      avisoValorAjustado: 'Valor ajustado.',
    };
    expect(formatarPagamento(resultado)).toBe(
      '✅ Quitado! Irmã pagou R$ 25,50 e não deve mais nada.\n⚠️ Valor ajustado.'
    );
  });

  it('deve formatar pagamento parcial', () => {
    const resultado: ResultadoPagamento = {
      status: 'parcial',
      nome: 'Irmã',
      valorPago: 10,
      saldoRestante: 15.5,
    };
    expect(formatarPagamento(resultado)).toBe(
      '✅ Pagamento parcial registrado! Irmã pagou R$ 10,00. Saldo restante: R$ 15,50.'
    );
  });

  it('deve formatar pagamento parcial com aviso', () => {
    const resultado: ResultadoPagamento = {
      status: 'parcial',
      nome: 'Irmã',
      valorPago: 10,
      saldoRestante: 15.5,
      avisoValorAjustado: 'Somente o devido foi registrado.',
    };
    expect(formatarPagamento(resultado)).toBe(
      '✅ Pagamento parcial registrado! Irmã pagou R$ 10,00. Saldo restante: R$ 15,50.\n⚠️ Somente o devido foi registrado.'
    );
  });
});