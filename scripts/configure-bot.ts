/**
 * Script standalone para sincronizar a identidade do bot no Telegram
 * (nome "Guará IA", descrição curta/longa e foto de perfil).
 *
 * Uso:
 *   npm run setup-bot
 *
 * Pré-requisitos:
 *   - .env preenchido (TELEGRAM_BOT_TOKEN)
 *   - Opcional: BOT_PROFILE_PHOTO_PATH apontando para a imagem do projeto
 *     (ex: BOT_PROFILE_PHOTO_PATH=./assets/bot-avatar.jpg)
 *
 * Ao contrário da chamada automática dentro de `iniciarBot()`, este script
 * permite rodar apenas a configuração de identidade sem iniciar o polling.
 */
import 'dotenv/config';
import { getTelegramBot } from '../src/clients/telegramClient';
import { configureBot } from '../src/bot/setupBot';
import { log } from '../src/utils/logger';

async function main(): Promise<void> {
  const bot = getTelegramBot();
  await configureBot(bot);
  log('info', '✅ Identidade do bot sincronizada. Encerrando...');
  await bot.stopPolling();
}

main().catch((err) => {
  log('error', '💥 Falha ao configurar identidade do bot', {
    erro: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
