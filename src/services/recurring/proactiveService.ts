import type TelegramBot from 'node-telegram-bot-api';
import cron, { type ScheduledTask } from 'node-cron';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { getFaturaMensal } from '../transactions/transactionService';
import { getSaldoTerceiros } from '../debts/debtService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';

/**
 * Fase 6 — Lembrete proativo mensal: no dia 1º de cada mês às 08:00,
 * envia automaticamente um resumo da fatura do cartão e das dívidas
 * pendentes, reaproveitando os mesmos serviços dos comandos /fatura e
 * /dividas (fonte única de verdade).
 */

/** Monta a mensagem do lembrete a partir dos dados agregados. */
export function montarMensagemLembrete(
  itensFatura: { display_id: number; description: string; total_amount: number; occurred_at: string }[],
  saldos: { nome: string; valor: number }[]
): string {
  const totalFatura = itensFatura.reduce((s, i) => s + Number(i.total_amount), 0);

  const linhas: string[] = ['🔔 *Lembrete mensal*', ''];

  linhas.push('💳 *Fatura do cartão (mês anterior):*');
  if (itensFatura.length === 0) {
    linhas.push('   Nenhum lançamento no cartão.');
  } else {
    for (const item of itensFatura.slice(0, 5)) {
      linhas.push(
        `   #${item.display_id} · ${formatarDataCurta(item.occurred_at)} · ${item.description} — R$ ${formatarReal(
          Number(item.total_amount)
        )}`
      );
    }
    if (itensFatura.length > 5) {
      linhas.push(`   … e mais ${itensFatura.length - 5} lançamento(s).`);
    }
    linhas.push(`   *Total: R$ ${formatarReal(totalFatura)}*`);
  }

  linhas.push('');
  linhas.push('💰 *Dívidas pendentes:*');
  if (saldos.length === 0) {
    linhas.push('   Ninguém te deve nada. 🎉');
  } else {
    for (const s of saldos) {
      linhas.push(`   👤 ${s.nome}: R$ ${formatarReal(s.valor)}`);
    }
  }

  return linhas.join('\n');
}

/** Executa o lembrete agora (usado pelo cron e pelos testes). */
export async function enviarLembreteMensal(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const [itensFatura, saldos] = await Promise.all([
    getFaturaMensal(requestId),
    getSaldoTerceiros(requestId),
  ]);

  const mensagem = montarMensagemLembrete(itensFatura as any, saldos);
  await bot.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });

  log('info', '🔔 Lembrete mensal enviado', {
    requestId,
    itensFatura: itensFatura.length,
    devedores: saldos.length,
  });
}

/**
 * Agenda o cron proativo: dia 1º de cada mês às 08:00 (horário do servidor).
 * Retorna a task para desligamento limpo.
 */
export function iniciarCronLembreteMensal(): ScheduledTask {
  const task = cron.schedule('0 8 1 * *', async () => {
    const requestId = `cron-lembrete-${Date.now()}`;
    log('info', '⏰ Cron de lembrete mensal disparado', { requestId });
    try {
      await enviarLembreteMensal(AUTHORIZED_USER_ID, requestId);
    } catch (err) {
      log('error', '❌ Cron de lembrete mensal falhou', {
        requestId,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  });

  log('info', '⏰ Cron de lembrete mensal agendado (dia 1º às 08:00)');
  return task;
}