import { describe, it, expect } from 'vitest';
import { gerarSparkline, gerarSparklineMensal } from '../../../src/utils/sparklines';

describe('gerarSparkline', () => {
  it('deve retornar string vazia para série vazia', () => {
    expect(gerarSparkline([])).toBe('');
  });

  it('deve usar blocos médios uniformes quando todos os valores são iguais', () => {
    expect(gerarSparkline([5, 5, 5])).toBe('▄▄▄');
    expect(gerarSparkline([0, 0])).toBe('▄▄');
  });

  it('deve mapear min→▁ e max→█ com escala linear', () => {
    const spark = gerarSparkline([0, 100]);
    expect(spark).toBe('▁█');
  });

  it('deve gerar blocos intermediários para valores intermediários', () => {
    // 50% de 0–100 com 8 blocos: round(0.5 * 7) = 4 → '▅'.
    const spark = gerarSparkline([0, 50, 100]);
    expect(spark).toBe('▁▅█');
  });

  it('deve produzir um caractere por valor', () => {
    const valores = [3, 7, 1, 9, 4, 8, 2, 6, 5];
    expect(gerarSparkline(valores)).toHaveLength(valores.length);
  });

  it('deve conter apenas caracteres de bloco válidos', () => {
    const spark = gerarSparkline([10, 20, 30, 40, 50]);
    expect(spark).toMatch(/^[▁▂▃▄▅▆▇█]+$/);
  });
});

describe('gerarSparklineMensal', () => {
  it('deve preencher com zeros os dias sem gasto até o último dia', () => {
    // Gastos apenas nos dias 1 e 3; mês com 5 dias.
    const spark = gerarSparklineMensal([100, 0, 50], 5);
    expect(spark).toHaveLength(5);
    expect(spark).toMatch(/^[▁▂▃▄▅▆▇█]+$/);
  });

  it('deve posicionar o pico no dia correto', () => {
    // Dia 5 tem o maior gasto em um mês de 5 dias → último caractere é █.
    const spark = gerarSparklineMensal([0, 0, 0, 0, 100], 5);
    expect(spark.endsWith('█')).toBe(true);
  });

  it('deve tratar array vazio como série de zeros', () => {
    const spark = gerarSparklineMensal([], 4);
    expect(spark).toBe('▄▄▄▄');
  });
});