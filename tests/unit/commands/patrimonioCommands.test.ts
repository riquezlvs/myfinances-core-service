import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/patrimony/patrimonyService', () => ({
  obterResumoPatrimonio: vi.fn(),
  formatarMensagemPatrimonio: vi.fn(),
}));

vi.mock('../../../src/services/accounts/accountService', () => ({
  calcularSafeToSpend: vi.fn(),
  listarContas: vi.fn(),
  ajustarSaldo: vi.fn(),
}));

vi.mock('../../../src/services/investments/yieldService', () => ({
  obterTaxaCdiDiaria: vi.fn(),
  calcularRendimentoCdi: vi.fn(),
}));

vi.mock('../../../src/services/investments/assetPriceService', () => ({
  obterCarteiraComCotacoes: vi.fn(),
}));

import { handlePatrimonio } from '../../../src/bot/commands/patrimonio';
import { handleSaldo } from '../../../src/bot/commands/saldo';
import { handleAjustarSaldo } from '../../../src/bot/commands/ajustarSaldo';
import { handleInvestimentos } from '../../../src/bot/commands/investimentos';
import { obterResumoPatrimonio, formatarMensagemPatrimonio } from '../../../src/services/patrimony/patrimonyService';
import { calcularSafeToSpend, listarContas, ajustarSaldo } from '../../../src/services/accounts/accountService';
import { obterTaxaCdiDiaria, calcularRendimentoCdi } from '../../../src/services/investments/yieldService';
import { obterCarteiraComCotacoes } from '../../../src/services/investments/assetPriceService';

describe('Comandos do Bot — /patrimonio, /saldo, /ajustar_saldo e /investimentos', () => {
  const bot: any = {
    sendMessage: vi.fn(),
  };

  beforeEach(() => {
    bot.sendMessage.mockReset();
    vi.mocked(obterResumoPatrimonio).mockReset();
    vi.mocked(formatarMensagemPatrimonio).mockReset();
    vi.mocked(calcularSafeToSpend).mockReset();
    vi.mocked(listarContas).mockReset();
    vi.mocked(ajustarSaldo).mockReset();
  });

  it('/patrimonio deve buscar resumo e enviar mensagem formatada com botões', async () => {
    vi.mocked(obterResumoPatrimonio).mockResolvedValue({} as any);
    vi.mocked(formatarMensagemPatrimonio).mockReturnValue('Mensagem Patrimônio');

    await handlePatrimonio(12345, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      12345,
      'Mensagem Patrimônio',
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      })
    );
  });

  it('/saldo deve exibir Safe-to-Spend e benefícios', async () => {
    vi.mocked(calcularSafeToSpend).mockResolvedValue({
      accountName: 'Nubank',
      realBalance: 2500,
      openCreditInvoices: 500,
      safeToSpend: 2000,
    });
    vi.mocked(listarContas).mockResolvedValue([
      { id: '1', name: 'VR Flash', type: 'benefit', balance: 650, is_active: true } as any,
    ]);

    await handleSaldo(12345, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('SAFE-TO-SPEND'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  it('/ajustar_saldo deve atualizar saldo da conta especificada', async () => {
    vi.mocked(ajustarSaldo).mockResolvedValue({
      id: '1',
      name: 'VR',
      balance: 800,
    } as any);

    await handleAjustarSaldo(12345, 'VR 800', 'req-1', bot);

    expect(ajustarSaldo).toHaveBeenCalledWith('VR', 800, 'req-1');
    expect(bot.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('ajustado com sucesso para *R$ 800,00*')
    );
  });

  it('/investimentos deve detalhar caixinhas CDI e carteira de ações', async () => {
    vi.mocked(listarContas).mockResolvedValue([
      { id: '1', name: 'Caixinha Nubank', type: 'fixed_income', balance: 5000, cdi_rate: 115, is_active: true } as any,
    ]);
    vi.mocked(obterTaxaCdiDiaria).mockResolvedValue(0.0004);
    vi.mocked(calcularRendimentoCdi).mockReturnValue({
      grossAmount: 50,
      taxAmount: 11.25,
      netAmount: 38.75,
      effectiveRatePct: 1.0,
      daysPassed: 30,
      taxRatePct: 22.5,
    });
    vi.mocked(obterCarteiraComCotacoes).mockResolvedValue({
      assets: [],
      totalInvested: 0,
      totalMarketValue: 0,
      totalProfitLoss: 0,
    });

    await handleInvestimentos(12345, 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('115% CDI'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });
});
