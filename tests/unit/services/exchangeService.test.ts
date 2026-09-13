import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do fetch global.
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  isMoedaSuportada,
  converterParaBRL,
  formatarConversao,
  buscarTaxa,
  limparCacheTaxas,
} from '../../../src/services/exchange/exchangeService';

describe('isMoedaSuportada', () => {
  it('deve aceitar USD e EUR', () => {
    expect(isMoedaSuportada('USD')).toBe(true);
    expect(isMoedaSuportada('EUR')).toBe(true);
    expect(isMoedaSuportada('usd')).toBe(true); // case-insensitive
  });

  it('deve rejeitar moedas não suportadas', () => {
    expect(isMoedaSuportada('GBP')).toBe(false);
    expect(isMoedaSuportada('JPY')).toBe(false);
    expect(isMoedaSuportada('')).toBe(false);
  });
});

describe('buscarTaxa', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    limparCacheTaxas();
  });

  it('deve buscar taxa da API com sucesso', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 5.25 }),
    });

    const { taxa, daApi } = await buscarTaxa('USD', 'req-1');
    expect(taxa).toBe(5.25);
    expect(daApi).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('deve usar fallback quando a API falha', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { taxa, daApi } = await buscarTaxa('USD', 'req-1');
    expect(taxa).toBe(5.20); // fallback fixo
    expect(daApi).toBe(false);
  });

  it('deve usar fallback quando a API retorna HTTP erro', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { taxa, daApi } = await buscarTaxa('EUR', 'req-1');
    expect(taxa).toBe(6.10); // fallback fixo
    expect(daApi).toBe(false);
  });

  it('deve usar fallback quando a API retorna resultado inválido', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }),
    });

    const { taxa, daApi } = await buscarTaxa('USD', 'req-1');
    expect(taxa).toBe(5.20);
    expect(daApi).toBe(false);
  });
});

describe('converterParaBRL', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    limparCacheTaxas();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 5.20 }),
    });
  });

  it('deve converter USD para BRL', async () => {
    const resultado = await converterParaBRL(50, 'USD', 'req-1');
    expect(resultado.valorOriginal).toBe(50);
    expect(resultado.moedaOriginal).toBe('USD');
    expect(resultado.valorBRL).toBe(260);
    expect(resultado.taxa).toBe(5.20);
    expect(resultado.dadosDaApi).toBe(true);
  });

  it('deve converter EUR para BRL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 6.10 }),
    });

    const resultado = await converterParaBRL(100, 'EUR', 'req-1');
    expect(resultado.valorBRL).toBe(610);
  });

  it('deve lançar erro com valor inválido', async () => {
    await expect(converterParaBRL(-10, 'USD', 'req-1')).rejects.toThrow('inválido');
    await expect(converterParaBRL(0, 'USD', 'req-1')).rejects.toThrow('inválido');
    await expect(converterParaBRL(NaN, 'USD', 'req-1')).rejects.toThrow('inválido');
  });
});

describe('validação de moeda', () => {
  it('deve rejeitar moeda não suportada via isMoedaSuportada', () => {
    expect(isMoedaSuportada('GBP')).toBe(false);
    expect(isMoedaSuportada('JPY')).toBe(false);
  });
});

describe('formatarConversao', () => {
  it('deve formatar conversão em pt-BR', () => {
    const texto = formatarConversao({
      valorOriginal: 50,
      moedaOriginal: 'USD',
      valorBRL: 260,
      taxa: 5.20,
      dadosDaApi: true,
    });
    expect(texto).toContain('US$ 50,00');
    expect(texto).toContain('Câmbio: 5,20');
    expect(texto).toContain('R$ 260,00');
  });

  it('deve formatar EUR com símbolo €', () => {
    const texto = formatarConversao({
      valorOriginal: 100,
      moedaOriginal: 'EUR',
      valorBRL: 610,
      taxa: 6.10,
      dadosDaApi: true,
    });
    expect(texto).toContain('€ 100,00');
  });
});