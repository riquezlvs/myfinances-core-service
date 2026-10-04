/**
 * Comando /login_web (ou /login) no Telegram.
 *
 * Gera um link mágico de uso único (com token aleatório de 256 bits) válido
 * por 5 minutos. Ao tocar no link no celular, o guara-web troca o token
 * por uma sessão persistente de 90 dias sem que o usuário precise digitar senha.
 */
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { gerarTokenLogin, LOGIN_TOKEN_TTL_MS } from '../../api/loginTokens';
import { log } from '../../utils/logger';

export async function handleLoginWeb(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const { token } = gerarTokenLogin();
  const minutos = Math.round(LOGIN_TOKEN_TTL_MS / 60_000);
  const webAppUrl = (process.env.WEB_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const linkMagico = `${webAppUrl}/login?token=${token}`;

  log('info', '🔑 Link mágico de login gerado via Telegram', { requestId, chatId });

  const texto = [
    '🔐 *Acesso ao Guará Web*',
    '',
    'Toque no link abaixo no seu celular para entrar instantaneamente sem digitar senha:',
    '',
    `👉 [Abrir Guará Web no Celular](${linkMagico})`,
    '',
    `⏱ _Válido por ${minutos} minutos e expira após o primeiro uso._`,
    '📱 _Ao entrar com "Lembrar deste celular", seu aparelho fica conectado automaticamente por meses!_',
  ].join('\n');

  await bot.sendMessage(chatId, texto, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
}
