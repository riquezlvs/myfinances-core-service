import { getTelegramBot } from '../../clients/telegramClient';

const bot = getTelegramBot();

export async function handleStart(chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    [
      '👋 Bem-vindo ao seu bot financeiro!',
      '',
      'Para registrar um gasto, mande em texto, ex:',
      '"Gastei 45 no almoço no pix"',
      '"Ifood de 50 dividido com minha irmã"',
      '"Tênis novo 300 em 3x no crédito"',
      '',
      'Comandos disponíveis:',
      '/resumo — resumo do mês, por método de pagamento',
      '/fatura — itens da fatura do cartão de crédito no mês',
      '/dividas — quanto cada pessoa te deve',
      '/gastos [n] — últimos n gastos, com o ID curto de cada um',
      '/pago <nome> [valor] — registra um pagamento (parcial ou total)',
      '/desfazer — apaga o último gasto (ou toda a compra parcelada)',
      '/apagar <id> — apaga um gasto específico pelo ID mostrado em /gastos',
      '',
      'Também entendo frases livres como "minha irmã já pagou 25 reais" —',
      'eu identifico sozinho se é um gasto novo, um pagamento ou uma consulta.',
    ].join('\n')
  );
}