import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';

vi.mock('../../../src/services/transactions/transactionService', () => ({
  getResumoMensal: vi.fn(),
  getGastosDiariosDoMes: vi.fn(),
}));
vi.mock('../../../src/services/budgets/budgetService', () => ({
  listarMetas: vi.fn(),
}));

import { handleResumo } from '../../../src/bot/commands/resumo';
import {
  getResumoMensal,
  getGastosDiariosDoMes,
} from '../../../src/services/transactions/transactionService';
import { listarMetas } from '../../../src/services/budgets/budgetService';
import { RODAPE_UX } from '../../../src/config/constants';

const mockGetResumoMensal = vi.mocked(getResumoMensal);
const mockGetGastosDiarios = vi.mocked(getGastosDiariosDoMes);
const mockListarMetas = vi.mocked(listarMetas);

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue(true),
  } as unknown as TelegramBot & { sendMessage: ReturnType<typeof vi.fn> };
}

/** 8.6 — Extrai os callback_data do reply_markup da primeira chamada sendMessage. */
function botoesDoTeclado(bot: { sendMessage: ReturnType<typeof vi.fn> }): string[] {
  const options = bot.sendMessage.mock.calls[0][2] as
    | { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }
    | undefined;
  return (options?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
}

function resumoBase() {
  return {
    meuGastoReal: 100,
    gastosRecorrentes: 50,
    quantidade: 3,
    porMetodo: [{ metodo: 'pix', total: 100 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetResumoMensal.mockResolvedValue(resumoBase());
  mockGetGastosDiarios.mockResolvedValue([40, 60]);
});

describe('handleResumo — alertas inteligentes de meta (8.3)', () => {
  it('não exibe a seção de metas quando não há orçamentos definidos', async () => {
    mockListarMetas.mockResolvedValue([]);
    const bot = criarBotMock();

    await handleResumo(999, 'req-1', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('📊 *Resumo do mês*');
    expect(texto).not.toContain('Metas do mês');
    expect(texto).toContain(RODAPE_UX);

    // 8.6 — Teclado dinâmico de navegação do resumo.
    const callbackData = botoesDoTeclado(bot);
    expect(callbackData).toContain('nav:grafico');
    expect(callbackData).toContain('nav:fatura');
    expect(callbackData).toContain('nav:dividas');
  });

  it('exibe 🔴 para metas estouradas, 🟡 entre 80-99% e 🟢 para as saudáveis', async () => {
    mockListarMetas.mockResolvedValue([
      { categoria: 'Lazer', gastoAtual: 250, limite: 200, percentual: 125, nivel: 'limite100' },
      { categoria: 'Alimentação', gastoAtual: 550, limite: 600, percentual: 91.7, nivel: 'aviso80' },
      { categoria: 'Transporte', gastoAtual: 50, limite: 200, percentual: 25, nivel: 'ok' },
    ]);
    const bot = criarBotMock();

    await handleResumo(999, 'req-1', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('🎯 *Metas do mês:*');
    expect(texto).toContain('🔴 Lazer: ██████████ R$ 250,00 / R$ 200,00 (125%)');
    expect(texto).toContain('🟡 Alimentação: █████████░ R$ 550,00 / R$ 600,00 (92%)');
    expect(texto).toContain('🟢 Transporte: ██░░░░░░░░ R$ 50,00 / R$ 200,00 (25%)');
    expect(texto).toContain(RODAPE_UX);
  });

  it('exibe barras textuais proporcionais ao limite em cada meta (8.5)', async () => {
    mockListarMetas.mockResolvedValue([
      { categoria: 'Alimentação', gastoAtual: 600, limite: 600, percentual: 100, nivel: 'limite100' },
      { categoria: 'Transporte', gastoAtual: 120, limite: 600, percentual: 20, nivel: 'ok' },
    ]);
    const bot = criarBotMock();

    await handleResumo(999, 'req-1', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    // Barra cheia (100% do limite) vs. barra de 2/10 (20%).
    expect(texto).toContain('██████████ R$ 600,00 / R$ 600,00 (100%)');
    expect(texto).toContain('██░░░░░░░░ R$ 120,00 / R$ 600,00 (20%)');
    expect(texto).toContain(RODAPE_UX);
  });

  it('mantém o resumo funcional (best-effort) quando a consulta de metas falha', async () => {
    mockListarMetas.mockRejectedValue(new Error('boom'));
    const bot = criarBotMock();

    await handleResumo(999, 'req-1', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('📊 *Resumo do mês*');
    expect(texto).toContain('💸 Meus gastos reais: R$ 100,00');
    expect(texto).not.toContain('Metas do mês');
    expect(texto).toContain(RODAPE_UX);
  });
});