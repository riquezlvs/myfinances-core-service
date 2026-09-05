import { describe, it, expect } from 'vitest';
import { extrairValor, separarNomeValor, extrairNomeEValorDeFrase } from '../../../src/utils/textParsers';

describe('extrairValor', () => {
  it('deve extrair número inteiro', () => {
    expect(extrairValor('25')).toBe(25);
  });

  it('deve extrair número decimal com vírgula', () => {
    expect(extrairValor('25,50')).toBe(25.5);
  });

  it('deve extrair número decimal com ponto', () => {
    expect(extrairValor('25.50')).toBe(25.5);
  });

  it('deve ignorar prefixo R$', () => {
    expect(extrairValor('R$ 25,00')).toBe(25);
    expect(extrairValor('r$ 30')).toBe(30);
  });

  it('deve extrair valor no meio de uma frase', () => {
    expect(extrairValor('pagou 40 reais')).toBe(40);
  });

  it('deve retornar undefined se não houver número', () => {
    expect(extrairValor('sem valor aqui')).toBeUndefined();
  });

  it('deve retornar undefined para entradas vazias', () => {
    expect(extrairValor(undefined)).toBeUndefined();
    expect(extrairValor('')).toBeUndefined();
  });
});

describe('separarNomeValor', () => {
  it('deve separar nome e valor no final', () => {
    expect(separarNomeValor('Irmã 25')).toEqual({ nome: 'Irmã', valor: 25 });
  });

  it('deve separar nome e valor decimal no final', () => {
    expect(separarNomeValor('João 12,50')).toEqual({ nome: 'João', valor: 12.5 });
  });

  it('deve separar nome e valor com R$', () => {
    expect(separarNomeValor('Maria R$ 30')).toEqual({ nome: 'Maria', valor: 30 });
  });

  it('deve separar nome e valor com "reais"', () => {
    expect(separarNomeValor('Pedro 40 reais')).toEqual({ nome: 'Pedro', valor: 40 });
  });

  it('deve retornar apenas o nome se não houver valor', () => {
    expect(separarNomeValor('Irmã')).toEqual({ nome: 'Irmã', valor: undefined });
  });

  it('deve manter nomes compostos', () => {
    expect(separarNomeValor('Maria João 50')).toEqual({ nome: 'Maria João', valor: 50 });
  });
});

describe('extrairNomeEValorDeFrase', () => {
  it('deve extrair nome e valor de frase simples de pagamento', () => {
    expect(extrairNomeEValorDeFrase('minha irmã pagou 25 reais')).toEqual({
      nome: 'irmã',
      valor: 25,
    });
  });

  it('deve extrair apenas o nome quando não há valor', () => {
    expect(extrairNomeEValorDeFrase('minha irmã pagou')).toEqual({
      nome: 'irmã',
      valor: undefined,
    });
  });

  it('deve extrair de frase com "a" antes do nome', () => {
    expect(extrairNomeEValorDeFrase('a Maria pagou 50')).toEqual({
      nome: 'Maria',
      valor: 50,
    });
  });

  it('deve extrair de frase com "já" antes de pagou', () => {
    expect(extrairNomeEValorDeFrase('minha irmã já pagou 25')).toEqual({
      nome: 'irmã',
      valor: 25,
    });
  });

  it('deve retornar null se não houver verbo "pagou"', () => {
    expect(extrairNomeEValorDeFrase('comprei um tênis')).toBeNull();
  });

  it('deve retornar null se o nome estiver vazio', () => {
    expect(extrairNomeEValorDeFrase('pagou 25 reais')).toBeNull();
  });
});