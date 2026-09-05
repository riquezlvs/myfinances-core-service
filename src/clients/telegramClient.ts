import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN } from '../config/env';

let instance: TelegramBot | null = null;

export function getTelegramBot(): TelegramBot {
  if (!instance) {
    // polling: true por enquanto. Arquitetura preparada para trocar para
    // webhook futuramente bastando alterar esta função — nenhum outro
    // arquivo depende de como o bot recebe atualizações.
    instance = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  }
  return instance;
}