import type TelegramBot from 'node-telegram-bot-api';
import { withTiming } from '../../utils/logger';
import { obterResumoPatrimonio, formatarMensagemPatrimonio } from '../../services/patrimony/patrimonyService';

export async function handlePatrimonio(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  await withTiming('comando /patrimonio', { requestId, chatId }, async () => {
    const summary = await obterResumoPatrimonio(requestId);
    const texto = formatarMensagemPatrimonio(summary);

    await bot.sendMessage(chatId, texto, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Atualizar Rendimentos CDI', callback_data: 'patrimonio:atualizar_cdi' },
            { text: '🏦 Ver Saldos', callback_data: 'patrimonio:saldos' },
          ],
        ],
      },
    });
  });
}
