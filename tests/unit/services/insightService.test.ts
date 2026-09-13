import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('../../../src/clients/geminiClient', () => ({
  getGeminiClient: () => ({ models: { generateContent: mockGenerateContent } }),
}));

vi.mock('../../../src/services/transactions/transactionService', () => ({
  getResumoMensal: vi.fn(),
  getGastosPorCategoria: vi.fn(),
}));

import {
  agregarDadosDoMes,
  serializarAgregados,
  gerarInsight,
  calcularProjecaoFechamento,
  serializarProjecao,
} from '../../../src/services/gemini/insightService';
import { getResumoMensal, getGastosPorCategoria } from '../../../src/services/transactions/transactionService';

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

describe('calcularProjecaoFechamento', () => {
  it('deve calcular projeção baseada no ritmo atual', () => {
    const ref = new Date('2026-09-15T12:00:00');
    const projecao = calcularProjecaoFechamento(600, ref);
    expect(projecao.totalAtual).toBe(600);
    expect(projecao.diasPassados).toBe(15);
    expect(projecao.diasNoMes).toBe(30);
    expect(projecao.projecao).toBe(1200);
  });

  it('deve retornar projeção 0 quando total é 0', () => {
    expect(calcularProjecaoFechamento(0).projecao).toBe(0);
  });

  it('deve retornar projeção 0 quando total é negativo', () => {
    expect(calcularProjecaoFechamento(-100).projecao).toBe(0);
  });

  it('deve retornar projeção 0 quando total é Infinity', () => {
    expect(calcularProjecaoFechamento(Infinity).projecao).toBe(0);
  });

  it('deve retornar projeção 0 quando total é NaN', () => {
    expect(calcularProjecaoFechamento(NaN).projecao).toBe(0);
  });

  it('deve retornar projeção válida no 1º dia do mês', () => {
    const projecao = calcularProjecaoFechamento(100, new Date('2026-09-01T12:00:00'));
    expect(projecao.diasPassados).toBe(1);
    expect(projecao.projecao).toBe(3000);
  });

  it('deve aplicar hard-limit em valores absurdos', () => {
    expect(calcularProjecaoFechamento(999_999_999_999).projecao).toBeLessThanOrEqual(10_000_000);
  });
});

describe('serializarProjecao', () => {
  it('deve formatar projeção em pt-BR', () => {
    const texto = serializarProjecao(calcularProjecaoFechamento(600, new Date('2026-09-15T12:00:00')));
    expect(texto).toContain('Projeção de fechamento do mês');
    expect(texto).toContain('R$ 1.200,00');
    expect(texto).toContain('15 dia(s) de 30');
  });
});

describe('agregarDadosDoMes', () => {
  it('deve agregar resumo e categorias em paralelo', async () => {
    const dados = await agregarDadosDoMes('req-1');
    expect(dados.resumo).toEqual(resumoFake);
    expect(dados.porCategoria).toHaveLength(2);
  });
});

describe('serializarAgregados', () => {
  it('deve incluir valores formatados em pt-BR', async () => {
    const texto = serializarAgregados(await agregarDadosDoMes('req-1'));
    expect(texto).toContain('R$ 1.200,00');
    expect(texto).toContain('Alimentação=R$ 600,00');
  });

  it('deve lidar com mês sem lançamentos', async () => {
    mockGetResumo.mockResolvedValue({ meuGastoReal: 0, gastosRecorrentes: 0, quantidade: 0, porMetodo: [] });
    mockGetPorCategoria.mockResolvedValue([]);
    const texto = serializarAgregados(await agregarDadosDoMes('req-1'));
    expect(texto).toContain('nenhum');
    expect(texto).toContain('nenhuma');
  });
});

describe('gerarInsight', () => {
  it('deve retornar aviso amigável quando não há lançamentos', async () => {
    mockGetResumo.mockResolvedValue({ meuGastoReal: 0, gastosRecorrentes: 0, quantidade: 0, porMetodo: [] });
    const texto = await gerarInsight('req-1');
    expect(texto).toContain('não há lançamentos');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('deve chamar o Gemini e retornar o texto', async () => {
    mockGenerateContent.mockResolvedValue({ text: '  Você gastou bastante.  ' });
    const texto = await gerarInsight('req-1');
    expect(texto).toBe('Você gastou bastante.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('deve incluir projeção de fechamento no prompt quando há mais de 1 dia', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Insight.' });
    await gerarInsight('req-1');
    const chamada = mockGenerateContent.mock.calls[0][0];
    expect(chamada.contents).toContain('Projeção de fechamento');
    expect(chamada.contents).toContain('avise o usuário');
  });

  it('deve lançar erro quando o Gemini retorna vazio', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });
    await expect(gerarInsight('req-1')).rejects.toThrow('resposta vazia');
  });
});