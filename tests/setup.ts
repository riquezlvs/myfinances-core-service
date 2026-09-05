// Setup global para os testes: define variáveis de ambiente mínimas para que
// src/config/env.ts não lance exceção durante a importação dos módulos.
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
process.env.TELEGRAM_AUTHORIZED_USER_ID = '12345';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';