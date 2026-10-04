/**
 * Camada de segurança da API HTTP.
 *
 * - Autenticação por chave secreta (Bearer) — somente o servidor do guara-web
 *   (que valida a sessão do usuário) conhece API_SECRET_KEY. O navegador nunca
 *   fala direto com este backend.
 * - CORS restrito a uma whitelist (ALLOWED_ORIGINS), nunca wildcard.
 * - Rate limiting por janela deslizante (anti força bruta / estouro de cota).
 * - Validadores e sanitizadores de parâmetros (UUID, inteiros, LIKE).
 * - Sanitização de mensagens de erro (não vazar estrutura do banco).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createHash, timingSafeEqual } from 'crypto';

// ─── Autenticação ──────────────────────────────────────────────────────────

const MIN_SECRET_LENGTH = 32;

/** Lida de forma preguiçosa para permitir configurar o env em testes. */
function obterApiSecret(): string | null {
  const segredo = (process.env.API_SECRET_KEY ?? '').trim();
  return segredo.length >= MIN_SECRET_LENGTH ? segredo : null;
}

export function apiSecretConfigurado(): boolean {
  return obterApiSecret() !== null;
}

/** Comparação em tempo constante (hash antes para igualar tamanhos). */
function compararSeguro(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifica o header `Authorization: Bearer <API_SECRET_KEY>`.
 * Falha fechada: sem segredo configurado, ninguém é autorizado.
 */
export function requisicaoAutorizada(req: IncomingMessage): boolean {
  const segredo = obterApiSecret();
  if (!segredo) return false;

  const header = req.headers?.authorization;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;

  const token = header.slice('Bearer '.length).trim();
  if (!token) return false;
  return compararSeguro(token, segredo);
}

// ─── CORS e cabeçalhos ────────────────────────────────────────────────────

function origensPermitidas(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  if (!env) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }
  return env
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Aplica CORS somente para origens da whitelist e cabeçalhos de segurança.
 * Sem origem permitida, nenhum `Access-Control-Allow-Origin` é enviado — o
 * navegador bloqueia a leitura da resposta por sites de terceiros.
 */
export function aplicarCabecalhosSeguranca(req: IncomingMessage | undefined, res: ServerResponse): void {
  const origem = req?.headers?.origin;
  const permitidas = origensPermitidas();
  if (origem && (permitidas.includes(origem.replace(/\/+$/, '')) || permitidas.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

// ─── Rate limiting ────────────────────────────────────────────────────────

export interface Limitador {
  /** true se pode prosseguir; false se estourou o limite. */
  permitir(chave: string): boolean;
  limpar(): void;
}

/** Janela deslizante em memória (processo único). */
export function criarLimitador(maxRequisicoes: number, janelaMs: number): Limitador {
  const registros = new Map<string, number[]>();
  return {
    permitir(chave: string): boolean {
      const agora = Date.now();
      const inicio = agora - janelaMs;
      const lista = (registros.get(chave) ?? []).filter((t) => t > inicio);
      if (lista.length >= maxRequisicoes) {
        registros.set(chave, lista);
        return false;
      }
      lista.push(agora);
      registros.set(chave, lista);
      // Limpeza oportunista para não crescer indefinidamente.
      if (registros.size > 5000) {
        for (const [k, v] of registros) {
          if (!v.some((t) => t > inicio)) registros.delete(k);
        }
      }
      return true;
    },
    limpar(): void {
      registros.clear();
    },
  };
}

export function obterIpCliente(req: IncomingMessage): string {
  const encaminhado = req.headers?.['x-forwarded-for'];
  const primeiro = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado?.split(',')[0];
  return (primeiro?.trim() || req.socket?.remoteAddress || 'desconhecido').slice(0, 64);
}

// ─── Validadores ──────────────────────────────────────────────────────────

const ID_SEGURO_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[a-zA-Z0-9_-]{1,64}$/i;

export function isUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && ID_SEGURO_REGEX.test(valor.trim());
}

/** Inteiro positivo estrito ("12" → 12; "12abc", "1.5", "-3" → null). */
export function inteiroPositivo(valor: unknown): number | null {
  const texto = String(valor ?? '').trim();
  if (!/^\d{1,10}$/.test(texto)) return null;
  const n = Number(texto);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** Escapa curingas do LIKE/ILIKE do Postgres e limita o tamanho. */
export function escaparLike(valor: string, max = 60): string {
  return valor.slice(0, max).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class ErroValidacao extends Error {
  readonly statusCode = 400;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroValidacao';
  }
}

/** Lança ErroValidacao se o valor não for UUID. */
export function exigirUuid(valor: unknown, campo: string): string {
  if (!isUuid(valor)) throw new ErroValidacao(`O campo "${campo}" deve ser um identificador válido.`);
  return valor.trim();
}

// ─── Sanitização de erros ─────────────────────────────────────────────────

const PADROES_ERRO_INTERNO = [
  /relation\s+"/i,
  /column\s+"/i,
  /violates/i,
  /constraint/i,
  /duplicate key/i,
  /syntax error/i,
  /invalid input syntax/i,
  /PGRST\d+/i,
  /permission denied/i,
  /schema cache/i,
  /supabase/i,
  /postgres/i,
  /fetch failed/i,
  /ECONN/i,
  /\bat\s+\S+\s+\(/, // stack trace
];

/**
 * Retorna a mensagem do erro apenas se ela for uma mensagem de negócio segura
 * para o usuário. Mensagens que expõem detalhes de banco/infra viram o
 * fallback genérico (o erro completo continua indo para o log).
 */
export function mensagemErroSegura(err: unknown, fallback: string): string {
  const mensagem = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!mensagem || mensagem.length > 300) return fallback;
  if (PADROES_ERRO_INTERNO.some((re) => re.test(mensagem))) return fallback;
  return mensagem;
}
