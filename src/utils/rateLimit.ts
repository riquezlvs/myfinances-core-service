/**
 * Fase 9 — Rate Limiter com Token Bucket (em memória).
 *
 * Limita a taxa de mensagens por usuário para evitar abuso e estouro de
 * cotas do Gemini/Supabase. Implementação simples em memória: um balde de
 * tokens por chave (userId) que recarrega a cada minuto.
 *
 * Configuração padrão: 30 tokens por minuto (free tier friend).
 */

import { RATE_LIMIT_CAP, RATE_LIMIT_REFILL_PER_MIN } from '../config/constants';

interface Bucket {
  tokens: number;
  ultimaRecarga: number;
}

const buckets = new Map<string, Bucket>();

function recarregar(key: string, agora: number): Bucket {
  const bucket = buckets.get(key);
  if (!bucket) {
    const novo: Bucket = { tokens: RATE_LIMIT_CAP, ultimaRecarga: agora };
    buckets.set(key, novo);
    return novo;
  }

  const minutosPassados = Math.floor((agora - bucket.ultimaRecarga) / 60_000);
  if (minutosPassados > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_CAP, bucket.tokens + minutosPassados * RATE_LIMIT_REFILL_PER_MIN);
    bucket.ultimaRecarga = agora;
  }

  return bucket;
}

/**
 * Verifica se a chave pode consumir um token.
 * @returns true se pode prosseguir, false se excedeu o limite.
 */
export function verificarRateLimit(key: string): boolean {
  const bucket = recarregar(key, Date.now());
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Retorna o número de tokens restantes para uma chave.
 */
export function tokensRestantes(key: string): number {
  const bucket = buckets.get(key);
  return bucket ? Math.max(0, bucket.tokens) : RATE_LIMIT_CAP;
}

/**
 * Limpa o bucket de uma chave (útil para testes).
 */
export function limparBucket(key: string): void {
  buckets.delete(key);
}