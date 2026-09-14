import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import { handleCartao, parseArgumentosAdd } from '../../../src/bot/commands/cartao';
import { listarCartoes } from '../../../src/services/cards/cardService';

vi.mock('../../../src/clients/telegramClient', () => ({
  getTelegramBot: () => ({ sendMessage: vi.fn() }),
}));
vi.mock('../../../src/services/cards/cardService', () => ({
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

const mockListarCartoes = vi.mocked(listarCartoes);

function criarBotMock() {
  const bot = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  };
  return bot as unknown as TelegramBot & typeof bot;
}

describe('cartao — parseArgumentosAdd', () => {
  it('retorna defaults quando só o nome é informado', () => {
    expect(parseArgumentosAdd(['Santander'])).toEqual({
      nome: 'Santander',
      closing_day: 1,
      tipo: 'credit',
    });
  });

  it('reconhece nome + dia', () => {
    expect(parseArgumentosAdd(['Santander', '30'])).toEqual({
      nome: 'Santander',
      closing_day: 28, // clamp de segurança
      tipo: 'credit',
    });
  });

  it('reconhece nome + tipo (alias vr)', () => {
    expect(parseArgumentosAdd(['Ticket', 'vr'])).toEqual({
      nome: 'Ticket',
      closing_day: 1,
      tipo: 'meal_voucher',
    });
  });

  it('reconhece nome + dia + tipo', () => {
    expect(parseArgumentosAdd(['Ticket', '15', 'vr'])).toEqual({
      nome: 'Ticket',
      closing_day: 15,
      tipo: 'meal_voucher',
    });
  });

  it('aceita nomes com espaços (nome + dia + tipo)', () => {
    expect(parseArgumentosAdd(['Meu', 'Banco', '10', 'va'])).toEqual({
      nome: 'Meu Banco',
      closing_day: 10,
      tipo: 'food_voucher',
    });
  });

  it('lança erro amigável quando o segundo token não é dia nem tipo', () => {
    expect(() => parseArgumentosAdd(['Santander', 'abc'])).toThrow('Não entendi "abc"');
  });

  it('lança erro amigável quando nenhum nome é informado', () => {
    expect(() => parseArgumentosAdd([])).toThrow('Faltou o nome do cartão');
  });
});

describe('cartao — handleCartao (/cartao lançando ajuda)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListarCartoes.mockResolvedValue([]);
  });

  it('exibe ajuda + mensagem de vazio quando /cartao vem sem argumentos', async () => {
    const bot = criarBotMock();
    await handleCartao(999, '', 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    const textoAjuda = bot.sendMessage.mock.calls[0][1] as string;
    expect(textoAjuda).toContain('/cartao add');
    expect(textoAjuda).toContain('/cartao principal');
    expect(textoAjuda).toContain('/cartao remover');
    expect(textoAjuda).toContain('/cartao fatura');

    const textoLista = bot.sendMessage.mock.calls[1][1] as string;
    expect(textoLista).toContain('Nenhum cartão ou vale cadastrado ainda');
  });

  it('lista apenas (sem repetir a ajuda) quando /cartao listar', async () => {
    const bot = criarBotMock();
    await handleCartao(999, 'listar', 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage.mock.calls[0][1]).toContain('Nenhum cartão ou vale cadastrado ainda');
  });

  it('exibe ajuda quando o sub-comando é desconhecido', async () => {
    const bot = criarBotMock();
    await handleCartao(999, 'xyz', 'req-1', bot);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage.mock.calls[0][1]).toContain('/cartao add');
  });
});
