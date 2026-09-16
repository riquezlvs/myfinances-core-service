import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN } from '../config/env';

let instance: TelegramBot | null = null;

export function getTelegramBot(): TelegramBot {
  if (!instance) {
    // Inicializa sem iniciar o polling imediatamente no construtor.
    // O polling é iniciado de forma controlada em iniciarBot() após
    // a limpeza de eventuais webhooks residuais e registro dos listeners.
    instance = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
  }
  return instance;
}