import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { RODAPE_UX } from '../../config/constants';

/**
 * Teclado inline de boas-vindas com atalhos interativos para as principais
 * áreas do sistema financeiro pessoal.
 */
export function buildStartKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🏛 Meu Patrimônio', callback_data: 'nav:patrimonio' },
        { text: '💵 Saldo (Safe-to-Spend)', callback_data: 'nav:saldo' },
      ],
      [
        { text: '📦 Investimentos & CDI', callback_data: 'nav:investimentos' },
        { text: '💳 Minha Fatura', callback_data: 'nav:fatura' },
      ],
      [
        { text: '📊 Resumo do Mês', callback_data: 'nav:resumo' },
        { text: '🧭 Ver Todos os Comandos', callback_data: 'nav:comandos' },
      ],
    ],
  };
}

/**
 * Onboarding pedagógico e humanizado do Guará IA (/start).
 * Ensina passo a passo a lógica do sistema: conciliar saldos, registrar
 * entradas, gastar com débito/crédito/VR e acompanhar patrimônio & CDI.
 */
export async function handleStart(chatId: number, bot: TelegramBot = getTelegramBot()): Promise<void> {
  const mensagem = [
    '🦅 *Bem-vindo ao MyFinances (Guará IA) — Seu Assistente Financeiro!*',
    '',
    'Aqui você controla suas finanças de ponta a ponta: *gastos*, *entradas (salário/VR)*, *saldo real vs livre* e seu *patrimônio total (caixinhas e ações)*.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📖 *COMO USAR — GUIA EM 4 PASSOS*',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '1️⃣ *Defina seus saldos iniciais*',
    'Para eu saber quanto dinheiro você tem em cada conta ou benefício:',
    '• `/ajustar\\_saldo Nubank 2500` → define o saldo em conta corrente',
    '• `/ajustar\\_saldo VR 800` → define o saldo do seu vale refeição',
    '• _Ou fale normalmente:_ "Meu saldo no Nubank é 2500"',
    '',
    '2️⃣ *Registre entradas de dinheiro*',
    'Sempre que receber salário, freelance ou recarga:',
    '• "Caiu meu salário de 5000 no Nubank"',
    '• "Recarga do VR de 800"',
    '• "Recebi 1200 de freela no Inter"',
    '_Eu credito no saldo da conta e aumento seu patrimônio!_',
    '',
    '3️⃣ *Registre gastos do dia a dia*',
    'Pode mandar por texto ou áudio sem se preocupar com comandos:',
    '• "Almoço 42 no VR" → _debita do seu saldo de refeição_',
    '• "Mercado 150 no débito" → _debita da conta bancária_',
    '• "Tênis 350 em 3x no Nubank" → _entra na fatura de crédito_',
    '• "Jantar 120 dividido em 3 com João e Maria" → _anota quem te deve_',
    '',
    '4️⃣ *Acompanhe seu Patrimônio & Investimentos*',
    '• `/patrimonio` → Visão 360°: dinheiro em conta + VR + caixinhas + ações − faturas a pagar',
    '• `/saldo` → *Safe-to-Spend*: quanto você realmente pode gastar sem comprometer a fatura do cartão',
    '• `/investimentos` → Caixinhas (com rendimento automático % CDI e projeção de IR) e ações a mercado',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '💡 _Dica: Toque nos botões abaixo para testar as consultas agora mesmo!_',
  ].join('\n');

  await bot.sendMessage(chatId, mensagem, {
    parse_mode: 'Markdown',
    reply_markup: buildStartKeyboard(),
  });
}

/**
 * Menu estruturado com todos os comandos rápidos disponíveis (/comandos).
 */
export async function handleComandos(chatId: number, bot: TelegramBot = getTelegramBot()): Promise<void> {
  const mensagem = [
    '🧭 *ÍNDICE COMPLETO DE COMANDOS*',
    '',
    '🏛 *Patrimônio, Contas & Saldos*:',
    '• `/patrimonio` — resumo do patrimônio líquido consolidado',
    '• `/saldo` — saldo bancário real vs saldo livre (Safe-to-Spend)',
    '• `/investimentos` — caixinhas (% CDI com IR) e ações a mercado',
    '• `/ajustar\\_saldo <conta> <valor>` — definir saldo inicial/conciliar',
    '',
    '📊 *Relatórios & Consultas*:',
    '• `/resumo` — resumo do mês atual (gastos, receitas, alertas)',
    '• `/fatura` — fatura do cartão de crédito fechada e futura',
    '• `/dividas` — cobranças pendentes e divisão de contas',
    '• `/gastos [n]` — lista os últimos n lançamentos (padrão: 5)',
    '• `/grafico` — gera imagem PNG com distribuição por categoria',
    '• `/insight` — diagnóstico financeiro via inteligência artificial',
    '',
    '💳 *Cartões e Vales*:',
    '• `/cartao` — lista cartões e benefícios cadastrados',
    '• `/cartao add <nome> <dia> [credito|vr|va]` — cadastrar cartão',
    '• `/cartao principal <nome>` — definir cartão preferencial',
    '• `/cartao fatura <nome>` — ver fatura de cartão específico',
    '• `/cartao remover <nome>` — desativar cartão',
    '',
    '🎯 *Metas & Poupança*:',
    '• `/meta` — visualizar metas de gastos por categoria',
    '• `/meta <categoria> <limite>` — definir teto de orçamento',
    '• `/poupanca` — metas de poupança e reservas financeiras',
    '• `/poupanca definir <nome> <valor> [AAAA-MM]` — criar objetivo',
    '• `/poupanca add <nome> <valor>` — registrar aporte',
    '',
    '⚙️ *Utilidades*:',
    '• `/pago <nome> [valor]` — dar baixa em quem te devia',
    '• `/desfazer` — cancelar o último lançamento registrado',
    '• `/apagar <id>` — apagar uma compra específica por ID',
    '• `/recorrente` — gerenciar gastos fixos automáticos',
    '• `/exportar [gastos|dividas] [AAAA-MM]` — exportar planilha CSV',
    '• `/viagem` — cotações USD/EUR e modo viagem',
    '• `/status` — saúde do sistema, latência e versão',
    '',
    RODAPE_UX,
  ].join('\n');

  await bot.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
}
