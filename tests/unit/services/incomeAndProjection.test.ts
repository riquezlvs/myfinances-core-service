import {
  calcularDataEfetivaRecorrencia,
  cadastrarNovaRecorrencia,
} from '../../../src/services/recurring/recurringService';
import { registrarReceitaAvulsa } from '../../../src/services/incomes/incomeService';
import { getSupabaseClient } from '../../../src/clients/supabaseClient';
import * as accountService from '../../../src/services/accounts/accountService';
import * as categoryCache from '../../../src/services/categories/categoryCache';

vi.mock('../../../src/clients/supabaseClient');
vi.mock('../../../src/utils/logger', () => ({
  log: vi.fn(),
  withTiming: vi.fn((_label, _meta, fn) => fn()),
}));

describe('Projeção de Renda Recorrente e Regras de Fim de Semana', () => {
  it('se cair em sábado com regra anticipate: recua para sexta-feira', () => {
    // 28 de fevereiro de 2026 é um sábado
    const dataEfetiva = calcularDataEfetivaRecorrencia(28, 2026, 1, 'anticipate');
    expect(dataEfetiva.getUTCDate()).toBe(27); // sexta-feira
    expect(dataEfetiva.getUTCDay()).toBe(5);
  });

  it('se cair em domingo com regra anticipate: recua para sexta-feira', () => {
    // 1 de março de 2026 é um domingo
    const dataEfetiva = calcularDataEfetivaRecorrencia(1, 2026, 2, 'anticipate');
    expect(dataEfetiva.getUTCDate()).toBe(27); // 27 de fevereiro
    expect(dataEfetiva.getUTCDay()).toBe(5);
  });

  it('se cair em sábado com regra postpone: avança para segunda-feira', () => {
    // 28 de fevereiro de 2026 é um sábado
    const dataEfetiva = calcularDataEfetivaRecorrencia(28, 2026, 1, 'postpone');
    expect(dataEfetiva.getUTCDate()).toBe(2); // 2 de março (segunda)
    expect(dataEfetiva.getUTCDay()).toBe(1);
  });

  it('se cair em dia de semana útil: mantém o dia exato', () => {
    // 20 de outubro de 2026 é uma terça-feira
    const dataEfetiva = calcularDataEfetivaRecorrencia(20, 2026, 9, 'anticipate');
    expect(dataEfetiva.getUTCDate()).toBe(20);
    expect(dataEfetiva.getUTCDay()).toBe(2);
  });
});

describe('Receitas Avulsas (Freelance / Terceiros / Extras)', () => {
  const mockFrom = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getSupabaseClient as any).mockReturnValue({ from: mockFrom });
  });

  it('cadastra receita avulsa realizada hoje e credita na conta destino', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        display_id: 88,
        description: 'Freela Landing Page',
        total_amount: 1500,
        occurred_at: new Date().toISOString(),
      },
      error: null,
    });

    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });

    mockFrom.mockReturnValue({ insert: insertMock });

    const spyObterConta = vi.spyOn(accountService, 'obterContaPorId').mockResolvedValue({
      id: 'acc-nubank',
      name: 'Nubank Conta',
      type: 'checking',
      balance: 500,
      is_active: true,
      created_at: '',
      updated_at: '',
    });

    const spyCreditar = vi.spyOn(accountService, 'creditarSaldo').mockResolvedValue(2000);

    const resultado = await registrarReceitaAvulsa({
      description: 'Freela Landing Page',
      amount: 1500,
      accountId: 'acc-nubank',
      incomeType: 'freelance',
    }, 'req-test');

    expect(resultado.displayId).toBe(88);
    expect(resultado.totalAmount).toBe(1500);
    expect(resultado.accountName).toBe('Nubank Conta');
    expect(resultado.novoSaldo).toBe(2000);
    expect(spyCreditar).toHaveBeenCalledWith('acc-nubank', 1500, 'req-test');

    spyObterConta.mockRestore();
    spyCreditar.mockRestore();
  });

  it('cadastra recorrência de renda sem category_id atribuindo categoria padrão sem estourar constraint', async () => {
    let payloadInserido: any = null;

    const singleMock = vi.fn().mockImplementation(() => ({
      data: {
        id: 'rec-salario-1',
        description: 'Salário CLT',
        total_amount: 5500,
        day_of_month: 5,
        entry_type: 'income',
        category_id: payloadInserido?.category_id,
        is_active: true,
      },
      error: null,
    }));

    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockImplementation((payload) => {
      payloadInserido = payload;
      return { select: selectMock };
    });

    mockFrom.mockReturnValue({ insert: insertMock });

    // Mock do catálogo com categoria "Receitas" (ID 10)
    const spyCategory = vi.spyOn(categoryCache, 'obterCategoriaPadrao').mockResolvedValue(10);

    const resultado = await cadastrarNovaRecorrencia({
      description: 'Salário CLT',
      total_amount: 5500,
      day_of_month: 5,
      entry_type: 'income',
      income_type: 'salary',
      weekend_rule: 'anticipate',
      // category_id omitido intencionalmente
    }, 'req-test-rec');

    expect(resultado.id).toBe('rec-salario-1');
    expect(payloadInserido).not.toBeNull();
    expect(payloadInserido.category_id).toBe(10);
    expect(payloadInserido.entry_type).toBe('income');
    expect(payloadInserido.weekend_rule).toBe('anticipate');

    spyCategory.mockRestore();
  });

  it('cadastra recorrência com category_id explícito respeitando a escolha', async () => {
    let payloadInserido: any = null;

    const singleMock = vi.fn().mockImplementation(() => ({
      data: {
        id: 'rec-2',
        description: 'Bolsa',
        total_amount: 800,
        day_of_month: 10,
        entry_type: 'income',
        category_id: 3,
        is_active: true,
      },
      error: null,
    }));

    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockImplementation((payload) => {
      payloadInserido = payload;
      return { select: selectMock };
    });

    mockFrom.mockReturnValue({ insert: insertMock });

    const resultado = await cadastrarNovaRecorrencia({
      description: 'Bolsa',
      total_amount: 800,
      day_of_month: 10,
      entry_type: 'income',
      category_id: 3,
    }, 'req-test-rec-2');

    expect(resultado.id).toBe('rec-2');
    expect(payloadInserido.category_id).toBe(3);
  });
});

