import { randomUUID } from 'crypto';
import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { log, withTiming } from '../../utils/logger';
import { AUTHORIZED_USER_ID } from '../../config/env';
import { classificarIntencao } from '../../services/gemini/intentRouter';
import { processarPagamento } from '../../services/debts/debtService';
import { extrairNomeEValorDeFrase } from '../../utils/textParsers';
import { formatarPagamento, formatarReal, formatarDataCurta } from '../../utils/formatters';
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
import { handlePoupanca } from '../commands/poupanca';
import { handleStatus } from '../commands/status';
import { handleViagem } from '../commands/viagem';
import { handlePatrimonio } from '../commands/patrimonio';
import { handleSaldo } from '../commands/saldo';
import { handleAjustarSaldo } from '../commands/ajustarSaldo';
import { handleInvestimentos } from '../commands/investimentos';
import { getCategoryMap } from '../../services/categories/categoryCache';
import { enqueue } from '../../utils/concurrency';
import { verificarRateLimit, tokensRestantes } from '../../utils/rateLimit';
import {
  consultarGastosGranulares,
  atualizarGastoPorId,
  registrarEntrada,
  type ResultadoConsultaGranular,
} from '../../services/transactions/transactionService';
import { mesAnoNaJanela, mesAnoAtual, rotuloDoMes } from '../../utils/month';
import { logRota } from '../../utils/logger';
import { RODAPE_UX, MAX_MONTH_LOOKBACK } from '../../config/constants';
import type { Intent, IntentParams, IntentPayload, ParsedTransaction } from '../../types/transaction';

/**
 * 8.1 — Mapa de auditabilidade: intent classificada → rota (handler) efetiva.
 * Registrado via logRota em cada mensagem processada pelo registry.
 */
const ROTAS_POR_INTENT: Record<Intent, string> = {
  NOVO_GASTO: 'novoGasto',
  NOVA_ENTRADA: 'novaEntrada',
  PAGAMENTO_DIVIDA: 'pagamentoDivida',
  CONSULTA: 'consulta',
  EXPORTAR: 'exportarViaIA',
  META: 'metaViaIA',
  CARTAO: 'cartaoViaIA',
  RECORRENTE: 'recorrenteViaIA',
  GRAFICO: 'grafico',
  INSIGHT: 'insight',
  POUPANCA: 'poupancaViaIA',
  PATRIMONIO: 'patrimonioViaIA',
  INVESTIMENTOS: 'investimentosViaIA',
  AJUSTAR_SALDO: 'ajustarSaldoViaIA',
  TRANSFERENCIA: 'transferenciaViaIA',
  CONFIRMACAO_REQUERIDA: 'confirmacaoRequerida',
  OUTROS: 'outros',
};

type Rota = (typeof ROTAS_POR_INTENT)[Intent] | 'comandoSlash' | 'rateLimit';

/**
 * NOVO_GASTO — Fase 8 (payload único): a transação JÁ vem validada pelo
 * transactionGuard dentro do IntentPayload (o intentRouter fez o 2º estágio).
 * Aqui NÃO há segunda chamada ao Gemini: economiza quota e elimina a janela
 * em que duas respostas de IA divergiam (intent de uma, JSON de outra).
 */
async function handleNovoGasto(
  chatId: number,
  transaction: ParsedTransaction,
  avisos: string[],
  rawInput: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  log('info', 'Transação estruturada e validada (payload único do Gemini)', {
    requestId,
    transaction,
  });
  // Salvamento + confirmação com botões vivem em novoGasto.ts, compartilhados
  // com o fluxo de áudio (voiceHandler) para garantir UX idêntica.
  await registrarEResponderGasto(chatId, transaction, rawInput, requestId, bot, avisos);
}

/**
 * NOVA_ENTRADA — Registra uma receita ou recarga (salário, VR, freela, pix recebido).
 */
async function handleNovaEntrada(
  chatId: number,
  transaction: ParsedTransaction,
  avisos: string[],
  rawInput: string,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  log('info', 'Entrada estruturada e validada', { requestId, transaction });

  const res = await registrarEntrada(
    {
      description: transaction.description,
      total_amount: transaction.total_amount,
      account_name: transaction.account_name ?? null,
      occurred_at: transaction.occurred_at,
    },
    rawInput,
    requestId
  );

  const saldoMsg =
    res.novoSaldo !== undefined
      ? `\n💳 Novo saldo em *${res.accountName}*: R$ ${formatarReal(res.novoSaldo)}`
      : '';

  const avisoMsg = avisos.length > 0 ? `\n⚠️ _${avisos.join(', ')}_` : '';

  await bot.sendMessage(
    chatId,
    `💰 *Entrada registrada com sucesso!*\n\n` +
      `• Descrição: ${transaction.description}\n` +
      `• Valor: *R$ ${formatarReal(transaction.total_amount)}*\n` +
      `• Conta: *${res.accountName}*` +
      saldoMsg +
      avisoMsg,
    { parse_mode: 'Markdown' }
  );
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
  await bot.sendMessage(chatId, formatarPagamento(resultado) + `\n\n${RODAPE_UX}`);
}

/**
 * 8.4 — Normaliza o nome de categoria citado pelo usuário: sem acentos, em
 * minúsculas e sem espaços ao redor. Permite que "transporte" coincida com
 * "Transporte" no catálogo.
 */
function normalizarCategoriaTexto(nome: string): string {
  return nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * 8.4 — Resolve o NOME da categoria (extraído pela IA) contra o catálogo do
 * Supabase. Retorna undefined se não coincidir: o código NUNCA inventa/
 * adivinha um category_id por texto livre.
 */
function resolverCategoria(nome: string, categoryMap: Record<number, string>): number | undefined {
  const alvo = normalizarCategoriaTexto(nome);
  for (const [id, nomeCatalogo] of Object.entries(categoryMap)) {
    if (normalizarCategoriaTexto(nomeCatalogo) === alvo) return Number(id);
  }
  return undefined;
}

/**
 * 8.4 — Formata a resposta de uma consulta granular. 100% determinística
 * (services + formatters): a IA classificou, mas o CÓDIGO decide o que mostrar.
 */
async function enviarRespuestaConsultaGranular(
  chatId: number,
  categoriaNome: string | undefined,
  mes: string,
  resultado: ResultadoConsultaGranular,
  bot: TelegramBot
): Promise<void> {
  const titulo = categoriaNome ? `${categoriaNome} · ${rotuloDoMes(mes)}` : `Gastos de ${rotuloDoMes(mes)}`;

  if (resultado.total === 0) {
    await bot.sendMessage(
      chatId,
      `📊 *${titulo}*\n\nNão registrei gastos nesse período. 🤷\n\n${RODAPE_UX}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const linhas = resultado.items.map((g) => {
    const metodo = g.payment_method ? ` · ${g.payment_method.replace(/_/g, ' ')}` : '';
    return `#${g.display_id} · 📅 ${formatarDataCurta(g.occurred_at)} · ${g.description} · R$ ${formatarReal(
      g.total_amount
    )}${metodo}`;
  });

  await bot.sendMessage(
    chatId,
    [
      `📊 *${titulo}*`,
      '',
      `💸 Total: R$ ${formatarReal(resultado.total)}`,
      '',
      ...linhas,
      '',
      RODAPE_UX,
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
}

/**
 * 8.4 — CONSULTA granular por linguagem natural: "quanto gastei com transporte
 * em agosto?". Os params já foram validados pelo intentGuard; o mês é
 * revalidado com o hard-limit EM CÓDIGO (mesAnoNaJanela) e a categoria é
 * resolvida contra o catálogo. Resposta determinística, sem segunda IA.
 */
async function handleConsultaGranular(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  // Hard-limit em código: a IA não escolhe a janela de meses consultáveis.
  if (params.month && !mesAnoNaJanela(params.month)) {
    await bot.sendMessage(
      chatId,
      `⚠️ Só consigo consultar os últimos ${MAX_MONTH_LOOKBACK} meses (ou o próximo). Me pergunte por outro período.\n\n${RODAPE_UX}`
    );
    return;
  }

  const mes = params.month ?? mesAnoAtual();

  if (params.category) {
    const categoryMap = await getCategoryMap(requestId);
    const categoryId = resolverCategoria(params.category, categoryMap);
    if (!categoryId) {
      const validas = Object.values(categoryMap).map((n) => `• ${n}`).join('\n');
      await bot.sendMessage(
        chatId,
        `🤔 Não reconheço a categoria "${params.category}". Minhas categorias são:\n${validas}\n\n${RODAPE_UX}`
      );
      return;
    }

    log('info', 'Consulta granular: categoria resolvida em código (a IA nunca decide category_id)', {
      requestId,
      citada: params.category,
      categoryId,
    });

    const resultado = await consultarGastosGranulares({ categoryId, month: mes, limite: params.limite }, requestId);
    log('info', 'Consulta granular executada em código', {
      requestId,
      categoryId,
      mes,
      total: resultado.total,
      items: resultado.items.length,
    });
    await enviarRespuestaConsultaGranular(chatId, categoryMap[categoryId], mes, resultado, bot);
    return;
  }

  // Sem categoria: filtro temporal sobre todos os gastos do mês citado.
  const resultado = await consultarGastosGranulares(
    { month: mes, limite: params.limite ?? 20 },
    requestId
  );
  log('info', 'Consulta granular (apenas mês) executada em código', {
    requestId,
    mes,
    total: resultado.total,
    items: resultado.items.length,
  });
  await enviarRespuestaConsultaGranular(chatId, undefined, mes, resultado, bot);
}

/**
 * CONSULTA parametrizada (Fase 2 + 8.4): a IA só classifica A QUAL entidade o
 * usuário quer acesso; a resposta é 100% determinística (services +
 * formatters), sem geração de texto por LLM. Com categoria/mês citados passa
 * à consulta granular. Sem entidade reconhecida, orienta o usuário.
 */
async function handleConsulta(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  // 8.4 — Consulta granular: categoria e/ou mês citados pelo usuário.
  if (params.category || params.month || params.type === 'gasto') {
    await handleConsultaGranular(chatId, params, requestId, bot);
    return;
  }

  switch (params.entidade) {
    case 'resumo':
      await handleResumo(chatId, requestId, bot);
      return;
    case 'fatura':
      await handleFatura(chatId, requestId, bot);
      return;
    case 'dividas':
      await handleDividas(chatId, requestId, bot);
      return;
    case 'gastos':
      await handleGastos(chatId, params.limite ?? 5, requestId, bot);
      return;
    case 'patrimonio':
      await handlePatrimonio(chatId, requestId, bot);
      return;
    case 'saldo':
      await handleSaldo(chatId, requestId, bot);
      return;
    case 'investimentos':
      await handleInvestimentos(chatId, requestId, bot);
      return;
    default:
      await bot.sendMessage(
        chatId,
        [
          '🔎 Posso te mostrar:',
          '',
          '• resumo do mês — "qual o resumo do mês?" ou /resumo',
          '• fatura do cartão — "me mostra a fatura" ou /fatura',
          '• dívidas — "quem me deve?" ou /dividas',
          '• últimos gastos — "meus últimos 10 gastos" ou /gastos [n]',
        ].join('\n')
      );
  }
}

async function handleOutros(chatId: number, bot: TelegramBot): Promise<void> {
  await bot.sendMessage(
    chatId,
    'Não entendi muito bem 🤔 Mande um gasto (ex: "Gastei 30 no mercado") ou use /start para ver os comandos.'
  );
}

function extrairEdicaoPorId(texto: string): { id: number; campo: 'valor' | 'descricao' | 'data'; valor: string } | null {
  const idMatch = texto.match(/(?:#|id\s*)(\d+)/i);
  if (!idMatch) return null;
  const id = Number(idMatch[1]);
  const depois = texto.slice((idMatch.index ?? 0) + idMatch[0].length);
  const valor = depois.match(/(?:valor|preço|preco)\s*(?:para|de)?\s*R?\$?\s*([\d.,]+)/i);
  if (valor) return { id, campo: 'valor', valor: valor[1] };
  const data = depois.match(/(?:data|dia)\s*(?:para|em)?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (data) return { id, campo: 'data', valor: data[1] };
  const descricao = depois.match(/(?:descri(?:ção|cao)|nome)\s*(?:para|como|:)?\s*(.+)$/i);
  if (descricao) return { id, campo: 'descricao', valor: descricao[1].trim() };
  return null;
}

async function tentarEditarPorId(chatId: number, texto: string, requestId: string, bot: TelegramBot): Promise<boolean> {
  const edicao = extrairEdicaoPorId(texto);
  if (!edicao) return false;

  let patch: { total_amount?: number; description?: string; occurred_at?: string };
  let resumo: string;
  if (edicao.campo === 'valor') {
    const valor = Number(edicao.valor.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      await bot.sendMessage(chatId, '❓ Não entendi o novo valor. Exemplo: "altera o gasto #42 para R$ 85,90".');
      return true;
    }
    patch = { total_amount: valor };
    resumo = `valor para R$ ${formatarReal(valor)}`;
  } else if (edicao.campo === 'data') {
    const partes = edicao.valor.split(/[/-]/).map(Number);
    const iso = partes[0] > 31
      ? `${edicao.valor}T12:00:00.000Z`
      : `${partes[2] < 100 ? 2000 + partes[2] : partes[2]}-${String(partes[1]).padStart(2, '0')}-${String(partes[0]).padStart(2, '0')}T12:00:00.000Z`;
    if (Number.isNaN(new Date(iso).getTime())) {
      await bot.sendMessage(chatId, '❓ Não entendi a data. Use, por exemplo, 15/08/2024.');
      return true;
    }
    patch = { occurred_at: iso };
    resumo = `data para ${formatarDataCurta(iso)}`;
  } else {
    patch = { description: edicao.valor };
    resumo = `descrição para "${edicao.valor}"`;
  }

  await atualizarGastoPorId(edicao.id, patch, requestId);
  await bot.sendMessage(chatId, `✅ Atualizei a compra #${edicao.id}: ${resumo}.\n\n${RODAPE_UX}`);
  return true;
}

/**
 * Regra de segurança (Fase 3 — Double-Opt-In): o roteador de IA NUNCA executa
 * operações destrutivas. Se a intenção classificada exige remoção, o bot
 * responde apontando o comando explícito — a ação só acontece fora da cadeia
 * do LLM (texto "/" ou clique em botão inline).
 */
async function recusarDestrutivaViaIA(
  chatId: number,
  descricao: string,
  comandoSeguro: string,
  bot: TelegramBot
): Promise<void> {
  await bot.sendMessage(
    chatId,
    '🔒 Por segurança, não executo remoções por conversa.' +
      (descricao ? ` (Você pediu: "${descricao}")` : '') +
      `\nConfirme com o comando direto: ${comandoSeguro}`
  );
}

/** EXPORTAR via linguagem natural — "manda a planilha de setembro". */
async function handleExportarViaIA(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const tipoExport = params.tipoExport ?? 'gastos';

  // Hard-limit em código: a IA não escolhe a janela de exportação.
  if (params.month && tipoExport !== 'dividas' && !mesAnoNaJanela(params.month)) {
    await bot.sendMessage(
      chatId,
      '⚠️ Só consigo exportar meses dos últimos 12 (ou o próximo). Me diga outro período — ex: "exporta setembro" ou /exportar.'
    );
    return;
  }

  await handleExportar(
    chatId,
    tipoExport === 'dividas' ? 'dividas' : 'gastos',
    requestId,
    bot,
    params.month ? { mesAno: params.month } : {}
  );
}

/** META via linguagem natural — listar/definir; remover exige comando (Tier 2). */
async function handleMetaViaIA(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  if (params.accionMeta === 'remover') {
    await recusarDestrutivaViaIA(chatId, params.categoriaMeta ?? '', '/meta remover <categoria>', bot);
    return;
  }
  if (params.accionMeta === 'definir') {
    if (!params.categoriaMeta || params.limiteMeta == null) {
      await bot.sendMessage(
        chatId,
        '🎯 Entendi que você quer definir uma meta. Me diga a categoria e o limite — ex: "meta de 600 para alimentação".'
      );
      return;
    }
    await handleMeta(chatId, `${params.categoriaMeta} ${params.limiteMeta}`, requestId, bot);
    return;
  }
  await handleMeta(chatId, '', requestId, bot);
}

/** CARTAO via linguagem natural — listar/fatura/add; remover exige comando (Tier 2). */
async function handleCartaoViaIA(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  switch (params.accionCartao) {
    case 'add':
      if (!params.nomeCartao || params.closingDay == null) {
        await bot.sendMessage(
          chatId,
          '💳 Para cadastrar o cartão, me diga nome, dia de fechamento (1–28) e, se necessário, o tipo.\n\n' +
            'Tipos disponíveis: credito, vr (vale-refeição) ou va (vale-alimentação).\n' +
            'Ex: "cadastra Nubank, fecha dia 20, tipo credito".'
        );
        return;
      }
      await handleCartao(chatId, `add ${params.nomeCartao} ${params.closingDay}`, requestId, bot);
      return;
    case 'fatura':
      await handleCartao(chatId, params.nomeCartao ? `fatura ${params.nomeCartao}` : 'fatura', requestId, bot);
      return;
    case 'remover':
      await recusarDestrutivaViaIA(chatId, params.nomeCartao ?? '', '/cartao remover <nome>', bot);
      return;
    default:
      await handleCartao(chatId, '', requestId, bot);
  }
}

/**
 * RECORRENTE via linguagem natural: o schema de params não carrega
 * descrição/valor/dia (nem deveria — são dados financeiros que o comando
 * determinístico valida melhor), então 'add' orienta o uso do comando.
 */
async function handleRecorrenteViaIA(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  switch (params.accionRecorrente) {
    case 'add':
      await bot.sendMessage(
        chatId,
        '🔁 Para adicionar uma despesa fixa use:\n/recorrente add <descrição> <valor> <dia> [categoria]\nex: /recorrente add Netflix 39,90 15'
      );
      return;
    case 'remover':
      await recusarDestrutivaViaIA(chatId, '', '/recorrente remover <id>', bot);
      return;
    default:
      await handleRecorrenteListar(chatId, requestId, bot);
  }
}

/**
 * CONFIRMACAO_REQUERIDA — destino OBRIGATÓRIO de pedidos destrutivos
 * classificados pela IA ("apaga o gasto de ontem"). Nada é executado aqui:
 * o usuário recebe os comandos explícitos e decide fora da cadeia do LLM.
 */
async function handleConfirmacaoRequerida(
  chatId: number,
  params: IntentParams,
  bot: TelegramBot
): Promise<void> {
  await bot.sendMessage(
    chatId,
    [
      '🔒 Isso parece um pedido para apagar/remover dados — e eu nunca apago nada por conversa.',
      '',
      'Use os comandos diretos:',
      '• /apagar <id> — remove um gasto',
      '• /desfazer — desfaz o último lançamento',
      '• /meta remover <categoria> — remove uma meta',
      '• /cartao remover <nome> — remove um cartão',
      '• /recorrente remover <id> — desativa uma recorrência',
      params.pedidoDescricao ? `\n(Você pediu: "${params.pedidoDescricao}")` : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** POUPANCA via linguagem natural — "quero juntar 5000 para viagem até dezembro". */
async function handlePoupancaViaIA(
  chatId: number,
  params: IntentParams,
  requestId: string,
  bot: TelegramBot
): Promise<void> {
  const nome = params.nomePoupanca;
  const valor = params.valorPoupanca;
  const prazo = params.prazoPoupanca;

  if (params.accionPoupanca === 'definir') {
    if (!nome || valor == null) {
      await bot.sendMessage(
        chatId,
        '🐷 Entendi que você quer criar uma meta de poupança. Me diga o nome e o valor — ' +
          'ex: "quero juntar 5000 para viagem até dezembro".'
      );
      return;
    }
    await handlePoupanca(chatId, `definir ${nome} ${valor}${prazo ? ` ${prazo}` : ''}`, requestId, bot);
    return;
  }

  if (params.accionPoupanca === 'adicionar') {
    if (!nome || valor == null) {
      await bot.sendMessage(
        chatId,
        '🐷 Para adicionar um aporte, me diga a meta e o valor — ex: "guardei 500 na viagem".'
      );
      return;
    }
    await handlePoupanca(chatId, `add ${nome} ${valor}`, requestId, bot);
    return;
  }

  await handlePoupanca(chatId, '', requestId, bot);
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
  if (texto.startsWith('/poupanca')) {
    log('info', 'Comando: /poupanca', { requestId });
    const argumentos = texto.replace(/^\/poupanca/i, '').trim();
    await handlePoupanca(chatId, argumentos, requestId, bot);
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
  if (texto.startsWith('/status')) {
    log('info', 'Comando: /status', { requestId });
    await handleStatus(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/viagem')) {
    log('info', 'Comando: /viagem', { requestId });
    const argumentos = texto.replace(/^\/viagem/i, '').trim();
    await handleViagem(chatId, argumentos, requestId, bot);
    return true;
  }
  if (texto.startsWith('/patrimonio')) {
    log('info', 'Comando: /patrimonio', { requestId });
    await handlePatrimonio(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/saldo')) {
    log('info', 'Comando: /saldo', { requestId });
    await handleSaldo(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/investimentos')) {
    log('info', 'Comando: /investimentos', { requestId });
    await handleInvestimentos(chatId, requestId, bot);
    return true;
  }
  if (texto.startsWith('/ajustar_saldo')) {
    log('info', 'Comando: /ajustar_saldo', { requestId });
    const argumentos = texto.replace(/^\/ajustar_saldo/i, '').trim();
    await handleAjustarSaldo(chatId, argumentos, requestId, bot);
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

    // 9 — Rate limiting: protege contra abuso e estouro de cotas.
    const chaveRateLimit = `user:${msg.from.id}`;
    if (!verificarRateLimit(chaveRateLimit)) {
      log('warn', '🚦 Rate limit excedido', { requestId, userId: msg.from.id, restante: tokensRestantes(chaveRateLimit) });
      await bot.sendMessage(
        chatId,
        '🚦 Você está enviando mensagens rápido demais. Dá uma respirada e tenta de novo em alguns segundos — assim o sistema te atende melhor! 😅'
      );
      return;
    }

    if (!msg.text) {
      log('info', 'Mensagem ignorada: sem texto', { requestId });
      await bot.sendMessage(chatId, '⚠️ Por enquanto só processo mensagens de texto e áudio.');
      return;
    }

    const texto = msg.text.trim();

    // 9 — Fila serial por chatId: evita race conditions quando o Telegram
    // entrega múltiplas mensagens quase simultâneas.
    const chaveFila = `chat:${chatId}`;
    await enqueue(chaveFila, async () => {
      await processarMensagemAutorizada(chatId, texto, requestId, bot, msg);
    });
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Fluxo terminou em erro', { requestId, erro: mensagemErro });
    await bot.sendMessage(
      chatId,
      /\b503\b|service unavailable|overloaded|unavailable/i.test(mensagemErro)
        ? 'Estou com uma sobrecarga momentânea na minha conexão com a IA. Poderia tentar enviar novamente em alguns instantes? 😊'
        : '❌ Não consegui processar sua mensagem. Tente novamente — se o problema persistir, ' +
          'verifique o log (requestId para referência).'
    );
  }
}

/**
 * 9 — Processamento da mensagem AUTORIZADA (após gate + rate limit + fila).
 * Extraído para permitir o encapsulamento pela fila serial.
 */
async function processarMensagemAutorizada(
  chatId: number,
  texto: string,
  requestId: string,
  bot: TelegramBot,
  msg: Message
): Promise<void> {
  try {
    const foiComando = await rotearComando(chatId, texto, requestId, bot);
    if (foiComando) return;

    if (await tentarEditarPorId(chatId, texto, requestId, bot)) return;

    await bot.sendChatAction(chatId, 'typing');

    // Fase 8: UMA chamada ao Gemini retorna intent + params + transaction.
    const payload: IntentPayload = await withTiming('rotear intenção da mensagem', { requestId }, () =>
      classificarIntencao(texto, requestId)
    );
    log('info', 'Intenção classificada', { requestId, intent: payload.intent, params: payload.params });
    logRota(requestId, ROTAS_POR_INTENT[payload.intent] ?? 'outros', {
      intent: payload.intent,
      params: payload.params,
    });

    // Registry determinístico: a IA classificou, o CÓDIGO decide o que roda.
    switch (payload.intent) {
      case 'NOVO_GASTO': {
        if (!payload.transaction) {
          // Defesa extra: o intentRouter já filtra isso, mas o handler nunca
          // persiste um gasto sem os dados validados pelo guard.
          log('warn', 'NOVO_GASTO sem transaction no payload; tratando como OUTROS', { requestId });
          await handleOutros(chatId, bot);
          break;
        }
        await handleNovoGasto(chatId, payload.transaction, payload.avisos, texto, requestId, bot);
        break;
      }
      case 'PAGAMENTO_DIVIDA':
        // Extração por regex determinística (nome + valor), não pela IA.
        await handlePagamentoDivida(chatId, texto, requestId, bot);
        break;
      case 'CONSULTA':
        await handleConsulta(chatId, payload.params, requestId, bot);
        break;
      case 'EXPORTAR':
        await handleExportarViaIA(chatId, payload.params, requestId, bot);
        break;
      case 'META':
        await handleMetaViaIA(chatId, payload.params, requestId, bot);
        break;
      case 'CARTAO':
        await handleCartaoViaIA(chatId, payload.params, requestId, bot);
        break;
      case 'RECORRENTE':
        await handleRecorrenteViaIA(chatId, payload.params, requestId, bot);
        break;
      case 'GRAFICO':
        await handleGrafico(chatId, requestId, bot);
        break;
      case 'INSIGHT':
        await handleInsight(chatId, requestId, bot);
        break;
      case 'POUPANCA':
        await handlePoupancaViaIA(chatId, payload.params, requestId, bot);
        break;
      case 'NOVA_ENTRADA': {
        if (!payload.transaction) {
          log('warn', 'NOVA_ENTRADA sem transaction no payload; tratando como OUTROS', { requestId });
          await handleOutros(chatId, bot);
          break;
        }
        await handleNovaEntrada(chatId, payload.transaction, payload.avisos, texto, requestId, bot);
        break;
      }
      case 'PATRIMONIO':
        await handlePatrimonio(chatId, requestId, bot);
        break;
      case 'INVESTIMENTOS':
        await handleInvestimentos(chatId, requestId, bot);
        break;
      case 'AJUSTAR_SALDO': {
        const argStr = `${payload.params.nomeConta ?? ''} ${payload.params.saldoAjuste ?? ''}`.trim();
        await handleAjustarSaldo(chatId, argStr, requestId, bot);
        break;
      }
      case 'CONFIRMACAO_REQUERIDA':
        await handleConfirmacaoRequerida(chatId, payload.params, bot);
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
      /\b503\b|service unavailable|overloaded|unavailable/i.test(mensagemErro)
        ? 'Estou com uma sobrecarga momentânea na minha conexão com a IA. Poderia tentar enviar novamente em alguns instantes? 😊'
        : '❌ Não consegui processar sua mensagem. Tente novamente — se o problema persistir, ' +
          'verifique o log (requestId para referência).'
    );
  }
}