/**
 * Tokens de login de uso único (link mágico via Telegram).
 *
 * O bot gera um token aleatório de 256 bits, válido por poucos minutos e que
 * só pode ser consumido UMA vez. O guara-web troca esse token por uma sessão
 * persistente no aparelho. Armazenamento em memória (processo único): um
 * restart do backend simplesmente invalida os links pendentes.
 */
import { randomBytes, createHash } from 'crypto';

export const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_TOKENS_ATIVOS = 5;

/** Guardamos apenas o hash do token (vazamento de memória/log não expõe o link). */
const tokens = new Map<string, number>(); // hash → expiraEm

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function limparExpirados(agora: number): void {
  for (const [h, expiraEm] of tokens) {
    if (expiraEm <= agora) tokens.delete(h);
  }
}

export function gerarTokenLogin(): { token: string; expiraEm: number } {
  const agora = Date.now();
  limparExpirados(agora);

  // Mantém no máximo N links pendentes (descarta os mais antigos).
  while (tokens.size >= MAX_TOKENS_ATIVOS) {
    const maisAntigo = tokens.keys().next().value;
    if (maisAntigo === undefined) break;
    tokens.delete(maisAntigo);
  }

  const token = randomBytes(32).toString('base64url');
  const expiraEm = agora + LOGIN_TOKEN_TTL_MS;
  tokens.set(hash(token), expiraEm);
  return { token, expiraEm };
}

/** Consome o token: retorna true apenas na primeira vez e dentro da validade. */
export function consumirTokenLogin(token: unknown): boolean {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const agora = Date.now();
  limparExpirados(agora);

  const h = hash(token);
  const expiraEm = tokens.get(h);
  if (expiraEm === undefined) return false;
  tokens.delete(h);
  return expiraEm > agora;
}

/** Invalida todos os links pendentes (útil para testes). */
export function limparTokensLogin(): void {
  tokens.clear();
}
