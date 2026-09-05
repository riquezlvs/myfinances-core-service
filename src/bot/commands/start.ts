import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';

export async function handleStart(chatId: number, bot: TelegramBot = getTelegramBot()): Promise<void> {
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
      '/recorrente — ver/gerenciar despesas fixas mensais (add/remover)',
      '/exportar [gastos|dividas] — baixar um CSV com os dados',
      '/grafico — gráfico de gastos por categoria (imagem)',
      '/insight — análise inteligente dos seus gastos do mês',
      '/meta <categoria> <limite> — metas de gasto (alertas em 80%/100%)',
      '/cartao — cartões com fechamento e fatura por período real',
      '',
      'Também entendo frases livres como "minha irmã já pagou 25 reais" —',
      'eu identifico sozinho se é um gasto novo, um pagamento ou uma consulta.',
    ].join('\n')
  );
}
