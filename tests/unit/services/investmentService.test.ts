import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/accounts/accountService', () => ({
  listarContas: vi.fn(),
  ajustarSaldo: vi.fn(),
  criarOuAtualizarConta: vi.fn(),
}));

vi.mock('../../../src/services/investments/assetPriceService', () => ({
  listarAtivos: vi.fn(),
  cadastrarOuAtualizarAtivo: vi.fn(),
}));

vi.mock('../../../src/services/patrimony/patrimonyService', () => ({
  obterResumoPatrimonio: vi.fn(),
}));

vi.mock('../../../src/clients/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

import {
  obterDadosInvestimentosDashboard,
  obterExtratoInvestimentos,
  ajustarSaldoInstituicao,
} from '../../../src/services/investments/investmentService';
import { listarContas, ajustarSaldo } from '../../../src/services/accounts/accountService';
import { listarAtivos } from '../../../src/services/investments/assetPriceService';
import { obterResumoPatrimonio } from '../../../src/services/patrimony/patrimonyService';
import { getSupabaseClient } from '../../../src/clients/supabaseClient';

describe('investmentService — Testes Unitários de Investimentos & Extrato Real', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('obterDadosInvestimentosDashboard', () => {
    it('deve ignorar ativos órfãos e não exibir valor fantasma em Renda Variável', async () => {
      // Conta ativa real do usuário (apenas Nubank e Caixinha)
      vi.mocked(listarContas).mockResolvedValue([
        { id: 'acc-1', name: 'Nubank', type: 'checking', balance: 1000, is_active: true } as any,
        { id: 'acc-2', name: 'Caixinha Reserva', type: 'fixed_income', balance: 5000, is_active: true } as any,
      ]);

      // Ativo órfão na tabela investment_assets apontando para conta inexistente ou excluída
      vi.mocked(listarAtivos).mockResolvedValue([
        {
          id: 'asset-orphan',
          account_id: 'acc-deleted-999',
          ticker: 'PETR4',
          asset_type: 'stock',
          quantity: 100,
          average_price: 35.0,
          current_price: 40.0,
        } as any,
      ]);

      vi.mocked(obterResumoPatrimonio).mockResolvedValue(null as any);

      const dados = await obterDadosInvestimentosDashboard('req-test-1');

      // Renda Variável deve ser estritamente 0 porque o ativo órfão pertence a conta excluída
      const rvAlocacao = dados.alocacao.find((a) => a.id === 'rv');
      expect(rvAlocacao?.value ?? 0).toBe(0);

      // Renda Fixa e Líquido devem refletir os saldos reais das contas ativas
      const rfAlocacao = dados.alocacao.find((a) => a.id === 'rf');
      expect(rfAlocacao?.value).toBe(5000);

      const resAlocacao = dados.alocacao.find((a) => a.id === 'reserva');
      expect(resAlocacao?.value).toBe(1000);
    });

    it('deve computar saldo de contas do tipo investment_broker na Renda Variável', async () => {
      vi.mocked(listarContas).mockResolvedValue([
        { id: 'acc-1', name: 'Nubank', type: 'checking', balance: 500, is_active: true } as any,
        { id: 'acc-broker', name: 'XP Investimentos', type: 'investment_broker', balance: 2500, is_active: true } as any,
      ]);

      // Sem ativos detalhados registrados individualmente
      vi.mocked(listarAtivos).mockResolvedValue([]);
      vi.mocked(obterResumoPatrimonio).mockResolvedValue(null as any);

      const dados = await obterDadosInvestimentosDashboard('req-test-2');

      const rvAlocacao = dados.alocacao.find((a) => a.id === 'rv');
      expect(rvAlocacao?.value).toBe(2500);
      expect(dados.patrimonioTotal).toBe(3000);
    });
  });

  describe('obterExtratoInvestimentos', () => {
    it('deve retornar dados reais do banco sem nenhum mock quando houver transações', async () => {
      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'tx-real-1',
              display_id: 101,
              description: 'Aporte MXRF11',
              total_amount: 500.0,
              occurred_at: '2026-10-01T12:00:00Z',
              entry_type: 'expense',
              payment_method: 'investment',
              accounts: { id: 'acc-broker', name: 'XP Investimentos', type: 'investment_broker' },
            },
            {
              id: 'tx-real-2',
              display_id: 102,
              description: 'Rendimento Caixinha CDI',
              total_amount: 45.2,
              occurred_at: '2026-10-02T10:00:00Z',
              entry_type: 'yield',
              payment_method: 'investment',
              accounts: { id: 'acc-2', name: 'Caixinha Reserva', type: 'fixed_income' },
            },
          ],
          error: null,
        }),
      };

      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQueryBuilder),
      } as any);

      const resp = await obterExtratoInvestimentos({ mesAno: '2026-10' }, 'req-extrato-1');

      expect(resp.totalItens).toBe(2);
      expect(resp.resumoMes.totalAportado).toBe(500);
      expect(resp.resumoMes.proventos).toBe(45.2);
      expect(resp.resumoMes.proventosQtd).toBe(1);

      // Verifica que NÃO contém os mocks antigos (tx-1 Tesouro Selic 2029 de 2024)
      const todosIds = Object.values(resp.grupos).flat().map((i) => i.id);
      expect(todosIds).toContain(101);
      expect(todosIds).toContain(102);
      expect(todosIds).not.toContain('tx-1');
      expect(todosIds).not.toContain('tx-5');
    });

    it('deve retornar grupos vazios e totais zerados quando não houver transações', async () => {
      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      };

      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQueryBuilder),
      } as any);

      const resp = await obterExtratoInvestimentos({ mesAno: '2026-10' }, 'req-extrato-empty');

      expect(resp.totalItens).toBe(0);
      expect(resp.resumoMes.totalAportado).toBe(0);
      expect(resp.resumoMes.proventos).toBe(0);
      expect(resp.resumoMes.proventosQtd).toBe(0);
      expect(Object.keys(resp.grupos)).toHaveLength(0);
    });
  });

  describe('ajustarSaldoInstituicao', () => {
    it('deve ajustar o saldo da conta e opcionalmente registrar a transação no extrato', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockQueryBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'a0000000-0000-0000-0000-000000000001', name: 'Caixinha Reserva', balance: 5000 },
        }),
        insert: mockInsert,
      };

      vi.mocked(getSupabaseClient).mockReturnValue({
        from: vi.fn().mockReturnValue(mockQueryBuilder),
      } as any);

      vi.mocked(ajustarSaldo).mockResolvedValue({
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Caixinha Reserva',
        balance: 5150,
      } as any);

      const res = await ajustarSaldoInstituicao(
        {
          accountId: 'a0000000-0000-0000-0000-000000000001',
          novoSaldo: 5150,
          registrarTransacao: true,
        },
        'req-ajuste-test'
      );

      expect(res.sucesso).toBe(true);
      expect(res.dados.balance).toBe(5150);
      expect(ajustarSaldo).toHaveBeenCalledWith('a0000000-0000-0000-0000-000000000001', 5150, 'req-ajuste-test');
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });
});
