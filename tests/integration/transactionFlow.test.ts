import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { messageHandler } from '../../src/bot/handlers/messageHandler';
import type { IntentPayload, ParsedTransaction } from '../../src/types/transaction';

// Mocks dos serviços externos usados pelo messageHandler.
vi.mock('../../src/services/gemini/intentRouter', () => ({
  classificarIntencao: vi.fn(),
}));
vi.mock('../../src/services/transactions/transactionService', () => ({
  registrarTransacao: vi.fn(),
  apagarTransacaoComGrupo: vi.fn(),
  atualizarCategoria: vi.fn(),
  atualizarMetodo: vi.fn(),
  getUltimosGastos: vi.fn(),
  consultarGastosGranulares: vi.fn(),
}));
vi.mock('../../src/services/categories/categoryCache', () => ({
  getCategoryMap: vi.fn(),
}));
vi.mock('../../src/services/budgets/budgetService', () => ({
  verificarMeta: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/export/exportService', () => ({
  exportarGastosDoMesCSV: vi.fn(),
  exportarDividasCSV: vi.fn(),
}));
vi.mock('../../src/services/cards/cardService', () => ({
  listarCartoes: vi.fn(),
  definirCartao: vi.fn(),
  definirCartaoPrincipal: vi.fn(),
  removerCartao: vi.fn(),
  calcularPeriodoFatura: vi.fn(),
  getFaturaDoPeriodo: vi.fn(),
  LABEL_CARD_TYPE: {
    credit: 'Crédito',
    meal_voucher: 'Vale-refeição',
    food_voucher: 'Vale-alimentação',
  },
}));

import { classificarIntencao } from '../../src/services/gemini/intentRouter';
import { registrarTransacao, consultarGastosGranulares } from '../../src/services/transactions/transactionService';
import { exportarGastosDoMesCSV } from '../../src/services/export/exportService';
import { getCategoryMap } from '../../src/services/categories/categoryCache';
import { definirCartao, listarCartoes, LABEL_CARD_TYPE } from '../../src/services/cards/cardService';
import { RODAPE_UX } from '../../src/config/constants';

const mockClassificarIntencao = vi.mocked(classificarIntencao);
const mockRegistrarTransacao = vi.mocked(registrarTransacao);
const mockConsultarGastosGranulares = vi.mocked(consultarGastosGranulares);
const mockExportarGastosDoMesCSV = vi.mocked(exportarGastosDoMesCSV);
const mockGetCategoryMap = vi.mocked(getCategoryMap);
const mockDefinirCartao = vi.mocked(definirCartao);
const mockListarCartoes = vi.mocked(listarCartoes);

function criarBotMock() {
  const bot = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue(true),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 2 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    on: vi.fn(),
  };
  return bot as unknown as TelegramBot & typeof bot;
}

function criarMensagem(texto: string, userId = 12345): Message {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 999, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Teste' },
    text: texto,
  } as unknown as Message;
}

/** Mês corrente no formato YYYY-MM — sempre dentro da janela MAX_MONTH_LOOKBACK. */
function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('messageHandler — fluxo de novo gasto (payload único do Gemini)', () => {
  it('deve registrar um gasto avulso e responder com sucesso', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'NOVO_GASTO',
      params: {},
      transaction: {
        description: 'Almoço no restaurante',
        total_amount: 45,
        category_id: 1,
        payment_method: 'pix',
        occurred_at: '2026-09-05T12:00:00.000Z',
        my_share_amount: null,
        third_party_name: null,
        installment_total: null,
      } as ParsedTransaction,
      avisos: [],
    } as IntentPayload);
    mockRegistrarTransacao.mockResolvedValue({ displayIds: [101] });
    mockGetCategoryMap.mockResolvedValue({ 1: 'Alimentação' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45 no almoço no pix'), bot);

    expect(mockClassificarIntencao).toHaveBeenCalled();
    expect(mockRegistrarTransacao).toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);

    const [chatIdMensagem, texto] = bot.sendMessage.mock.calls[0];
    expect(chatIdMensagem).toBe(999);
    expect(texto).toContain('Almoço no restaurante');
    expect(texto).toContain('R$ 45,00');
    expect(texto).toContain('Alimentação');
    expect(texto).toContain('#101');
  });

  it('deve registrar compra parcelada e listar todos os IDs', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'NOVO_GASTO',
      params: {},
      transaction: {
        description: 'Tênis novo',
        total_amount: 300,
        category_id: 7,
        payment_method: 'credit_card',
        occurred_at: '2026-09-05T12:00:00.000Z',
        my_share_amount: null,
        third_party_name: null,
        installment_total: 3,
      } as ParsedTransaction,
      avisos: [],
    } as IntentPayload);
    mockRegistrarTransacao.mockResolvedValue({ displayIds: [201, 202, 203] });
    mockGetCategoryMap.mockResolvedValue({ 7: 'Compras' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Tênis novo 300 em 3x'), bot);

    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Parcelado em 3x');
    expect(texto).toContain('#201, #202, #203');
  });

  it('deve responder com acesso negado para usuário não autorizado', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45', 99999), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '🚫 Acesso negado.');
    expect(mockClassificarIntencao).not.toHaveBeenCalled();
  });

  it('deve responder com erro genérico quando o fluxo falha', async () => {
    mockClassificarIntencao.mockRejectedValue(new Error('Gemini fora do ar'));

    const bot = criarBotMock();
    await messageHandler(criarMensagem('Gastei 45'), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Não consegui processar sua mensagem');
    expect(texto).not.toContain('Gemini fora do ar'); // não vaza detalhe interno
  });
});

describe('messageHandler — Intent Routing conversacional', () => {
  it('EXPORTAR: "manda a planilha" roteia para o exportService com o mês', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'EXPORTAR',
      params: { tipoExport: 'gastos', month: mesAtual() },
      avisos: [],
    } as IntentPayload);
    mockExportarGastosDoMesCSV.mockResolvedValue({
      nome: 'gastos.csv',
      buffer: Buffer.from('a,b\n1,2'),
      linhas: 2,
    });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('manda a planilha com meus gastos'), bot);

    expect(mockExportarGastosDoMesCSV).toHaveBeenCalledWith(expect.any(String), mesAtual());
    expect(bot.sendDocument).toHaveBeenCalledTimes(1);
    expect(mockRegistrarTransacao).not.toHaveBeenCalled();
  });

  it('EXPORTAR: mês fora da janela (hard-limit em código) é recusado sem exportar', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'EXPORTAR',
      params: { tipoExport: 'gastos', month: '2100-01' },
      avisos: [],
    } as IntentPayload);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('exporta janeiro de 2100'), bot);

    expect(mockExportarGastosDoMesCSV).not.toHaveBeenCalled();
    expect(bot.sendDocument).not.toHaveBeenCalled();
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('últimos 12');
  });

  it('CONFIRMACAO_REQUERIDA: pedido destrutivo NUNCA executa — aponta os comandos seguros', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'CONFIRMACAO_REQUERIDA',
      params: { pedidoDescricao: 'apagar o gasto de ontem' },
      avisos: [],
    } as IntentPayload);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('apaga o gasto de ontem'), bot);

    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('nunca apago nada por conversa');
    expect(texto).toContain('/apagar');
    expect(mockRegistrarTransacao).not.toHaveBeenCalled();
  });

  it('CONSULTA sem entidade orienta o usuário (sem dead-end de comandos)', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'CONSULTA',
      params: {},
      avisos: [],
    } as IntentPayload);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('o que você tem pra mim?'), bot);

    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Posso te mostrar');
    expect(texto).toContain('resumo do mês');
  });
});

describe('messageHandler — CONSULTA granular por linguagem natural (8.4)', () => {
  it('filtra por categoria + mês e responde total, detalhe e RODAPE_UX', async () => {
    const mes = mesAtual();
    mockClassificarIntencao.mockResolvedValue({
      intent: 'CONSULTA',
      params: { category: 'transporte', month: mes, type: 'gasto' },
      avisos: [],
    } as IntentPayload);
    mockGetCategoryMap.mockResolvedValue({ 1: 'Transporte', 2: 'Alimentação' });
    mockConsultarGastosGranulares.mockResolvedValue({
      total: 452,
      items: [
        {
          display_id: 12,
          description: 'Uber al aeropuerto',
          total_amount: 98,
          occurred_at: `${mes}-12T10:00:00.000Z`,
          categoria: 'Transporte',
          payment_method: 'credit_card',
        },
      ],
    });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('quanto gastei com transporte este mes?'), bot);

    // A categoria é resolvida em CÓDIGO (catálogo); jamais chega um category_id da IA.
    expect(mockConsultarGastosGranulares).toHaveBeenCalledWith(
      { categoryId: 1, month: mes, limite: undefined },
      expect.any(String)
    );
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Transporte');
    expect(texto).toContain('452,00');
    expect(texto).toContain(RODAPE_UX);
  });

  it('categoria desconhecida: avisa e lista as válidas do catálogo, sem consultar', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'CONSULTA',
      params: { category: 'placer', month: mesAtual() },
      avisos: [],
    } as IntentPayload);
    mockGetCategoryMap.mockResolvedValue({ 1: 'Transporte', 2: 'Alimentação' });

    const bot = criarBotMock();
    await messageHandler(criarMensagem('quanto gastei com placer este mes?'), bot);

    expect(mockConsultarGastosGranulares).not.toHaveBeenCalled();
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Não reconheço a categoria');
    expect(texto).toContain('Transporte');
    expect(texto).toContain(RODAPE_UX);
  });

  it('mês fora da janela: recusa por hard-limit em código, sem invocar a consulta', async () => {
    mockClassificarIntencao.mockResolvedValue({
      intent: 'CONSULTA',
      params: { category: 'transporte', month: '2100-01' },
      avisos: [],
    } as IntentPayload);

    const bot = criarBotMock();
    await messageHandler(criarMensagem('quanto gastei com transporte em janeiro de 2100?'), bot);

    expect(mockConsultarGastosGranulares).not.toHaveBeenCalled();
    expect(mockGetCategoryMap).not.toHaveBeenCalled();
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('últimos 12');
    expect(texto).toContain(RODAPE_UX);
  });
});

describe('messageHandler — roteamento de comandos diretos', () => {
  it('deve responder ao /start', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/start'), bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const texto = bot.sendMessage.mock.calls[0][1];
    expect(texto).toContain('Bem-vindo ao MyFinances');
    expect(mockClassificarIntencao).not.toHaveBeenCalled();
  });

    it('deve responder que comando não reconhecido para "/xyz"', async () => {
    const bot = criarBotMock();
    await messageHandler(criarMensagem('/xyz'), bot);

    expect(bot.sendMessage).toHaveBeenCalledWith(999, '❓ Comando não reconhecido. Use /start para ver os comandos disponíveis.');
  });

  // ── /cartao add — cobertura do parseArgumentosAdd (Fase 6) ───────────────
  describe('messageHandler — /cartao add (parse inteligente)', () => {
    const mockCartaoBase = {
      id: 'card-1',
      name: 'Santander',
      closing_day: 1,
      card_type: 'credit' as const,
      is_default: true,
    };

    /** Fábrica: mock define definirCartao retornando um cartão com os campos dados. */
    function mockDefinirCartaoComo(nome: string, closingDay: number, tipo: 'credit' | 'meal_voucher' | 'food_voucher') {
      mockDefinirCartao.mockResolvedValue({
        id: 'card-xyz',
        name: nome,
        closing_day: closingDay,
        card_type: tipo,
        is_default: true,
      });
    }

    it('deve criar cartão com defaults quando só o nome é informado', async () => {
      mockDefinirCartaoComo('Santander', 1, 'credit');

      const bot = criarBotMock();
      await messageHandler(criarMensagem('/cartao add Santander'), bot);

      // parse: nome="Santander", closing_day=1 (default), tipo=credit (default)
      expect(mockDefinirCartao).toHaveBeenCalledWith('Santander', 1, expect.any(String), 'credit');
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
      const texto = bot.sendMessage.mock.calls[0][1];
      expect(texto).toContain('💳');
      expect(texto).toContain('Crédito salvo');
      expect(texto).toContain('Santander');
      expect(texto).toContain('1');
      expect(texto).not.toContain('Vale');
    });

        it('deve criar cartão com dia de fechamento personalizado', async () => {
      mockDefinirCartaoComo('Santander', 20, 'credit');

      const bot = criarBotMock();
      await messageHandler(criarMensagem('/cartao add Santander 20'), bot);

      expect(mockDefinirCartao).toHaveBeenCalledWith('Santander', 20, expect.any(String), 'credit');
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
      const texto = bot.sendMessage.mock.calls[0][1];
      expect(texto).toContain('📅 Dia de fechamento: 20'); // dia reflete no corpo da mensagem
    });

    it('deve criar cartão com dia e tipo (vr → meal_voucher)', async () => {
      mockDefinirCartaoComo('Ticket', 15, 'meal_voucher');

      const bot = criarBotMock();
      await messageHandler(criarMensagem('/cartao add Ticket 15 vr'), bot);

      expect(mockDefinirCartao).toHaveBeenCalledWith('Ticket', 15, expect.any(String), 'meal_voucher');
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
      const texto = bot.sendMessage.mock.calls[0][1];
      expect(texto).toContain('🍽️'); // emoji de meal_voucher
      expect(texto).toContain('Vale-refeição salvo');
      expect(texto).toContain('Ticket');
      expect(texto).toContain('15');
    });

        it('deve responder com erro amigável quando o segundo token não é dia nem tipo', async () => {
      const bot = criarBotMock();
      await messageHandler(criarMensagem('/cartao add Santander abc'), bot);

      // O parse falha antes de chegar ao serviço — definirCartao nunca é chamado
      expect(mockDefinirCartao).not.toHaveBeenCalled();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
      const texto = bot.sendMessage.mock.calls[0][1];
      expect(texto).toContain('❌');
      expect(texto).toContain('Não entendi "abc"');
      expect(texto).toContain('Ex: /cartao add Santander 1 credito');
    });
  });

  describe('messageHandler — /cartao sozinho (mensagem de ajuda clara)', () => {
    beforeEach(() => {
      // Por padrão, nenhum cartão cadastrado
      mockListarCartoes.mockResolvedValue([]);
    });

    it('deve exibir ajuda com todos os sub-comandos quando /cartao vem sem argumentos', async () => {
      const bot = criarBotMock();
      await messageHandler(criarMensagem('/cartao'), bot);

      // Primeira mensagem: ajuda com os comandos
      const textoAjuda = bot.sendMessage.mock.calls[0][1];
      expect(textoAjuda).toContain('/cartao add');
      expect(textoAjuda).toContain('/cartao principal');
      expect(textoAjuda).toContain('/cartao remover');
      expect(textoAjuda).toContain('/cartao fatura');
      expect(textoAjuda).toContain('Exemplos');

      // Segunda mensagem: lista vazia
      const textoLista = bot.sendMessage.mock.calls[1][1];
      expect(textoLista).toContain('Nenhum cartão ou vale cadastrado');
    });
  });
});
