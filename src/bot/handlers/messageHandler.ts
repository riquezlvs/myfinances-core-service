import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log, withTiming } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { classificarIntencao } from '../../services/gemini/intentRouter';
import { interpretarGasto } from '../../services/gemini/transactionParser';
import { registrarTransacao } from '../../services/transactions/transactionService';
import { getCategoryMap } from '../../services/categories/categoryCache';
import { processarPagamento } from '../../services/debts/debtService';
import { extrairNomeEValorDeFrase } from '../../utils/textParsers';
import { formatarReal, formatarPagamento } from '../../utils/formatters';
import { buildSuccessKeyboard } from '../keyboards/transactionKeyboard';
import { handleStart } from '../commands/start';
import { handleResumo } from '../commands/resumo';
import { handleDividas } from '../commands/dividas';
import { handleGastos } from '../commands/gastos';
import { handlePagoCommand } from '../commands/pago';
import { handleFatura } from '../commands/fatura';
import { handleDesfazer } from '../commands/desfazer';
import { handleApagar } from '../commands/apagar';

const bot = getTelegramBot();

async function handleNovoGasto(chatId: number, texto: string, requestId: string): Promise<void> {
  const dados = await interpretarGasto(texto, requestId);
  log('info', 'JSON estruturado pelo Gemini', { requestId, dados });

  const { displayIds } = await registrarTransacao(dados, texto, requestId);
  const categoryMap = await getCategoryMap(requestId);
  const categoriaNome = categoryMap[dados.category_id] ?? 'Outros';
  const ehParcelado = displayIds.length > 1;

  let resposta = `✅ Gasto registrado!\n\n📝 ${dados.description}\n💰 R$ ${formatarReal(
    dados.total_amount
  )}\n🏷️ ${categoriaNome}\n💳 ${dados.payment_method}`;

  if (ehParcelado) {
    resposta += `\n🔢 Parcelado em ${displayIds.length}x (IDs #${displayIds.join(', #')})`;
  } else {
    resposta += `\n🆔 #${displayIds[0]}`;
  }

  if (dados.third_party_name) {
    const minhaParte = dados.my_share_amount ?? dados.total_amount;
    resposta += `\n🤝 Dividido com: ${dados.third_party_name} (sua parte: R$ ${formatarReal(minhaParte)})`;
  }

  await bot.sendMessage(chatId, resposta, {
    reply_markup: buildSuccessKeyboard(displayIds[0], ehParcelado),
  });
}

async function handlePagamentoDivida(chatId: number, texto: string, requestId: string): Promise<void> {
  const extraido = extrairNomeEValorDeFrase(texto);

  if (!extraido) {
    await bot.sendMessage(
      chatId,
      'Entendi que é sobre um pagamento, mas não consegui identificar quem pagou. ' +
        'Tente algo como "minha irmã pagou 25 reais" ou use /pago <nome> [valor].'
    );
    return;
  }

  const resultado = await processarPagamento(extraido.nome, extraido.valor, requestId);
  await bot.sendMessage(chatId, formatarPagamento(resultado));
}

async function handleConsulta(chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    [
      '🔎 Parece que você quer consultar alguma informação.',
      '',
      'Use um destes comandos:',
      '/resumo — resumo do mês',
      '/fatura — fatura do cartão',
      '/dividas — quem te deve',
      '/gastos [n] — últimos gastos',
    ].join('\n')
  );
}

async function handleOutros(chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    'Não entendi muito bem 🤔 Mande um gasto (ex: "Gastei 30 no mercado") ou use /start para ver os comandos.'
  );
}

async function rotearComando(chatId: number, texto: string, requestId: string): Promise<boolean> {
  if (texto.startsWith('/start')) {
    log('info', 'Comando: /start', { requestId });
    await handleStart(chatId);
    return true;
  }
  if (texto.startsWith('/resumo')) {
    log('info', 'Comando: /resumo', { requestId });
    await handleResumo(chatId, requestId);
    return true;
  }
  if (texto.startsWith('/dividas')) {
    log('info', 'Comando: /dividas', { requestId });
    await handleDividas(chatId, requestId);
    return true;
  }
  if (texto.startsWith('/fatura')) {
    log('info', 'Comando: /fatura', { requestId });
    await handleFatura(chatId, requestId);
    return true;
  }
  if (texto.startsWith('/gastos')) {
    const match = texto.match(/\/gastos\s+(\d+)/);
    const limite = match ? parseInt(match[1], 10) : 5;
    log('info', 'Comando: /gastos', { requestId, limite });
    await handleGastos(chatId, limite, requestId);
    return true;
  }
  if (texto.startsWith('/pago')) {
    const match = texto.match(/^\/pago\s+(.+)/i);
    if (!match) {
      await bot.sendMessage(chatId, 'Use assim: /pago Irmã  ou  /pago Irmã 25');
      return true;
    }
    log('info', 'Comando: /pago', { requestId });
    await handlePagoCommand(chatId, match[1], requestId);
    return true;
  }
  if (texto.startsWith('/desfazer')) {
    log('info', 'Comando: /desfazer', { requestId });
    await handleDesfazer(chatId, requestId);
    return true;
  }
  if (texto.startsWith('/apagar')) {
    const match = texto.match(/^\/apagar\s+(\S+)/i);
    if (!match) {
      await bot.sendMessage(chatId, 'Use assim: /apagar 42');
      return true;
    }
    log('info', 'Comando: /apagar', { requestId });
    await handleApagar(chatId, match[1], requestId);
    return true;
  }
  if (texto.startsWith('/')) {
    log('warn', 'Comando não reconhecido', { requestId, texto });
    await bot.sendMessage(chatId, '❓ Comando não reconhecido. Use /start para ver os comandos disponíveis.');
    return true;
  }
  return false;
}

export async function messageHandler(msg: Message): Promise<void> {
  const chatId = msg.chat.id;
  const requestId = randomUUID();

  log('info', '📩 Mensagem recebida', {
    requestId,
    chatId,
    userId: msg.from?.id,
    texto: msg.text,
  });

  try {
    if (msg.from?.id !== AUTHORIZED_USER_ID) {
      log('warn', '🚫 Tentativa de acesso não autorizada', { requestId, userId: msg.from?.id });
      await bot.sendMessage(chatId, '🚫 Acesso negado.');
      return;
    }

    if (!msg.text) {
      log('info', 'Mensagem ignorada: sem texto', { requestId });
      await bot.sendMessage(chatId, '⚠️ Por enquanto só processo mensagens de texto e áudio.');
      return;
    }

    const texto = msg.text.trim();

    const foiComando = await rotearComando(chatId, texto, requestId);
    if (foiComando) return;

    const intencao = await withTiming('rotear intenção da mensagem', { requestId }, () =>
      classificarIntencao(texto, requestId)
    );
    log('info', 'Intenção classificada', { requestId, intencao });

    switch (intencao) {
      case 'NOVO_GASTO':
        await handleNovoGasto(chatId, texto, requestId);
        break;
      case 'PAGAMENTO_DIVIDA':
        await handlePagamentoDivida(chatId, texto, requestId);
        break;
      case 'CONSULTA':
        await handleConsulta(chatId);
        break;
      case 'OUTROS':
      default:
        await handleOutros(chatId);
        break;
    }

    log('info', '✅ Fluxo concluído com sucesso', { requestId });
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Fluxo terminou em erro', { requestId, erro: mensagemErro });
    await bot.sendMessage(chatId, `❌ Não consegui processar sua mensagem.\nMotivo: ${mensagemErro}`);
  }
}