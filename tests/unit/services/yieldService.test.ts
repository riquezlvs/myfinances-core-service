import { describe, it, expect, vi } from 'vitest';
import {
  obterAliquotaIr,
  obterAliquotaIof,
  calcularDiasUteis,
  calcularRendimentoCdi,
} from '../../../src/services/investments/yieldService';

describe('yieldService — Tabela regressiva de impostos e rendimento CDI', () => {
  it('deve aplicar alíquotas corretas de IR por prazo', () => {
    expect(obterAliquotaIr(30)).toBe(0.225);   // até 180 dias: 22.5%
    expect(obterAliquotaIr(180)).toBe(0.225);
    expect(obterAliquotaIr(181)).toBe(0.20);   // de 181 a 360: 20%
    expect(obterAliquotaIr(360)).toBe(0.20);
    expect(obterAliquotaIr(361)).toBe(0.175);  // de 361 a 720: 17.5%
    expect(obterAliquotaIr(720)).toBe(0.175);
    expect(obterAliquotaIr(721)).toBe(0.15);   // acima de 720: 15%
  });

  it('deve aplicar IOF regressivo nos primeiros 29 dias e 0% a partir do 30º dia', () => {
    expect(obterAliquotaIof(1)).toBe(0.96);
    expect(obterAliquotaIof(15)).toBe(0.50);
    expect(obterAliquotaIof(29)).toBe(0.03);
    expect(obterAliquotaIof(30)).toBe(0);
    expect(obterAliquotaIof(60)).toBe(0);
  });

  it('deve calcular dias úteis ignorando fins de semana', () => {
    // Sexta-feira até Segunda-feira seguinte (1 dia útil decorrido)
    const sexta = new Date(2026, 8, 4);   // 04/09/2026 (Sexta)
    const segunda = new Date(2026, 8, 7); // 07/09/2026 (Segunda)
    const uteis = calcularDiasUteis(sexta, segunda);
    expect(uteis).toBe(1);
  });

  it('deve calcular rendimento da Caixinha 115% CDI com valor bruto e líquido transparentes', () => {
    const saldo = 10000;
    const taxaCdiPct = 115; // 115% do CDI
    const dataInicio = new Date(2026, 0, 1);
    const dataFim = new Date(2026, 1, 1); // ~31 dias corridos (isento de IOF, IR 22.5%)

    // Simula taxa diária de ~0.04%
    const taxaDiaria = 0.0004;
    const res = calcularRendimentoCdi(saldo, taxaCdiPct, dataInicio, dataFim, taxaDiaria);

    expect(res.grossAmount).toBeGreaterThan(0);
    expect(res.taxAmount).toBeGreaterThan(0);
    expect(res.netAmount).toBe(Math.round((res.grossAmount - res.taxAmount) * 100) / 100);
    expect(res.taxRatePct).toBe(22.5);
  });
});
