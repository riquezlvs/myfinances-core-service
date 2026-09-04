import 'dotenv/config';
import { randomUUID } from 'crypto';
import TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// 1. VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// ============================================================================
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_AUTHORIZED_USER_ID,
  GEMINI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (
  !TELEGRAM_BOT_TOKEN ||
  !TELEGRAM_AUTHORIZED_USER_ID ||
  !GEMINI_API_KEY ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error(
    '❌ Variáveis de ambiente faltando. Confira o arquivo .env com base no .env.example.'
  );
}

const AUTHORIZED_USER_ID = Number(TELEGRAM_AUTHORIZED_USER_ID);
const GEMINI_MODEL = 'gemini-3.5-flash';

// ============================================================================
// 2. LOGGING ESTRUTURADO
// Cada mensagem recebida ganha um requestId (correlationId) que aparece em
// TODOS os logs daquela requisição — facilita rastrear no terminal exatamente
// o que aconteceu do início ao fim de um único fluxo (Telegram -> Gemini ->
// Supabase -> resposta), mesmo com várias mensagens chegando ao mesmo tempo.
// ============================================================================
type LogContext = Record<string, unknown>;

function log(level: 'info' | 'warn' | 'error', message: string, context: LogContext = {}) {
  const timestamp = new Date().toISOString();
  const meta = Object.entries(context)
    .map(([chave, valor]) => `${chave}=${typeof valor === 'string' ? valor : JSON.stringify(valor)}`)
    .join(' ');
  const linha = `[${timestamp}] [${level.toUpperCase()}] ${message}${meta ? ` | ${meta}` : ''}`;

  if (level === 'error') console.error(linha);
  else if (level === 'warn') console.warn(linha);
  else console.log(linha);
}

/**
 * Envolve uma operação assíncrona com log de início, fim (com duração em ms)
 * e erro — usado em toda chamada externa (Gemini, Supabase) para que o
 * terminal mostre exatamente quanto tempo cada etapa levou e onde falhou.
 */
async function withTiming<T>(
  label: string,
  context: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  const inicio = Date.now();
  log('info', `⏳ Iniciando: ${label}`, context);
  try {
    const resultado = await fn();
    log('info', `✅ Concluído: ${label}`, { ...context, duracao_ms: Date.now() - inicio });
    return resultado;
  } catch (err) {
    log('error', `❌ Falhou: ${label}`, {
      ...context,
      duracao_ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ============================================================================
// 3. INICIALIZAÇÃO DOS CLIENTES
// ============================================================================
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 4. TIPAGEM DO RETORNO ESPERADO DA IA
// ============================================================================
interface ParsedTransaction {
  description: string;
  total_amount: number;
  category_id: number; // 1 a 10, referente à tabela public.categories
  payment_method: 'pix' | 'credit_card' | 'debit_card';
  my_share_amount?: number | null; // null = 100% minha responsabilidade
  third_party_name?: string | null; // null = não há divisão
}

const CATEGORY_MAP: Record<number, string> = {
  1: 'Alimentação',
  2: 'Transporte',
  3: 'Moradia',
  4: 'Saúde',
  5: 'Lazer',
  6: 'Assinaturas',
  7: 'Compras',
  8: 'Educação',
  9: 'Serviços',
  10: 'Outros',
};

// ============================================================================
// 5. SCHEMA ESTRUTURADO PARA O GEMINI (Structured Output)
// ============================================================================
const transactionSchema = {
  type: Type.OBJECT,
  properties: {
    description: {
      type: Type.STRING,
      description:
        "Nome curto do item ou serviço comprado, extraído da mensagem. Ex: 'Almoço no restaurante'.",
    },
    total_amount: {
      type: Type.NUMBER,
      description: 'Valor TOTAL gasto (antes de qualquer divisão), sempre positivo.',
    },
    category_id: {
      type: Type.INTEGER,
      description: `Categoria da despesa. Escolha o ID mais aderente na lista: ${Object.entries(
        CATEGORY_MAP
      )
        .map(([id, name]) => `${id}=${name}`)
        .join(', ')}.`,
    },
    payment_method: {
      type: Type.STRING,
      enum: ['pix', 'credit_card', 'debit_card'],
      description:
        "Forma de pagamento citada na mensagem. Se não for citada, assuma 'credit_card'.",
    },
    my_share_amount: {
      type: Type.NUMBER,
      nullable: true,
      description:
        'Valor de responsabilidade EXCLUSIVA do usuário, após divisão. Retorne null se a mensagem não mencionar nenhuma divisão de conta. Se a mensagem disser que a despesa foi "dividida" com alguém mas NÃO informar valores exatos, calcule este campo como metade (50%) do total_amount.',
    },
    third_party_name: {
      type: Type.STRING,
      nullable: true,
      description:
        "Primeiro nome da pessoa com quem a despesa foi dividida ou para quem foi feita (ex: 'Irmã', 'Maria'). Retorne null se não houver terceiro envolvido.",
    },
  },
  required: ['description', 'total_amount', 'category_id', 'payment_method'],
};

// ============================================================================
// 6. FUNÇÃO: interpreta a mensagem de texto usando o Gemini
// ============================================================================
async function interpretarGasto(texto: string, requestId: string): Promise<ParsedTransaction> {
  return withTiming('chamada ao Gemini (extrair gasto)', { requestId, modelo: GEMINI_MODEL }, async () => {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Extraia os dados estruturados do seguinte lançamento financeiro: "${texto}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: transactionSchema,
        // Gemini 3.x: não se recomenda mexer em temperature/top_p/top_k.
        // Em vez disso, usamos thinkingLevel baixo: é uma extração simples,
        // não precisa de raciocínio profundo (mais rápido e mais barato).
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const jsonText = response.text;
    log('info', 'Resposta bruta recebida do Gemini', {
      requestId,
      tamanho_resposta: jsonText?.length ?? 0,
    });

    if (!jsonText) {
      throw new Error('Gemini retornou uma resposta vazia.');
    }

    const parsed = JSON.parse(jsonText) as ParsedTransaction;

    if (parsed.total_amount <= 0) {
      throw new Error('Valor extraído é inválido (menor ou igual a zero).');
    }
    if (!CATEGORY_MAP[parsed.category_id]) {
      throw new Error(`category_id inválido retornado pela IA: ${parsed.category_id}`);
    }
    if (parsed.my_share_amount != null && parsed.my_share_amount > parsed.total_amount) {
      throw new Error('my_share_amount não pode ser maior que total_amount.');
    }

    return parsed;
  });
}

// ============================================================================
// 7. PESSOAS: busca e criação em public.people
// ============================================================================

/**
 * Busca o UUID de uma pessoa pelo nome, ignorando acento e caixa
 * (via RPC find_person, que compara pela coluna normalizada no banco).
 * Não cria.
 */
async function buscarPessoaId(nome: string, requestId: string): Promise<string | null> {
  return withTiming('buscar pessoa (RPC find_person)', { requestId, nome }, async () => {
    const { data, error } = await supabase.rpc('find_person', { p_name: nome });
    if (error) {
      throw new Error(`Erro ao buscar pessoa "${nome}": ${error.message}`);
    }
    return (data as string | null) ?? null;
  });
}

/**
 * Busca o UUID de uma pessoa pelo nome (ignorando acento/caixa); cria se
 * não existir. Uma única chamada RPC — a comparação normalizada acontece
 * dentro do banco, então "irmã" e "irma" sempre resolvem para a mesma pessoa.
 */
async function resolveThirdPartyId(nome: string, requestId: string): Promise<string> {
  return withTiming('resolver pessoa (RPC get_or_create_person)', { requestId, nome }, async () => {
    const { data, error } = await supabase.rpc('get_or_create_person', { p_name: nome });
    if (error || !data) {
      throw new Error(`Erro ao resolver pessoa "${nome}": ${error?.message ?? 'sem retorno da RPC'}`);
    }
    return data as string;
  });
}

// ============================================================================
// 8. FUNÇÃO: insere a transação no Supabase
// ============================================================================
async function registrarTransacao(
  dados: ParsedTransaction,
  rawInput: string,
  requestId: string
) {
  let thirdPartyId: string | null = null;

  if (dados.third_party_name) {
    thirdPartyId = await resolveThirdPartyId(dados.third_party_name, requestId);
  }

  await withTiming('inserir transação no Supabase', { requestId }, async () => {
    const { error } = await supabase.from('transactions').insert({
      description: dados.description,
      total_amount: dados.total_amount,
      category_id: dados.category_id,
      payment_method: dados.payment_method,
      my_share_amount: dados.my_share_amount ?? null,
      third_party_id: thirdPartyId,
      raw_input: rawInput,
      // is_recurring e transaction_date ficam de fora: o banco preenche
      // via DEFAULT (false / current_date). my_share_amount, se ficar
      // null aqui, também é preenchido pelo trigger (= total_amount).
    });

    if (error) {
      throw new Error(`Erro ao inserir no Supabase: ${error.message}`);
    }
  });
}

// ============================================================================
// 9. DÍVIDAS: cálculo de saldo via ledger (SUM dívidas - SUM pagamentos)
// ============================================================================

interface SaldoTerceiro {
  nome: string;
  valor: number;
}

/**
 * Calcula o saldo devedor de cada pessoa: soma tudo que ela já "consumiu"
 * em transações divididas, menos a soma de tudo que já pagou de volta
 * (tabela debt_payments). Isso é o que permite pagamento PARCIAL: pagar
 * R$25 de uma dívida de R$50 só precisa de uma linha nova em debt_payments,
 * nenhuma transação antiga precisa ser alterada.
 */
async function getSaldoTerceiros(requestId: string): Promise<SaldoTerceiro[]> {
  return withTiming('calcular saldo de terceiros', { requestId }, async () => {
    const { data: dividas, error: erroDividas } = await supabase
      .from('transactions')
      .select('third_party_id, third_party_share_amount, people(name)')
      .gt('third_party_share_amount', 0);

    if (erroDividas) {
      throw new Error(`Erro ao buscar dívidas: ${erroDividas.message}`);
    }

    const { data: pagamentos, error: erroPagamentos } = await supabase
      .from('debt_payments')
      .select('person_id, amount');

    if (erroPagamentos) {
      throw new Error(`Erro ao buscar pagamentos: ${erroPagamentos.message}`);
    }

    const saldosPorId = new Map<string, { nome: string; saldo: number }>();

    for (const linha of (dividas ?? []) as any[]) {
      const id: string | null = linha.third_party_id;
      const nome: string | undefined = linha.people?.name;
      if (!id || !nome) continue;
      const atual = saldosPorId.get(id) ?? { nome, saldo: 0 };
      atual.saldo += Number(linha.third_party_share_amount);
      saldosPorId.set(id, atual);
    }

    for (const pagamento of (pagamentos ?? []) as any[]) {
      const atual = saldosPorId.get(pagamento.person_id);
      if (!atual) continue; // pagamento órfão (não deveria acontecer)
      atual.saldo -= Number(pagamento.amount);
    }

    log('info', 'Saldos calculados', {
      requestId,
      qtd_dividas: dividas?.length ?? 0,
      qtd_pagamentos: pagamentos?.length ?? 0,
    });

    return Array.from(saldosPorId.values())
      .filter((s) => s.saldo > 0.009) // ignora arredondamento/saldo zerado
      .map((s) => ({ nome: s.nome, valor: Math.round(s.saldo * 100) / 100 }));
  });
}

/** Registra um pagamento no ledger. Não valida limite aqui — quem decide o valor final é handlePagamento. */
async function registrarPagamentoNoBanco(
  personId: string,
  valor: number,
  requestId: string
): Promise<void> {
  await withTiming('registrar pagamento no ledger', { requestId, personId, valor }, async () => {
    const { error } = await supabase
      .from('debt_payments')
      .insert({ person_id: personId, amount: valor });

    if (error) {
      throw new Error(`Erro ao registrar pagamento: ${error.message}`);
    }
  });
}

async function getUltimosGastos(limite: number, requestId: string): Promise<any[]> {
  return withTiming('buscar últimos gastos', { requestId, limite }, async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('description, total_amount, transaction_date, payment_method, categories(name)')
      .order('created_at', { ascending: false })
      .limit(limite);

    if (error) {
      throw new Error(`Erro ao buscar últimos gastos: ${error.message}`);
    }
    return data ?? [];
  });
}

interface ResumoMensal {
  meuGastoReal: number;
  faturaCartao: number;
  gastosRecorrentes: number;
  quantidade: number;
}

async function getResumoMensal(requestId: string): Promise<ResumoMensal> {
  return withTiming('calcular resumo mensal', { requestId }, async () => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('transactions')
      .select('total_amount, my_share_amount, payment_method, is_recurring')
      .gte('transaction_date', primeiroDia)
      .lte('transaction_date', ultimoDia);

    if (error) {
      throw new Error(`Erro ao buscar resumo do mês: ${error.message}`);
    }

    const resumo: ResumoMensal = {
      meuGastoReal: 0,
      faturaCartao: 0,
      gastosRecorrentes: 0,
      quantidade: 0,
    };

    for (const t of data ?? []) {
      const minhaParte = Number(t.my_share_amount ?? 0);
      resumo.meuGastoReal += minhaParte;
      if (t.payment_method === 'credit_card') resumo.faturaCartao += Number(t.total_amount);
      if (t.is_recurring) resumo.gastosRecorrentes += minhaParte;
      resumo.quantidade += 1;
    }

    return resumo;
  });
}

// ============================================================================
// 10. HELPERS DE TEXTO: extração de nome/valor de comandos e frases naturais
// ============================================================================

function formatarReal(valor: number): string {
  return valor.toFixed(2);
}

/** Extrai o primeiro valor numérico de um trecho de texto livre (ex: "25 reais", "R$ 25,50"). */
function extrairValor(txt?: string): number | undefined {
  if (!txt) return undefined;
  const semPrefixo = txt.replace(/r\$\s*/i, '');
  const match = semPrefixo.match(/([\d]+(?:[.,]\d{1,2})?)/);
  if (!match) return undefined;
  return parseFloat(match[1].replace(',', '.'));
}

/** Separa "Irmã 25" em { nome: "Irmã", valor: 25 } — usado no comando /pago. */
function separarNomeValor(texto: string): { nome: string; valor?: number } {
  const regexValorFinal = /\s+(?:r\$\s*)?([\d]+(?:[.,]\d{1,2})?)\s*(?:reais)?\s*$/i;
  const match = texto.match(regexValorFinal);
  if (match) {
    return {
      nome: texto.slice(0, match.index).trim(),
      valor: parseFloat(match[1].replace(',', '.')),
    };
  }
  return { nome: texto.trim() };
}

// Detecta frases como "minha irmã já pagou", "a Maria me pagou 25 reais".
// Grupo 1 = nome, grupo 2 = trecho com o valor (opcional).
// Heurística simples (bot de uso pessoal) — para algo mais robusto, prefira
// sempre o comando explícito /pago <nome> [valor].
const REGEX_PAGAMENTO = /^(?:minha\s+|meu\s+|a\s+|o\s+)?(.+?)\s+(?:j[áa]\s+)?(?:me\s+)?pagou(?:\s+(.+))?$/i;

// ============================================================================
// 11. HANDLERS DE COMANDO
// ============================================================================

async function enviarAjuda(chatId: number) {
  await bot.sendMessage(
    chatId,
    [
      '👋 Bem-vindo ao seu bot financeiro!',
      '',
      'Para registrar um gasto, mande em texto, ex:',
      '"Gastei 45 no almoço no pix"',
      '"Ifood de 50 dividido com minha irmã"',
      '',
      'Comandos disponíveis:',
      '/resumo — resumo do mês atual',
      '/dividas — quanto cada pessoa te deve',
      '/gastos [n] — últimos n gastos (padrão 5)',
      '/pago <nome> [valor] — registra um pagamento (parcial ou total)',
      '',
      'Também entendo frases como "minha irmã já pagou" ou',
      '"minha irmã pagou 25 reais" (pagamento parcial).',
    ].join('\n')
  );
}

async function handleResumo(chatId: number, requestId: string) {
  const r = await getResumoMensal(requestId);
  await bot.sendMessage(
    chatId,
    [
      '📊 Resumo do mês',
      '',
      `💸 Meus gastos reais: R$ ${formatarReal(r.meuGastoReal)}`,
      `💳 Fatura do cartão (total): R$ ${formatarReal(r.faturaCartao)}`,
      `🔁 Recorrentes (minha parte): R$ ${formatarReal(r.gastosRecorrentes)}`,
      `🧾 Lançamentos no mês: ${r.quantidade}`,
    ].join('\n')
  );
}

async function handleDividas(chatId: number, requestId: string) {
  const saldos = await getSaldoTerceiros(requestId);
  if (saldos.length === 0) {
    await bot.sendMessage(chatId, '✅ Ninguém te deve nada no momento.');
    return;
  }
  const linhas = saldos.map((s) => `👤 ${s.nome}: R$ ${formatarReal(s.valor)}`);
  await bot.sendMessage(chatId, ['💰 Quem te deve:', '', ...linhas].join('\n'));
}

async function handleGastos(chatId: number, limite: number, requestId: string) {
  const gastos = await getUltimosGastos(limite, requestId);
  if (gastos.length === 0) {
    await bot.sendMessage(chatId, 'Nenhum gasto registrado ainda.');
    return;
  }
  const linhas = gastos.map((g) => {
    const categoria = g.categories?.name ?? '—';
    return `📅 ${g.transaction_date} | ${g.description} | R$ ${formatarReal(
      Number(g.total_amount)
    )} | ${categoria} | ${g.payment_method}`;
  });
  await bot.sendMessage(chatId, [`🧾 Últimos ${gastos.length} gastos:`, '', ...linhas].join('\n'));
}

/**
 * Registra um pagamento (total ou parcial) de uma pessoa.
 * - Sem `valor` informado: quita o saldo inteiro que ela deve.
 * - Com `valor` informado: abate esse valor do saldo, podendo deixar resto.
 * - Se o valor informado for maior que o saldo devido, trava no saldo devido
 *   (nunca gera saldo negativo/crédito).
 */
async function handlePagamento(chatId: number, nomeBruto: string, valor: number | undefined, requestId: string) {
  const nome = nomeBruto.trim();

  const personId = await buscarPessoaId(nome, requestId);
  if (!personId) {
    await bot.sendMessage(chatId, `❓ Não encontrei ninguém chamado "${nome}" nos seus registros.`);
    return;
  }

  const saldos = await getSaldoTerceiros(requestId);
  const saldoPessoa = saldos.find((s) => s.nome.toLowerCase() === nome.toLowerCase());

  if (!saldoPessoa || saldoPessoa.valor <= 0) {
    await bot.sendMessage(chatId, `✅ ${nome} já não tem nenhuma dívida em aberto.`);
    return;
  }

  let valorPago = valor ?? saldoPessoa.valor; // sem valor = quita tudo
  let aviso = '';

  if (valorPago > saldoPessoa.valor + 0.01) {
    aviso = `\n⚠️ ${nome} devia apenas R$ ${formatarReal(
      saldoPessoa.valor
    )}. Registrei o valor total devido, não os R$ ${formatarReal(valorPago)} informados.`;
    valorPago = saldoPessoa.valor;
  }

  await registrarPagamentoNoBanco(personId, valorPago, requestId);

  const saldoRestante = Math.max(saldoPessoa.valor - valorPago, 0);

  if (saldoRestante <= 0.009) {
    await bot.sendMessage(
      chatId,
      `✅ Quitado! ${nome} pagou R$ ${formatarReal(valorPago)} e não deve mais nada.${aviso}`
    );
  } else {
    await bot.sendMessage(
      chatId,
      `✅ Pagamento parcial registrado! ${nome} pagou R$ ${formatarReal(
        valorPago
      )}. Saldo restante: R$ ${formatarReal(saldoRestante)}.${aviso}`
    );
  }
}

// ============================================================================
// 12. HANDLER PRINCIPAL: um único listener para evitar disparo duplicado
// ============================================================================
bot.on('message', async (msg: Message) => {
  const chatId = msg.chat.id;
  const requestId = randomUUID();

  log('info', '📩 Mensagem recebida', {
    requestId,
    chatId,
    userId: msg.from?.id,
    texto: msg.text,
  });

  try {
    // ---- SEGURANÇA: só processa mensagens do dono do bot ----
    if (msg.from?.id !== AUTHORIZED_USER_ID) {
      log('warn', '🚫 Tentativa de acesso não autorizada', { requestId, userId: msg.from?.id });
      await bot.sendMessage(chatId, '🚫 Acesso negado.');
      return;
    }

    if (!msg.text) {
      log('info', 'Mensagem ignorada: sem texto', { requestId });
      await bot.sendMessage(
        chatId,
        '⚠️ Por enquanto só processo mensagens de texto. Áudio será suportado em uma próxima fase.'
      );
      return;
    }

    const texto = msg.text.trim();

    // ---- ROTEAMENTO DE COMANDOS ----
    if (texto.startsWith('/start')) {
      log('info', 'Comando: /start', { requestId });
      await enviarAjuda(chatId);
      return;
    }
    if (texto.startsWith('/resumo')) {
      log('info', 'Comando: /resumo', { requestId });
      await handleResumo(chatId, requestId);
      return;
    }
    if (texto.startsWith('/dividas')) {
      log('info', 'Comando: /dividas', { requestId });
      await handleDividas(chatId, requestId);
      return;
    }
    if (texto.startsWith('/gastos')) {
      const match = texto.match(/\/gastos\s+(\d+)/);
      const limite = match ? parseInt(match[1], 10) : 5;
      log('info', 'Comando: /gastos', { requestId, limite });
      await handleGastos(chatId, limite, requestId);
      return;
    }
    if (texto.startsWith('/pago')) {
      const match = texto.match(/^\/pago\s+(.+)/i);
      if (!match) {
        await bot.sendMessage(chatId, 'Use assim: /pago Irmã  ou  /pago Irmã 25');
        return;
      }
      const { nome, valor } = separarNomeValor(match[1]);
      log('info', 'Comando: /pago', { requestId, nome, valor });
      await handlePagamento(chatId, nome, valor, requestId);
      return;
    }
    if (texto.startsWith('/')) {
      log('warn', 'Comando não reconhecido', { requestId, texto });
      await bot.sendMessage(
        chatId,
        '❓ Comando não reconhecido. Use /start para ver os comandos disponíveis.'
      );
      return;
    }

    // ---- LINGUAGEM NATURAL: "minha irmã já pagou 25 reais" ----
    const matchPagamento = texto.match(REGEX_PAGAMENTO);
    if (matchPagamento) {
      const nome = matchPagamento[1].trim();
      const valor = extrairValor(matchPagamento[2]);
      log('info', 'Detectado pagamento em linguagem natural', { requestId, nome, valor });
      await handlePagamento(chatId, nome, valor, requestId);
      return;
    }

    // ---- CASO CONTRÁRIO: trata como um novo gasto a registrar ----
    const dados = await interpretarGasto(texto, requestId);
    log('info', 'JSON estruturado pelo Gemini', { requestId, dados });

    await registrarTransacao(dados, texto, requestId);

    const categoriaNome = CATEGORY_MAP[dados.category_id];
    let resposta = `✅ Gasto registrado!\n\n📝 ${dados.description}\n💰 R$ ${formatarReal(
      dados.total_amount
    )}\n🏷️ ${categoriaNome}\n💳 ${dados.payment_method}`;

    if (dados.third_party_name) {
      const minhaParte = dados.my_share_amount ?? dados.total_amount;
      resposta += `\n🤝 Dividido com: ${dados.third_party_name} (sua parte: R$ ${formatarReal(
        minhaParte
      )})`;
    }

    await bot.sendMessage(chatId, resposta);
    log('info', '✅ Fluxo concluído com sucesso', { requestId });
  } catch (err) {
    const mensagemErro = err instanceof Error ? err.message : 'Erro desconhecido.';
    log('error', '❌ Fluxo terminou em erro', { requestId, erro: mensagemErro });
    await bot.sendMessage(chatId, `❌ Não consegui processar sua mensagem.\nMotivo: ${mensagemErro}`);
  }
});

// ============================================================================
// 13. TRATAMENTO DE ERROS GLOBAIS DO POLLING
// ============================================================================
bot.on('polling_error', (error) => {
  log('error', '⚠️ Erro de polling do Telegram', { erro: error.message });
});

log('info', '🚀 Bot iniciado e escutando mensagens via long polling...', { modelo: GEMINI_MODEL });