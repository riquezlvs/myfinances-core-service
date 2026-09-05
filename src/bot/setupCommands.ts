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
  ]);

  log('info', '🧭 Menu de comandos nativo configurado');
}