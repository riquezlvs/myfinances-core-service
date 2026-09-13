/**
 * Fase 9 — Healthcheck e status do serviço.
 *
 * /status retorna: uptime, latência do Supabase (ping) e versão do build.
 */

import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getSupabaseClient } from '../../clients/supabaseClient';
import { RODAPE_UX } from '../../config/constants';
import { log } from '../../utils/logger';

const INICIO = Date.now();
const VERSAO = process.env.npm_package_version ?? '2.0.0';

export async function handleStatus(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const uptimeMs = Date.now() - INICIO;
  const uptimeMin = Math.floor(uptimeMs / 60_000);
  const uptimeHoras = Math.floor(uptimeMin / 60);
  const uptimeFormatado = `${uptimeHoras}h ${uptimeMin % 60}min`;

  // Latência do Supabase: SELECT 1 como ping.
  let latenciaMs: number | null = null;
  let supabaseOk = false;
  const ini = Date.now();
  try {
    const { error } = await getSupabaseClient().from('transactions').select('id').limit(1).single();
    latenciaMs = Date.now() - ini;
    supabaseOk = !error || error.code === 'PGRST116'; // 116 = "no rows" (OK para SELECT 1)
  } catch (err) {
    log('warn', 'Falha ao pingar Supabase', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    latenciaMs = Date.now() - ini;
  }

  const linhas = [
    '🟢 *Status do MyFinances Core*',
    '',
    `⏱ Uptime: ${uptimeFormatado}`,
    `🗄 Supabase: ${supabaseOk ? `online (${latenciaMs}ms)` : `offline (${latenciaMs}ms)`}`,
    `📦 Versão: ${VERSAO}`,
    '',
    RODAPE_UX,
  ];

  await bot.sendMessage(chatId, linhas.join('\n'), { parse_mode: 'Markdown' });
}