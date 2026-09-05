import { describe, it, expect } from 'vitest';
import { gerarGraficoCategoriasPNG } from '../../../src/services/charts/chartService';

describe('gerarGraficoCategoriasPNG', () => {
  it('deve gerar um buffer PNG válido com uma categoria', async () => {
    const png = await gerarGraficoCategoriasPNG([{ categoria: 'Alimentação', total: 450.5 }], 'setembro de 2026');

    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
    // Assinatura mágica do PNG: 89 50 4E 47 0D 0A 1A 0A.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('deve gerar PNG com múltiplas categorias ordenadas', async () => {
    const png = await gerarGraficoCategoriasPNG(
      [
        { categoria: 'Alimentação', total: 900 },
        { categoria: 'Transporte', total: 300 },
        { categoria: 'Lazer', total: 120.75 },
      ],
      'setembro de 2026'
    );

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('deve lançar erro quando não há dados', async () => {
    await expect(gerarGraficoCategoriasPNG([], 'setembro de 2026')).rejects.toThrow(
      'Sem dados para gerar o gráfico.'
    );
  });

  it('deve truncar nomes de categoria muito longos sem quebrar', async () => {
    const png = await gerarGraficoCategoriasPNG(
      [{ categoria: 'Categoria com nome extremamente comprido demais', total: 50 }],
      'setembro de 2026'
    );

    expect(png.length).toBeGreaterThan(0);
  });
});