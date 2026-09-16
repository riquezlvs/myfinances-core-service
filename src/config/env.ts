const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_AUTHORIZED_USER_ID,
  GEMINI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BOT_NAME: botNameEnv,
  BOT_PROFILE_PHOTO_PATH: botProfilePhotoPathEnv,
} = process.env;

if (
  !TELEGRAM_BOT_TOKEN ||
  !TELEGRAM_AUTHORIZED_USER_ID ||
  !GEMINI_API_KEY ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error('❌ Variáveis de ambiente faltando. Confira o .env com base no .env.example.');
}

const telegramBotToken = TELEGRAM_BOT_TOKEN;
const supabaseUrl = SUPABASE_URL;
const supabaseServiceRoleKey = SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = GEMINI_API_KEY;
const authorizedUserId = TELEGRAM_AUTHORIZED_USER_ID;
const botName = botNameEnv ?? 'Guará IA';
const botProfilePhotoPath = botProfilePhotoPathEnv;

export {
  telegramBotToken as TELEGRAM_BOT_TOKEN,
  supabaseUrl as SUPABASE_URL,
  supabaseServiceRoleKey as SUPABASE_SERVICE_ROLE_KEY,
  geminiApiKey as GEMINI_API_KEY,
};
const cleanAuthorizedUserId = (authorizedUserId ?? '').replace(/['"]/g, '').trim();
const parsedUserId = Number(cleanAuthorizedUserId);
if (isNaN(parsedUserId) || parsedUserId <= 0) {
  throw new Error(`❌ TELEGRAM_AUTHORIZED_USER_ID inválido: "${authorizedUserId}". Deve ser um ID numérico.`);
}
export const AUTHORIZED_USER_ID = parsedUserId;

/** Nome exibido do bot no Telegram (padrão: "Guará IA"). */
export const BOT_NAME = botName;

/**
 * Caminho (local) ou URL da foto de perfil do bot.
 * - Local:  /caminho/completo/para/foto.jpg
 * - URL:    https://exemplo.com/foto.jpg
 * Opcional — quando ausente, a foto não é atualizada.
 */
export const BOT_PROFILE_PHOTO_PATH = botProfilePhotoPath;