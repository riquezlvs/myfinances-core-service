import { getTelegramBot } from '../clients/telegramClient';
import { log } from '../utils/logger';

/** Configura o menu nativo do Telegram (objetivo 11: UX Nativa). */
export async function setupCommands(): Promise<void> {
  const bot = getTelegramBot();

  await bot.setMyCommands([
    { command: 'start', description: 'Ver como usar o bot' },
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
  ]);

  log('info', '🧭 Menu de comandos nativo configurado');
}