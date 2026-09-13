// src/utils/month.ts
import { MAX_MONTH_LOOKBACK } from '../config/constants';

/**
 * Fase 8 — Hard-limit EM CÓDIGO da janela de meses aceita em consultas e
 * exportações: dos últimos MAX_MONTH_LOOKBACK meses até o mês seguinte.
 * Ignora completamente o que a IA sugerir (ex.: "2100-01" ou "1999-12").
 *
 * @param mesAno String no formato 'YYYY-MM' (já validada por regex no guard).
 */
export function mesAnoNaJanela(mesAno: string, agora: Date = new Date()): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesAno);
  if (!match) return false;

  const alvo = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const inicio = new Date(agora.getFullYear(), agora.getMonth() - MAX_MONTH_LOOKBACK, 1);
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 2, 1); // exclusivo

  return alvo >= inicio && alvo < fim;
}

/** 8.4 — Mês corrente no formato 'YYYY-MM' (default das consultas granulares). */
export function mesAnoAtual(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 8.4 — Converte 'YYYY-MM' no intervalo [início, fimExclusivo) em ISO, para
 * filtrar `occurred_at` no Supabase. Usa horário local (consistente com
 * getResumoMensal/getGastosPorCategoria). Retorna null se o formato for
 * inválido — o chamador nunca monta uma query com data alucinada.
 */
export function intervaloDoMes(mesAno: string): { inicioISO: string; fimISO: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesAno);
  if (!match) return null;

  const ano = Number(match[1]);
  const mes = Number(match[2]) - 1; // 0-based
  return {
    inicioISO: new Date(ano, mes, 1).toISOString(),
    fimISO: new Date(ano, mes + 1, 1).toISOString(),
  };
}

/** 8.4 — Rótulo humano do mês ("setembro de 2026") para as respostas. */
export function rotuloDoMes(mesAno: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesAno);
  if (!match) return mesAno;

  const data = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(data);
}
