import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getSupabaseClient } from '../../clients/supabaseClient';
import { log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import { getCategoryMap } from '../../services/categories/categoryCache';

const NOME_METODO: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

interface RecorrenciaRow {
  id: string;
  description: string;
  total_amount: number;
  category_id: number;
  payment_method: 'pix' | 'credit_card' | 'debit_card';
  my_share_amount: number | null;
  day_of_month: number;
  is_active: boolean;
  last_generated_month: string | null;
}

/** Lista as recorrências cadastradas. */
export async function handleRecorrenteListar(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('recurring_transactions')
    .select(
      'id, description, total_amount, category_id, payment_method, my_share_amount, day_of_month, is_active, last_generated_month'
    )
    .order('day_of_month', { ascending: true });

  if (error) {
    log('error', 'Erro ao listar recorrências', { requestId, erro: error.message });
    await bot.sendMessage(chatId, '❌ Não consegui listar as recorrências. Tente novamente.');
    return;
  }

  const rows = (data ?? []) as RecorrenciaRow[];
  if (rows.length === 0) {
    await bot.sendMessage(
      chatId,
      '📭 Nenhuma despesa recorrente cadastrada.\n\nUse `/recorrente add <descrição> <valor> <dia> [categoria]` para criar uma.'
    );
    return;
  }

  const categoryMap = await getCategoryMap(requestId);
  const linhas = rows.map((r) => {
    const status = r.is_active ? '✅' : '⏸️';
    const categoria = categoryMap[r.category_id] ?? 'Outros';
    const metodo = NOME_METODO[r.payment_method] ?? r.payment_method;
    const ultimoMes = r.last_generated_month ? ` · último: ${r.last_generated_month}` : '';
    return `${status} Dia ${r.day_of_month} · ${r.description} · R$ ${formatarReal(
      Number(r.total_amount)
    )} · ${categoria} · ${metodo}${ultimoMes}`;
  });

  await bot.sendMessage(
    chatId,
    ['🔁 *Despesas recorrentes:*', '', ...linhas, '', 'Use `/recorrente remover <id>` para desativar.'].join('\n'),
    { parse_mode: 'Markdown' }
  );
}

/**
 * Adiciona uma recorrência.
 * Formato: /recorrente add <descrição> <valor> <dia> [categoria]
 * Ex: /recorrente add Netflix 39,90 15 Assinaturas
 */
export async function handleRecorrenteAdd(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const partes = argumentos.trim().split(/\s+/);
  if (partes.length < 3) {
    await bot.sendMessage(
      chatId,
      'Use assim: `/recorrente add <descrição> <valor> <dia> [categoria]`\n' +
        'Ex: `/recorrente add Netflix 39,90 15 Assinaturas`'
    );
    return;
  }

  // O dia é o último token numérico; o valor é o penúltimo token numérico.
  const diaIdx = partes.findIndex((p) => /^\d{1,2}$/.test(p));
  if (diaIdx === -1) {
    await bot.sendMessage(chatId, '❌ Não consegui identificar o dia do mês. Use um número de 1 a 28.');
    return;
  }

  const dia = parseInt(partes[diaIdx], 10);
  if (dia < 1 || dia > 28) {
    await bot.sendMessage(chatId, '❌ O dia deve estar entre 1 e 28.');
    return;
  }

  const valorIdx = partes.findIndex((p) => /^\d+(?:[.,]\d{1,2})?$/.test(p) && p !== partes[diaIdx]);
  if (valorIdx === -1) {
    await bot.sendMessage(chatId, '❌ Não consegui identificar o valor. Use formato como 39,90.');
    return;
  }

  const valor = parseFloat(partes[valorIdx].replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) {
    await bot.sendMessage(chatId, '❌ Valor inválido. Use um número positivo.');
    return;
  }

  // Descrição = tokens antes do valor (excluindo o dia se vier antes).
  const descricaoTokens = partes.slice(0, valorIdx).filter((p) => p !== partes[diaIdx]);
  const descricao = descricaoTokens.join(' ');
  if (!descricao) {
    await bot.sendMessage(chatId, '❌ Não consegui identificar a descrição.');
    return;
  }

  // Categoria opcional: token após o dia.
  const categoriaNome = partes[diaIdx + 1] ?? 'Outros';
  const categoryMap = await getCategoryMap(requestId);
  const categoriaId = Object.entries(categoryMap).find(
    ([, nome]) => nome.toLowerCase() === categoriaNome.toLowerCase()
  )?.[0];

  if (!categoriaId) {
    await bot.sendMessage(
      chatId,
      `❌ Categoria "${categoriaNome}" não encontrada. Categorias disponíveis: ${Object.values(categoryMap).join(', ')}`
    );
    return;
  }

  const { error } = await getSupabaseClient().from('recurring_transactions').insert({
    description: descricao,
    total_amount: valor,
    category_id: Number(categoriaId),
    payment_method: 'credit_card',
    day_of_month: dia,
    is_active: true,
  });

  if (error) {
    log('error', 'Erro ao adicionar recorrência', { requestId, erro: error.message });
    await bot.sendMessage(chatId, '❌ Não consegui adicionar a recorrência. Tente novamente.');
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ Recorrência adicionada!\n\n📝 ${descricao}\n💰 R$ ${formatarReal(valor)}\n📅 Dia ${dia}\n🏷️ ${categoriaNome}`
  );
}

/** Remove (desativa) uma recorrência pelo id. */
export async function handleRecorrenteRemover(
  chatId: number,
  id: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('recurring_transactions')
    .update({ is_active: false })
    .eq('id', id)
    .select('description')
    .maybeSingle();

  if (error) {
    log('error', 'Erro ao remover recorrência', { requestId, erro: error.message });
    await bot.sendMessage(chatId, '❌ Não consegui remover a recorrência. Tente novamente.');
    return;
  }

  if (!data) {
    await bot.sendMessage(chatId, `❓ Não encontrei nenhuma recorrência com o id "${id}".`);
    return;
  }

  await bot.sendMessage(chatId, `⏸️ Recorrência "${data.description}" desativada.`);
}