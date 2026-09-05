import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do cliente Gemini (nunca chamamos a API real nos testes).
const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({
    models: { generateContent: mockGenerateContent },
  }),
}));

// Mock das consultas agregadas do transactionService.
vi.mock('../../../src/services/transactions/transactionService', () => ({
  getResumoMensal: vi.fn(),
  getGastosPorCategoria: vi.fn(),
}));

import {
  agregarDadosDoMes,
  serializarAgregados,
  gerarInsight,
} from '../../../src/services/gemini/insightService';
import {
  getResumoMensal,
  getGastosPorCategoria,
} from '../../../src/services/transactions/transactionService';

const mockGetResumo = vi.mocked(getResumoMensal);
const mockGetPorCategoria = vi.mocked(getGastosPorCategoria);

const resumoFake = {
  meuGastoReal: 1200,
  gastosRecorrentes: 89.9,
  quantidade: 12,
  porMetodo: [
    { metodo: 'credit_card' as const, total: 800 },
    { metodo: 'pix' as const, total: 400 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetResumo.mockResolvedValue(resumoFake);
  mockGetPorCategoria.mockResolvedValue([
    { categoria: 'Alimentação', total: 600 },
    { categoria: 'Transporte', total: 300 },
  ]);
});

describe('agregarDadosDoMes', () => {
  it('deve agregar resumo e categorias em paralelo', async () => {
    const dados = await agregarDadosDoMes('req-1');

    expect(dados.resumo).toEqual(resumoFake);
    expect(dados.porCategoria).toHaveLength(2);
    expect(mockGetResumo).toHaveBeenCalledWith('req-1');
    expect(mockGetPorCategoria).toHaveBeenCalledWith('req-1');
  });
});

describe('serializarAgregados', () => {
  it('deve incluir valores formatados em pt-BR', async () => {
    const dados = await agregarDadosDoMes('req-1');
    const texto = serializarAgregados(dados);

    expect(texto).toContain('R$ 1.200,00');
    expect(texto).toContain('Alimentação=R$ 600,00');
    expect(texto).toContain('credit_card=R$ 800,00');
    expect(texto).toContain('Quantidade de lançamentos: 12');
  });

  it('deve lidar com mês sem lançamentos', async () => {
    mockGetResumo.mockResolvedValue({
      meuGastoReal: 0,
      gastosRecorrentes: 0,
      quantidade: 0,
      porMetodo: [],
    });
    mockGetPorCategoria.mockResolvedValue([]);

    const texto = serializarAgregados(await agregarDadosDoMes('req-1'));
    expect(texto).toContain('nenhum');
    expect(texto).toContain('nenhuma');
  });
});

describe('gerarInsight', () => {
  it('deve retornar aviso amigável quando não há lançamentos no mês', async () => {
    mockGetResumo.mockResolvedValue({
      meuGastoReal: 0,
      gastosRecorrentes: 0,
      quantidade: 0,
      porMetodo: [],
    });

    const texto = await gerarInsight('req-1');
    expect(texto).toContain('não há lançamentos');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('deve chamar o Gemini com o prompt analítico e retornar o texto', async () => {
    mockGenerateContent.mockResolvedValue({ text: '  Você gastou bastante em Alimentação.  ' });

    const texto = await gerarInsight('req-1');

    expect(texto).toBe('Você gastou bastante em Alimentação.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const chamada = mockGenerateContent.mock.calls[0][0];
    expect(chamada.model).toBe('gemini-3.5-flash');
    expect(chamada.contents).toContain('DADOS DO MÊS');
    expect(chamada.contents).toContain('Alimentação=R$ 600,00');
  });

  it('deve lançar erro quando o Gemini retorna vazio', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });

    await expect(gerarInsight('req-1')).rejects.toThrow('resposta vazia');
  });
});