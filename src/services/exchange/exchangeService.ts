/**
 * Fase 9 — Serviço de câmbio (modo viagem).
 *
 * Busca cotações USD/EUR para BRL com cache em memória (TTL 1h) e fallback
 * fixo caso a API externa esteja indisponível. Nenhuma regra de conversão
 * depende da IA — o valor em BRL é calculado em código.
 */

import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';

const API_BASE = 'https://api.exchangerate.host';
export const MOEDAS_SUPORTADAS = ['USD', 'EUR'] as const;
type MoedaSuportada = (typeof MOEDAS_SUPORTADAS)[number];

interface CacheEntry {
  rate: number;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_CACHE_MS = 60 * 60 * 1000; // 1 hora

/** Fallback fixo quando a API externa falha (último recurso). */
const FALLBACK: Record<MoedaSuportada, number> = {
  USD: 5.20,
  EUR: 6.10,
};

export interface ResultadoConversao {
  valorOriginal: number;
  moedaOriginal: MoedaSuportada;
  valorBRL: number;
  taxa: number;
  dadosDaApi: boolean;
}

/** Valida se a moeda é suportada. */
export function isMoedaSuportada(moeda: string): moeda is MoedaSuportada {
  return (MOEDAS_SUPORTADAS as readonly string[]).includes(moeda.toUpperCase());
}

/** Busca a taxa de câmbio com cache em memória. */
export async function buscarTaxa(
  moeda: MoedaSuportada,
  requestId: string
): Promise<{ taxa: number; daApi: boolean }> {
  const agora = Date.now();
  const cached = cache.get(moeda);

  if (cached && agora - cached.timestamp < TTL_CACHE_MS) {
    return { taxa: cached.rate, daApi: true };
  }

  try {
    const data = await withTiming('buscar taxa de câmbio', { requestId, moeda }, async () => {
      const url = `${API_BASE}/convert?from=${moeda}&to=BRL&amount=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as { result?: number };
      if (!json.result || typeof json.result !== 'number' || json.result <= 0) {
        throw new Error('Resposta inválida da API');
      }
      return json.result;
    });

    cache.set(moeda, { rate: data, timestamp: agora });
    return { taxa: data, daApi: true };
  } catch (err) {
    log('warn', 'Falha ao buscar taxa de câmbio, usando fallback', {
      requestId,
      moeda,
      erro: err instanceof Error ? err.message : String(err),
    });
    return { taxa: FALLBACK[moeda], daApi: false };
  }
}

/** Converte um valor em moeda estrangeira para BRL. */
export async function converterParaBRL(
  valor: number,
  moeda: MoedaSuportada,
  requestId: string
): Promise<ResultadoConversao> {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor para conversão inválido.');
  }

  const { taxa, daApi } = await buscarTaxa(moeda, requestId);
  const valorBRL = Math.round(valor * taxa * 100) / 100;

  return {
    valorOriginal: valor,
    moedaOriginal: moeda,
    valorBRL,
    taxa,
    dadosDaApi: daApi,
  };
}

/** Formata o valor original + conversão para exibição. */
export function formatarConversao(resultado: ResultadoConversao): string {
  const simbolo = resultado.moedaOriginal === 'USD' ? 'US$' : '€';
  return `${simbolo} ${resultado.valorOriginal.toFixed(2).replace('.', ',')} - Câmbio: ${resultado.taxa.toFixed(2).replace('.', ',')} → R$ ${formatarReal(resultado.valorBRL)}`;
}

/** Limpa o cache de taxas (útil para testes). */
export function limparCacheTaxas(): void {
  cache.clear();
}