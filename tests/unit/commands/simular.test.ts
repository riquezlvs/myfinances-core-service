import { describe, it, expect, vi } from 'vitest';
import { parseArgumentosSimulacao, formatarMensagemSimulacao } from '../../../src/bot/commands/simular';
import type { ResultadoSimulacao } from '../../../src/services/cards/simulationService';

describe('simular — comando /simular', () => {
  it('faz o parse correto de vários formatos de entrada', () => {
    expect(parseArgumentosSimulacao('2400 12x')).toEqual({
      valor: 2400,
      parcelas: 12,
      cartao: undefined,
    });

    expect(parseArgumentosSimulacao('1500,50 6x Nubank')).toEqual({
      valor: 1500.5,
      parcelas: 6,
      cartao: 'Nubank',
    });

    expect(parseArgumentosSimulacao('800 10')).toEqual({
      valor: 800,
      parcelas: 10,
      cartao: undefined,
    });
  });

  it('lança erro amigável quando faltam argumentos', () => {
    expect(() => parseArgumentosSimulacao('')).toThrow('Como simular compras parceladas');
    expect(() => parseArgumentosSimulacao('2400')).toThrow('Como simular compras parceladas');
  });

  it('formata a mensagem com tabela comparativa e cabeçalhos claros', () => {
    const mockResultado: ResultadoSimulacao = {
      cartao: { id: 'c1', name: 'Nubank', closing_day: 15, card_type: 'credit', is_default: true },
      valorTotalCompra: 2400,
      totalParcelas: 3,
      valorMedioParcela: 800,
      meses: [
        { mesIndice: 1, nomeMes: 'out/26', dataFechamento: new Date(2026, 9, 15), valorBase: 1000, valorNovaParcela: 800, valorTotalProjetado: 1800, percentualAumento: 80 },
        { mesIndice: 2, nomeMes: 'nov/26', dataFechamento: new Date(2026, 10, 15), valorBase: 400, valorNovaParcela: 800, valorTotalProjetado: 1200, percentualAumento: 200 },
        { mesIndice: 3, nomeMes: 'dez/26', dataFechamento: new Date(2026, 11, 15), valorBase: 0, valorNovaParcela: 800, valorTotalProjetado: 800, percentualAumento: 100 },
      ],
      maiorFatura: {
        nomeMes: 'out/26',
        valor: 1800,
      },
    };

    const texto = formatarMensagemSimulacao(mockResultado);
    expect(texto).toContain('SIMULAÇÃO DE PARCELAMENTO');
    expect(texto).toContain('Nubank');
    expect(texto).toContain('2.400,00 em *3x de R$ 800,00*');
    expect(texto).toContain('Pico da Maior Fatura');
    expect(texto).toContain('1.800,00');
    expect(texto).toContain('Comprometimento Total:* 3 meses');
  });
});
