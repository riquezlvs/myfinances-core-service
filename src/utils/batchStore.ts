// src/utils/batchStore.ts
import { randomBytes } from 'crypto';

interface LoteRegistro {
  displayIds: number[];
  criadoEm: number;
}

// Guarda os lotes recentes por até 2 horas em memória
const lotes = new Map<string, LoteRegistro>();
const TTL_MS = 2 * 60 * 60 * 1000;

function limparExpirados(): void {
  const agora = Date.now();
  for (const [token, lote] of lotes.entries()) {
    if (agora - lote.criadoEm > TTL_MS) {
      lotes.delete(token);
    }
  }
}

/**
 * Registra um lote de displayIds e retorna um token curto de 8 caracteres
 * seguro para ser usado no callback_data do Telegram (limite de 64 bytes).
 */
export function salvarLoteIds(displayIds: number[]): string {
  limparExpirados();
  const token = randomBytes(4).toString('hex'); // 8 chars (ex: "a1b2c3d4")
  lotes.set(token, { displayIds, criadoEm: Date.now() });
  return token;
}

/**
 * Recupera os displayIds associados ao token do lote.
 * Suporta fallback se o token for uma lista de IDs separados por vírgula.
 */
export function obterLoteIds(tokenOuIds: string): number[] {
  limparExpirados();
  const lote = lotes.get(tokenOuIds);
  if (lote) {
    return lote.displayIds;
  }
  // Fallback se forem IDs diretamente no sufixo
  if (tokenOuIds.includes(',')) {
    return tokenOuIds.split(',').map(Number).filter(Number.isFinite);
  }
  const idUnico = Number(tokenOuIds);
  return Number.isFinite(idUnico) ? [idUnico] : [];
}
