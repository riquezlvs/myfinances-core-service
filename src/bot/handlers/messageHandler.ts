import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log, withTiming } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { classificarIntencao } from '../../services/gemini/intentRouter';
import { interpretarGasto } from '../../services/gemini/transactionParser';
import { processarPagamento } from '../../services/debts/debtService';
import { extrairNomeEValorDeFrase } from '../../utils/textParsers';
import { formatarPagamento } from '../../utils/formatters';
import { registrarEResponderGasto } from './novoGasto';
import { handleStart } from '../commands/start';
import { handleResumo } from '../commands/resumo';
import { handleDividas } from '../commands/dividas';
import { handleGastos } from '../commands/gastos';
import { handlePagoCommand } from '../commands/pago';
import { handleFatura } from '../commands/fatura';
import { handleDesfazer } from '../commands/desfazer';
import { handleApagar } from '../commands/apagar';
import {
  handleRecorrenteListar,
  handleRecorrenteAdd,
  handleRecorrenteRemover,
} from '../commands/recorrente';
import { handleExportar } from '../commands/exportar';
import { handleGrafico } from '../commands/grafico';
import { handleInsight } from '../commands/insight';
import { handleMeta } from '../commands/meta';
import { handleCartao } from '../commands/cartao';

async function handleNovoGasto(
  chatId: number,
  texto: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const dados = await interpretarGasto(texto, requestId);
  log('info', 'JSON estruturado pelo Gemini', { requestId, dados });

  // Salvamento + confirmação com botões vivem em novoGasto.ts, compartilhados
  // com o fluxo de áudio (voiceHandler) para garantir UX idêntica.
  await registrarEResponderGasto(chatId, dados, texto, requestId, bot);
}

async function handlePagamentoDivida(
  chatId: number,
  texto: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
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

async function handleConsulta(chatId: number, bot: TelegramBot): Promise<void> {
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

async function handleOutros(chatId: number, bot: TelegramBot): Promise<void> {
  await bot.sendMessage(
    chatId,
    'Não entendi muito bem 🤔 Mande um gasto (ex: "Gastei 30 no mercado") ou use /start para ver os comandos.'
  );
}

async function rotearComando(
  chatId: number,
  texto: string,
  requestId: string,
  bot: TelegramBot
): Promise<boolean> {
  if (texto.startsWith('/start')) {
    log('info', 'Comando: /start', { requestId });
    await handleStart(chatId, bot);
    return true;
  }
  if (texto.startsWith('/resumo')) {
    log('info', 'Comando: /resumo', { requestId });
    await handleResumo(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/dividas')) {
    log('info', 'Comando: /dividas', { requestId });
    await handleDividas(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/fatura')) {
    log('info', 'Comando: /fatura', { requestId });
    await handleFatura(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/gastos')) {
    const match = texto.match(/\/gastos\s+(\d+)/);
    const limite = match ? parseInt(match[1], 10) : 5;
    log('info', 'Comando: /gastos', { requestId, limite });
    await handleGastos(chatId, limite, requestId, bot);
    return true;
  }
  if (texto.startsWith('/pago')) {
    const match = texto.match(/^\/pago\s+(.+)/i);
    if (!match) {
      await bot.sendMessage(chatId, 'Use assim: /pago Irmã  ou  /pago Irmã 25');
      return true;
    }
    log('info', 'Comando: /pago', { requestId });
    await handlePagoCommand(chatId, match[1], requestId, bot);
    return true;
  }
  if (texto.startsWith('/desfazer')) {
    log('info', 'Comando: /desfazer', { requestId });
    await handleDesfazer(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/apagar')) {
    const match = texto.match(/^\/apagar\s+(\S+)/i);
    if (!match) {
      await bot.sendMessage(chatId, 'Use assim: /apagar 42');
      return true;
    }
    log('info', 'Comando: /apagar', { requestId });
    await handleApagar(chatId, match[1], requestId, bot);
    return true;
  }
  if (texto.startsWith('/recorrente')) {
    log('info', 'Comando: /recorrente', { requestId });
    const argumentos = texto.replace(/^\/recorrente/i, '').trim();
    if (argumentos === '') {
      await handleRecorrenteListar(chatId, requestId, bot);
      return true;
    }
    const [sub, ...resto] = argumentos.split(/\s+/);
    if (sub === 'add') {
      await handleRecorrenteAdd(chatId, resto.join(' '), requestId, bot);
      return true;
    }
    if (sub === 'remover') {
      await handleRecorrenteRemover(chatId, resto.join(' '), requestId, bot);
      return true;
    }
    await bot.sendMessage(
      chatId,
      'Use assim:\n/recorrente — listar\n/recorrente add <descrição> <valor> <dia> [categoria]\n/recorrente remover <id>'
    );
    return true;
  }
  if (texto.startsWith('/exportar')) {
    log('info', 'Comando: /exportar', { requestId });
    const argumentos = texto.replace(/^\/exportar/i, '').trim();
    await handleExportar(chatId, argumentos, requestId, bot);
    return true;
  }
  if (texto.startsWith('/grafico')) {
    log('info', 'Comando: /grafico', { requestId });
    await handleGrafico(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/insight')) {
    log('info', 'Comando: /insight', { requestId });
    await handleInsight(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/meta')) {
    log('info', 'Comando: /meta', { requestId });
    const argumentos = texto.replace(/^\/meta/i, '').trim();
    await handleMeta(chatId, argumentos, requestId, bot);
    return true;
  }
  if (texto.startsWith('/cartao')) {
    log('info', 'Comando: /cartao', { requestId });
    const argumentos = texto.replace(/^\/cartao/i, '').trim();
    await handleCartao(chatId, argumentos, requestId, bot);
    return true;
  }
  if (texto.startsWith('/')) {
    log('warn', 'Comando não reconhecido', { requestId, texto });
    await bot.sendMessage(chatId, '❓ Comando não reconhecido. Use /start para ver os comandos disponíveis.');
    return true;
  }
  return false;
}

export async function messageHandler(
  msg: Message,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
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

    const foiComando = await rotearComando(chatId, texto, requestId, bot);
    if (foiComando) return;

    const intencao = await withTiming('rotear intenção da mensagem', { requestId }, () =>
      classificarIntencao(texto, requestId)
    );
    log('info', 'Intenção classificada', { requestId, intencao });

    switch (intencao) {
      case 'NOVO_GASTO':
        await handleNovoGasto(chatId, texto, requestId, bot);
        break;
      case 'PAGAMENTO_DIVIDA':
        await handlePagamentoDivida(chatId, texto, requestId, bot);
        break;
      case 'CONSULTA':
        await handleConsulta(chatId, bot);
        break;
      case 'OUTROS':
      default:
        await handleOutros(chatId, bot);
        break;
    }

    log('info', '✅ Fluxo concluído com sucesso', { requestId });
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Fluxo terminou em erro', { requestId, erro: mensagemErro });
    // NÃO expor detalhes internos ao usuário: a causa completa fica no log
    // (vinculada ao requestId acima) para diagnóstico seguro.
    await bot.sendMessage(
      chatId,
      '❌ Não consegui processar sua mensagem. Tente novamente — se o problema persistir, ' +
        'verifique o log (requestId para referência).'
    );
  }
}