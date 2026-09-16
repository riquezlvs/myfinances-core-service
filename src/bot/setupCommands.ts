import { getTelegramBot } from '../clients/telegramClient';
import { log } from '../utils/logger';

/** Configura o menu nativo do Telegram (objetivo 11: UX Nativa). */
export async function setupCommands(): Promise<void> {
  const bot = getTelegramBot();

  await bot.setMyCommands([
    { command: 'start', description: 'Ver como usar o bot' },
    { command: 'patrimonio', description: 'Ver patrimônio consolidado e alocação' },
    { command: 'saldo', description: 'Saldo real vs Saldo livre (Safe-to-Spend)' },
    { command: 'investimentos', description: 'Caixinhas (% CDI) e Renda Variável' },
    { command: 'ajustar_saldo', description: 'Conciliar saldo de conta ou VR' },
    { command: 'resumo', description: 'Resumo do mês atual' },
    { command: 'fatura', description: 'Fatura do cartão de crédito' },
    { command: 'dividas', description: 'Quem te deve' },
    { command: 'gastos', description: 'Últimos gastos registrados' },
    { command: 'pago', description: 'Registrar um pagamento recebido' },
    { command: 'desfazer', description: 'Apagar o último gasto' },
    { command: 'apagar', description: 'Apagar um gasto específico pelo ID' },
    { command: 'recorrente', description: 'Listar/gerenciar despesas fixas mensais' },
    { command: 'exportar', description: 'Exportar CSV do mês ou dívidas' },
    { command: 'grafico', description: 'Gráfico de gastos por categoria' },
    { command: 'insight', description: 'Análise IA dos seus gastos do mês' },
    { command: 'meta', description: 'Metas de gasto por categoria' },
    { command: 'cartao', description: 'Cartões e faturas por fechamento' },
    { command: 'poupanca', description: 'Metas de poupança de longo prazo' },
    { command: 'viagem', description: 'Modo viagem (gastos em USD/EUR)' },
    { command: 'status', description: 'Status do serviço (uptime, latência, versão)' },
  ]);

  log('info', '🧭 Menu de comandos nativo configurado');
}