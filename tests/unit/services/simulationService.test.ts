import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn(),
}));

vi.mock('../../../src/services/recurring/recurringService', () => ({
  buscarRecorrenciasAtivasCredito: vi.fn(),
}));

vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

import { simularParcelamento, calcularProximosPeriodosFatura } from '../../../src/services/cards/simulationService';
import { listarCartoes } from '../../../src/services/cards/cardService';
import { buscarRecorrenciasAtivasCredito } from '../../../src/services/recurring/recurringService';
import { getSupabaseClient } from '../../../src/clients/supabaseClient';

describe('simulationService — Motor de Simulação de Parcelas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calcularProximosPeriodosFatura gera sequencialmente N períodos corretos', () => {
    // Referência em 2026-09-10 (antes do fechamento dia 15)
    const agora = new Date(2026, 8, 10);
    const periodos = calcularProximosPeriodosFatura(15, 3, agora);

    expect(periodos.length).toBe(3);
    // 1º período: fecha em 15/setembro
    expect(periodos[0].fechamento.getMonth()).toBe(8);
    expect(periodos[0].fechamento.getDate()).toBe(15);
    // 2º período: fecha em 15/outubro
    expect(periodos[1].fechamento.getMonth()).toBe(9);
    // 3º período: fecha em 15/novembro
    expect(periodos[2].fechamento.getMonth()).toBe(10);
  });

  it('calcula projeção de 2400 em 12x distribuindo parcelas de 200 e somando faturas existentes e recorrências', async () => {
    vi.mocked(listarCartoes).mockResolvedValue([
      { id: 'card-nubank', name: 'Nubank', closing_day: 15, card_type: 'credit', is_default: true },
    ]);

    // Recorrência ativa de R$ 50/mês
    vi.mocked(buscarRecorrenciasAtivasCredito).mockResolvedValue([
      { id: 'rec-1', description: 'Netflix', total_amount: 50 } as any,
    ]);

    // Mock do Supabase retornando 1 gasto de R$ 100 na 1ª fatura
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data: [
          { total_amount: 100, occurred_at: '2026-09-05T10:00:00Z', card_id: 'card-nubank' },
        ],
        error: null,
      }),
    };
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockQueryBuilder),
    } as any);

    const resultado = await simularParcelamento(
      2400,
      12,
      undefined,
      'req-sim',
      new Date(2026, 8, 10) // 10/09/2026
    );

    expect(resultado.totalParcelas).toBe(12);
    expect(resultado.valorTotalCompra).toBe(2400);
    expect(resultado.valorMedioParcela).toBe(200);
    expect(resultado.cartao.name).toBe('Nubank');
    expect(resultado.meses.length).toBe(12);

    // Mês 1: base = 100 (gasto existente) + 50 (recorrência) = 150. Nova fatura = 350.
    expect(resultado.meses[0].valorBase).toBe(150);
    expect(resultado.meses[0].valorNovaParcela).toBe(200);
    expect(resultado.meses[0].valorTotalProjetado).toBe(350);

    // Demais meses (sem gastos existentes): base = 50 (recorrência). Nova fatura = 250.
    expect(resultado.meses[1].valorBase).toBe(50);
    expect(resultado.meses[1].valorTotalProjetado).toBe(250);

    expect(resultado.maiorFatura.valor).toBe(350);
  });

  it('rejeita parcelas menores que 2 ou maiores que 48', async () => {
    await expect(simularParcelamento(100, 1)).rejects.toThrow('entre 2 e 48 vezes');
    await expect(simularParcelamento(100, 50)).rejects.toThrow('entre 2 e 48 vezes');
  });
});
