// src/utils/dedupe.ts
import { log } from './logger';
import { MESSAGE_DEDUPE_CACHE_SIZE } from '../config/constants';

/**
 * Fase 8 — Deduplicação de updates do Telegram (FIFO, tamanho fixo).
 *
 * Reentregas do Telegram (instabilidade de rede no polling, retries de
 * webhook) não devem disparar duas chamadas ao Gemini nem dois lançamentos
 * no Supabase. A chave é `${chatId}:${message_id}` — metadados da MENSAGEM,
 * nunca output de IA.
 */
const vistas: string[] = [];

export function mensagemDuplicada(chave: string | undefined): boolean {
  if (!chave) return false;

  if (vistas.includes(chave)) {
    log('warn', 'Mensagem duplicada ignorada (dedupe)', { chave });
    return true;
  }

  vistas.push(chave);
  if (vistas.length > MESSAGE_DEDUPE_CACHE_SIZE) {
    vistas.shift();
  }
  return false;
}
