// src/config/constants.ts
export const GEMINI_MODEL = 'gemini-3.5-flash';
export const CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

/** Limite de duração de áudio/voz aceito (protege o Free Tier contra abusos). */
export const MAX_AUDIO_DURATION_SECONDS = 90;

// Fase 7 -----------------------------------------------------------------

/** 7.3 — Janela máxima de deriva de occurred_at em relação a "agora". */
export const OCCURRED_AT_MAX_DRIFT_DAYS = 30;

/** 7.4 — Timeout das chamadas de texto ao Gemini (extração, intenção). */
export const GEMINI_TIMEOUT_MS = 60_000;

/** 7.4 — Timeout maior para chamadas multimodais (upload + transcrição). */
export const GEMINI_AUDIO_TIMEOUT_MS = 90_000;

/** 7.6 — Tamanho do cache FIFO de deduplicação de mensagens do Telegram. */
export const MESSAGE_DEDUPE_CACHE_SIZE = 100;

/**
 * 8.x — Janela de meses aceita em consultas/exportações vindas de linguagem
 * natural: últimos N meses + o mês seguinte. Hard-limit em CÓDIGO (a IA não
 * escolhe a janela; "2100-01" é rejeitado aqui).
 */
export const MAX_MONTH_LOOKBACK = 12;

/**
 * 8.1 — Rodapé padrão de UX (tom humanizado). Encerra respostas de sucesso e
 * de conclusão de fluxo, mantendo a conversa aberta sem exigir comandos.
 */
export const RODAPE_UX =
  'Se precisar registrar mais alguma coisa ou consultar seus gastos, é só avisar! 😊';

// Fase 8 — Guards (blindagem anti-alucinação) -------------------------------

/** Hard-limit: valor máximo de uma transação individual (R$). */
export const MAX_TRANSACTION_AMOUNT = 1_000_000;

/** Hard-limit: máximo de parcelas admitido (bloqueia data-bomb de N linhas). */
export const MAX_INSTALLMENTS = 120;

/** Hard-limit: largura máxima da descrição de uma transação. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Hard-limit: largura máxima de nomes (pessoas, cartões, categorias). */
export const MAX_NAME_LENGTH = 60;

// Fase 9 — Resiliência e concorrência ---------------------------------------

/** 9 — Capacidade do bucket de rate limiting (tokens por minuto por usuário). */
export const RATE_LIMIT_CAP = 30;

/** 9 — Taxa de recarga do bucket (tokens por minuto). */
export const RATE_LIMIT_REFILL_PER_MIN = 30;

/** 9 — Timeout para APIs externas (modo viagem). */
export const EXTERNAL_API_TIMEOUT_MS = 5_000;