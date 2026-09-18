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
        { text: '📖 Como Usar (Guia & Exemplos)', callback_data: 'nav:ajuda' },
      ],
      [
        { text: '💵 Saldo Livre (Safe-to-Spend)', callback_data: 'nav:saldo' },
        { text: '🏛 Meu Patrimônio', callback_data: 'nav:patrimonio' },
      ],
      [
        { text: '💳 Minha Fatura', callback_data: 'nav:fatura' },
        { text: '📊 Resumo do Mês', callback_data: 'nav:resumo' },
      ],
      [
        { text: '🧭 Ver Todos os Comandos', callback_data: 'nav:comandos' },
      ],
    ],
  };
}

/**
 * Onboarding pedagógico e humanizado do Guará IA (/start).
 * Ensina a lógica sem sobrecarregar, apresentando exemplos claros.
 */
export async function handleStart(chatId: number, bot: TelegramBot = getTelegramBot()): Promise<void> {
  const mensagem = [
    '🦅 *Olá! Eu sou o Guará IA, seu copiloto financeiro pessoal.*',
    '',
    'Aqui você não perde tempo preenchendo formulários chatos: basta me mandar mensagens por *texto ou áudio*, como falaria no WhatsApp!',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '⚡ *O QUE VOCÊ PODE MANDAR AGORA:*',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '💸 *1. Lançar Gastos do Dia a Dia*',
    '• `"Almoço 35 no VR"`',
    '• `"Mercado 120 no débito Nubank"`',
    '• `"Tênis 400 em 4x no cartão"`',
    '• `"Churrasco 150 dividido em 3 com Beto e Ana"`',
    '',
    '💰 *2. Registrar Entradas de Dinheiro*',
    '• `"Caiu meu salário de 5000 no Nubank"`',
    '• `"Recebi 800 de recarga no VR"`',
    '',
    '🏛 *3. Consultar sua Saúde Financeira*',
    '• Toque em *Saldo Livre* para ver quanto pode gastar sem se endividar.',
    '• Toque em *Meu Patrimônio* para ver contas, caixinhas CDI e ações.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '👉 *Dúvidas de como começar? Toque em "Como Usar" abaixo ou mande seu primeiro gasto!*',
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
    '💳 *Cartões, Faturas e Simulação*:',
    '• `/cartao` — lista cartões e benefícios cadastrados',
    '• `/cartao add <nome> <dia> [credito|vr|va]` — cadastrar cartão',
    '• `/cartao principal <nome>` — definir cartão preferencial',
    '• `/cartao fatura <nome>` — ver fatura de cartão específico',
    '• `/cartao remover <nome>` — desativar cartão',
    '• `/simular <valor> <parcelas>x [cartao]` — simular impacto nas faturas',
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
