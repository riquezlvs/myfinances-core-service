const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_AUTHORIZED_USER_ID,
  GEMINI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
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

export {
  telegramBotToken as TELEGRAM_BOT_TOKEN,
  supabaseUrl as SUPABASE_URL,
  supabaseServiceRoleKey as SUPABASE_SERVICE_ROLE_KEY,
  geminiApiKey as GEMINI_API_KEY,
};
export const AUTHORIZED_USER_ID = Number(authorizedUserId);