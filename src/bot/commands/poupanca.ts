import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import {
  listarMetasPoupanca,
  definirMetaPoupanca,
  adicionarAporte,
} from '../../services/savings/savingsService';
import { buildPoupancaKeyboard } from '../keyboards/transactionKeyboard';
import { RODAPE_UX } from '../../config/constants';

const ORIENTACAO =
  '🎯 *Como gerenciar metas de poupança:*\n\n' +
  '• `/poupanca` — Lista todas as suas metas e progresso.\n' +
  '• `/poupanca definir <nome> <valor> [AAAA-MM]` — Cria meta (ex: `/poupanca definir Viagem 5000 2026-12`).\n' +
  '• `/poupanca add <nome> <valor>` — Registra aporte (ex: `/poupanca add Viagem 500`).';

/** Lista as metas de poupança com o plano de aporte mensal calculado em código. */
async function listar(chatId: number, requestId: string, bot: TelegramBot): Promise<void> {
  const metas = await listarMetasPoupanca(requestId);

  if (metas.length === 0) {
    await bot.sendMessage(
      chatId,
      `📭 *Você ainda não tem metas de poupança cadastradas.*\n\n${ORIENTACAO}\n\n${RODAPE_UX}`,
      { parse_mode: 'Markdown', reply_markup: buildPoupancaKeyboard() }
    );
    return;
  }

  const linhas = metas.map((m) => {
    const progresso = m.alvo > 0 ? Math.round((m.poupado / m.alvo) * 100) : 0;
    const icone = m.concluida ? '🏆' : '🐷';
    let linha = `${icone} *${m.nome}*: R$ ${formatarReal(m.poupado)} de R$ ${formatarReal(m.alvo)} (${progresso}%)`;
    if (m.prazo) {
      const prazoFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
        new Date(`${m.prazo}T12:00:00`)
      );
      linha += `\n   📅 Até ${prazoFmt}`;
      if (m.valorMensal != null && !m.concluida) {
        linha += `\n   💡 Poupando R$ ${formatarReal(m.valorMensal)}/mês você chega lá (${m.mesesRestantes} mês(es) restante(s))`;
      }
    }
    if (m.concluida) linha += '\n   🎉 Meta concluída! Parabéns!';
    return linha;
  });

  await bot.sendMessage(
    chatId,
    ['💰 *Metas de poupança:*', '', ...linhas, '', RODAPE_UX].join('\n\n'),
    { parse_mode: 'Markdown', reply_markup: buildPoupancaKeyboard() }
  );
}

/**
 * /poupanca — lista as metas.
 * /poupanca definir <nome> <alvo> [AAAA-MM] — cria a meta.
 * /poupanca add <nome> <valor> — adiciona um aporte.
 */
export async function handlePoupanca(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);

  try {
    if (partes.length === 0) {
      await listar(chatId, requestId, bot);
      return;
    }

    const acao = partes[0].toLowerCase();

    if (acao === 'definir') {
      // Nome (pode ter espaços), alvo = último token numérico e prazo =
      // penúltimo token quando casa com AAAA-MM.
      const resto = partes.slice(1);
      if (resto.length < 2) {
        await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`, { parse_mode: 'Markdown' });
        return;
      }
      let prazoISO: string | null = null;
      let tokens = resto;
      const possivelPrazo = resto[resto.length - 1];
      if (/^\d{4}-\d{2}$/.test(possivelPrazo)) {
        prazoISO = `${possivelPrazo}-01`;
        tokens = resto.slice(0, -1);
      }
      const alvoStr = tokens[tokens.length - 1];
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(alvoStr)) {
        await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`, { parse_mode: 'Markdown' });
        return;
      }
      const alvo = parseFloat(alvoStr.replace(',', '.'));
      const nome = tokens.slice(0, -1).join(' ');

      if (!nome || !Number.isFinite(alvo) || alvo <= 0) {
        await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`, { parse_mode: 'Markdown' });
        return;
      }

      const meta = await definirMetaPoupanca(nome, alvo, prazoISO, requestId);
      const prazoTexto = prazoISO
        ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
            new Date(`${meta.prazo}T12:00:00`)
          )
        : null;
      await bot.sendMessage(
        chatId,
        [
          '✅ Meta de poupança criada!',
          '',
          `🐷 ${meta.nome}`,
          `🎯 Alvo: R$ ${formatarReal(meta.alvo)}`,
          ...(prazoTexto ? [`📅 Prazo: ${prazoTexto}`] : []),
          ...(meta.valorMensal != null
            ? [`💡 Poupe R$ ${formatarReal(meta.valorMensal)}/mês para chegar lá.`]
            : []),
          '',
          RODAPE_UX,
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: buildPoupancaKeyboard() }
      );
      return;
    }

    if (acao === 'add') {
      const resto = partes.slice(1);
      if (resto.length < 2) {
        await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`, { parse_mode: 'Markdown' });
        return;
      }
      const valorStr = resto[resto.length - 1];
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(valorStr)) {
        await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`, { parse_mode: 'Markdown' });
        return;
      }
      const valor = parseFloat(valorStr.replace(',', '.'));
      const nome = resto.slice(0, -1).join(' ');

      const resultado = await adicionarAporte(nome, valor, requestId);
      if (!resultado) {
        await bot.sendMessage(
          chatId,
          `❓ Não encontrei a meta "${nome}". Use /poupanca para ver as suas.\n\n${RODAPE_UX}`,
          { reply_markup: buildPoupancaKeyboard() }
        );
        return;
      }

      const { meta, valorAplicado, avisoValorAjustado } = resultado;
      const progresso = meta.alvo > 0 ? Math.round((meta.poupado / meta.alvo) * 100) : 0;
      await bot.sendMessage(
        chatId,
        [
          avisoValorAjustado
            ? `⚠️ ${avisoValorAjustado}`
            : `✅ Aporte de R$ ${formatarReal(valorAplicado)} aplicado!`,
          '',
          `🐷 ${meta.nome}: R$ ${formatarReal(meta.poupado)} de R$ ${formatarReal(meta.alvo)} (${progresso}%)`,
          ...(meta.concluida ? ['🎉 Meta concluída! Parabéns!'] : []),
          ...(meta.valorMensal != null && !meta.concluida
            ? [`💡 Continue poupando R$ ${formatarReal(meta.valorMensal)}/mês.`]
            : []),
          '',
          RODAPE_UX,
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: buildPoupancaKeyboard() }
      );
      return;
    }

    await bot.sendMessage(chatId, `⚠️ ${ORIENTACAO}`);
  } catch (err) {
    log('error', 'Erro ao processar /poupanca', {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    await bot.sendMessage(chatId, `❌ Não consegui processar a poupança. Tente novamente.\n\n${RODAPE_UX}`);
  }
}