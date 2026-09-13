import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { ParsedTransaction } from '../../../src/types/transaction';

// Mocks dos serviços externos usados pelo registrarEResponderGasto.
vi.mock('../../../src/services/transactions/transactionService', () => ({
  registrarTransacao: vi.fn(),
}));
vi.mock('../../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));
vi.mock('../../../src/services/cards/paymentInference', () => ({
  inferirMetodoPagamento: vi.fn(),
}));
vi.mock('../../../src/services/budgets/budgetService', () => ({
  verificarMeta: vi.fn(),
  definirMeta: vi.fn(),
  listarMetas: vi.fn(),
  removerMeta: vi.fn(),
}));

import { registrarEResponderGasto } from '../../../src/bot/handlers/novoGasto';
import { registrarTransacao } from '../../../src/services/transactions/transactionService';
import { getCategoryMap } from '../../../src/services/categories/categoryCache';
import { inferirMetodoPagamento } from '../../../src/services/cards/paymentInference';
import { verificarMeta, type StatusMeta } from '../../../src/services/budgets/budgetService';
import { formatarAlertaMeta } from '../../../src/bot/commands/meta';
import { RODAPE_UX } from '../../../src/config/constants';

const mockRegistrarTransacao = vi.mocked(registrarTransacao);
const mockGetCategoryMap = vi.mocked(getCategoryMap);
const mockInferirMetodo = vi.mocked(inferirMetodoPagamento);
const mockVerificarMeta = vi.mocked(verificarMeta);

function statusMeta(parcial: Partial<StatusMeta> & Pick<StatusMeta, 'nivel'>): StatusMeta {
  return {
    categoria: 'Alimentação',
    gastoAtual: 500,
    limite: 600,
    percentual: 83.3,
    ...parcial,
  };
}

const gasto: ParsedTransaction = {
  description: 'Almoço no restaurante',
  total_amount: 100,
  category_id: 1,
  payment_method: 'pix',
  occurred_at: '2026-09-07T12:00:00.000Z',
  my_share_amount: null,
  third_party_name: null,
  installment_total: null,
};

function criarBotMock() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as TelegramBot & { sendMessage: ReturnType<typeof vi.fn> };
}

/** 8.6 — Extrai os callback_data do reply_markup da primeira chamada sendMessage. */
function botoesDoTeclado(bot: { sendMessage: ReturnType<typeof vi.fn> }): string[] {
  const options = bot.sendMessage.mock.calls[0][2] as
    | { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }
    | undefined;
  return (options?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCategoryMap.mockResolvedValue({ 1: 'Alimentação' });
  mockRegistrarTransacao.mockResolvedValue({ displayIds: [101] });
  mockInferirMetodo.mockResolvedValue({ payment_method: 'pix', card_id: null });
});

describe('registrarEResponderGasto — alertas inteligentes de meta (8.3)', () => {
  it('abaixo de 80% da meta: registra sem alerta e fecha com o rodapé padrão', async () => {
    mockVerificarMeta.mockResolvedValue(
      statusMeta({ nivel: 'ok', gastoAtual: 300, limite: 600, percentual: 50 })
    );
    const bot = criarBotMock();

    await registrarEResponderGasto(999, gasto, 'Almoço 100', 'req-1', bot);

    expect(mockVerificarMeta).toHaveBeenCalledWith(1, 'req-1');
    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('✅ Gasto registrado!');
    expect(texto).toContain('#101');
    expect(texto).toContain('🏷️ Alimentação');
    expect(texto).not.toContain('🟡');
    expect(texto).not.toContain('🔴');
    expect(texto).not.toContain('Atenção');
    expect(texto).not.toContain('estourada');
    expect(texto).toContain(RODAPE_UX);

    // 8.6 — Teclado dinâmico: navegação rápida sem botões de estouro.
    const callbackData = botoesDoTeclado(bot);
    expect(callbackData).toContain('nav:resumo');
    expect(callbackData).toContain('nav:novogasto');
    expect(callbackData).not.toContain('nav:grafico');
    expect(callbackData).not.toContain('nav:insight');
  });

  it('sem meta definida: registra sem alerta', async () => {
    mockVerificarMeta.mockResolvedValue(null);
    const bot = criarBotMock();

    await registrarEResponderGasto(999, gasto, 'Almoço 100', 'req-2', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('✅ Gasto registrado!');
    expect(texto).not.toContain('🟡');
    expect(texto).not.toContain('🔴');
    expect(texto).toContain(RODAPE_UX);
  });

  it('atinge/ultrapassa 80%: anexa o alerta amarelo 🟡 na confirmação', async () => {
    mockVerificarMeta.mockResolvedValue(
      statusMeta({ nivel: 'aviso80', gastoAtual: 500, limite: 600, percentual: 83.333 })
    );
    const bot = criarBotMock();

    await registrarEResponderGasto(999, gasto, 'Almoço 100', 'req-3', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('🟡');
    expect(texto).toContain('*Atenção: Alimentação em 83% da meta*');
    expect(texto).toContain('R$ 500,00 de R$ 600,00');
    expect(texto).not.toContain('estourada');
    expect(texto).toContain(RODAPE_UX);

    // 8.6 — Aviso 80% não estourou: sem botões contextuais de gráfico/insight.
    expect(botoesDoTeclado(bot)).not.toContain('nav:grafico');
  });

  it('estoura 100%: anexa o alerta vermelho 🔴 com o excedente, antes do rodapé', async () => {
    mockVerificarMeta.mockResolvedValue(
      statusMeta({ nivel: 'limite100', gastoAtual: 650, limite: 600, percentual: 108.3 })
    );
    const bot = criarBotMock();

    await registrarEResponderGasto(999, gasto, 'Almoço 100', 'req-4', bot);

    const texto = bot.sendMessage.mock.calls[0][1] as string;
    expect(texto).toContain('🔴');
    expect(texto).toContain('*Meta de Alimentação estourada!*');
    expect(texto).toContain('R$ 650,00 de R$ 600,00');
    expect(texto).toContain('excedeu R$ 50,00');
    expect(texto).toContain(RODAPE_UX);
    // Alerta contextual vem antes do fechamento humanizado.
    expect(texto.indexOf('🔴')).toBeLessThan(texto.indexOf(RODAPE_UX));

    // 8.6 — Orçamento estourado: botões contextuais de gráfico e insight.
    const callbackData = botoesDoTeclado(bot);
    expect(callbackData).toContain('nav:grafico');
    expect(callbackData).toContain('nav:insight');
  });
});

describe('formatarAlertaMeta — formatação dos avisos (8.3)', () => {
  it('formata o alerta de atenção (80%) com percentual e valores', () => {
    const aviso = formatarAlertaMeta(
      statusMeta({ nivel: 'aviso80', gastoAtual: 500, limite: 600, percentual: 83.333 })
    );
    expect(aviso).toContain('🟡');
    expect(aviso).toContain('83% da meta');
    expect(aviso).toContain('R$ 500,00 de R$ 600,00');
  });

  it('formata o alerta de estouro (100%) com o excedente', () => {
    const aviso = formatarAlertaMeta(
      statusMeta({ nivel: 'limite100', gastoAtual: 650, limite: 600, percentual: 108.3 })
    );
    expect(aviso).toContain('🔴');
    expect(aviso).toContain('estourada');
    expect(aviso).toContain('excedeu R$ 50,00');
  });
});
