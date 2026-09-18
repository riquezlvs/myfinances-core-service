import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { RODAPE_UX } from '../../config/constants';

export type AjudaTopico = 'menu' | 'gastos' | 'entradas' | 'cartoes' | 'investimentos' | 'comandos';

/**
 * Teclado principal com as categorias de ajuda.
 */
export function buildAjudaMenuKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💸 Gastos & Compras', callback_data: 'ajuda:gastos' },
        { text: '💰 Entradas & Saldos', callback_data: 'ajuda:entradas' },
      ],
      [
        { text: '💳 Cartões & Faturas', callback_data: 'ajuda:cartoes' },
        { text: '📈 Investimentos & Metas', callback_data: 'ajuda:investimentos' },
      ],
      [
        { text: '⚙️ Comandos & Gestão', callback_data: 'ajuda:comandos' },
      ],
      [
        { text: '💵 Consultar Saldo', callback_data: 'nav:saldo' },
        { text: '🏛 Meu Patrimônio', callback_data: 'nav:patrimonio' },
      ],
    ],
  };
}

/**
 * Teclado de rodapé dentro de um tópico de ajuda com botão para voltar ao menu.
 */
export function buildAjudaTopicoKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '⬅️ Voltar ao Menu de Ajuda', callback_data: 'ajuda:menu' },
        { text: '🧭 Todos os Comandos', callback_data: 'nav:comandos' },
      ],
    ],
  };
}

export function obterConteudoAjuda(topico: AjudaTopico): { texto: string; teclado: TelegramBot.InlineKeyboardMarkup } {
  switch (topico) {
    case 'gastos':
      return {
        texto: [
          '💸 *COMO LANÇAR GASTOS & COMPRAS*',
          '',
          'Você não precisa decorar comandos! Basta mandar uma mensagem de texto ou áudio natural.',
          '',
          '📌 *Exemplos Práticos:*',
          '• `Almoço 35 no VR` → Debita diretamente do seu saldo de refeição/VR.',
          '• `Mercado 120 no débito Nubank` → Debita da sua conta bancária.',
          '• `Tênis 450 em 3x no cartão` → Lança parcelado na sua fatura de crédito.',
          '• `Uber 24 ontem` → Registra com a data de ontem.',
          '• `Pizza 90 dividido em 3 com João e Maria` → Anota a sua parte e registra que eles te devem R$ 30 cada.',
          '',
          '💡 *Dicas Úteis:*',
          '• Logo após registrar um gasto, você verá botões para trocar a categoria ou cartão com 1 clique.',
          '• Errou algo? Digite `/desfazer` para cancelar o último lançamento.',
          '• Se precisar apagar um gasto antigo, use `/apagar <id>` (o ID aparece nas consultas e extratos).',
        ].join('\n'),
        teclado: buildAjudaTopicoKeyboard(),
      };

    case 'entradas':
      return {
        texto: [
          '💰 *ENTRADAS, SALÁRIO & SALDOS*',
          '',
          'Mantenha seu saldo e patrimônio sempre atualizados avisando quando receber valores.',
          '',
          '📌 *Registrando Entradas por Texto ou Áudio:*',
          '• `"Caiu meu salário de 4500 no Nubank"`',
          '• `"Recebi 800 de recarga no VR"`',
          '• `"Entrou pix de 250 de freela no Inter"`',
          '_Eu somo automaticamente no saldo da conta e aumento seu patrimônio!_',
          '',
          '⚖️ *Ajustar ou Conciliar Saldo Inicial:*',
          'Quer bater o saldo exato com o app do seu banco? Use:',
          '• `/ajustar_saldo Nubank 2500`',
          '• `/ajustar_saldo VR 650`',
          '',
          '💵 *Safe-to-Spend (Saldo Livre):*',
          'Digite `/saldo` para ver quanto dinheiro você pode gastar sem se endividar, já descontando as faturas que vão fechar!',
        ].join('\n'),
        teclado: buildAjudaTopicoKeyboard(),
      };

    case 'cartoes':
      return {
        texto: [
          '💳 *CARTÕES DE CRÉDITO & BENEFÍCIOS*',
          '',
          'Organize seus cartões de crédito e vales para saber exatamente onde cada compra caiu.',
          '',
          '📌 *Comandos de Cartão:*',
          '• `/cartao` — Lista todos os seus cartões, dias de fechamento e principal.',
          '• `/cartao add Nubank 5 credito` — Adiciona cartão com fechamento dia 5.',
          '• `/cartao add VR 1 vr` — Adiciona cartão do tipo benefício/VR.',
          '• `/cartao principal Nubank` — Define qual cartão é o favorito/padrão.',
          '• `/cartao fatura Nubank` — Detalhes da fatura de um cartão específico.',
          '• `/cartao remover Inter` — Desativa um cartão que você não usa mais.',
          '',
          '🧾 *Consultar sua Fatura:*',
          '• `/fatura` — Mostra o total da fatura atual e futuras parcelas a vencer.',
          '',
          '📱 *Simulador de Parcelamento:*',
          '• `/simular <valor> <parcelas>x [cartão]` — Simula como ficarão suas próximas faturas se comprar algo parcelado.',
          '• _Ou fale normalmente:_ "simula comprar um celular de 2400 em 12x"',
        ].join('\n'),
        teclado: buildAjudaTopicoKeyboard(),
      };

    case 'investimentos':
      return {
        texto: [
          '📈 *INVESTIMENTOS, CAIXINHAS & METAS*',
          '',
          'Acompanhe seu dinheiro trabalhando para você e mantenha suas metas no foco.',
          '',
          '📌 *Patrimônio & Investimentos:*',
          '• `/patrimonio` — Balanço 360° estruturado: Ativos (% e barras gráficas) − Faturas = Patrimônio Líquido, com destaque de Liquidez Livre.',
          '• `/investimentos` — Caixinhas/CDBs (% CDI automático com IR) e ações cotadas a mercado.',
          '',
          '🎯 *Metas de Gastos e Poupança:*',
          '• `/meta` — Acompanhe o teto de gastos por categoria no mês.',
          '• `/meta Restaurante 600` — Define limite de R$ 600 para refeições fora.',
          '• `/poupanca` — Suas metas e reservas financeiras.',
          '• `/poupanca definir Viagem 5000 2026-12` — Cria uma meta com objetivo e prazo.',
          '• `/poupanca add Viagem 300` — Registra um aporte na meta.',
        ].join('\n'),
        teclado: buildAjudaTopicoKeyboard(),
      };

    case 'comandos':
      return {
        texto: [
          '⚙️ *COMANDOS RÁPIDOS & GESTÃO*',
          '',
          'Atalhos úteis para o dia a dia:',
          '',
          '📊 *Consultas e Relatórios:*',
          '• `/resumo` — Painel financeiro do mês (gastos, receitas e alertas).',
          '• `/gastos [n]` — Últimos lançamentos (ex: `/gastos 10`).',
          '• `/grafico` — Gera imagem gráfica da divisão de gastos.',
          '• `/dividas` — Vê quem está te devendo e valores pendentes.',
          '• `/insight` — Análise de IA com recomendações sobre seus hábitos.',
          '',
          '🛠 *Ações e Correções:*',
          '• `/pago <nome> [valor]` — Quita dívida de quem te pagou.',
          '• `/desfazer` — Desfaz imediatamente a última ação.',
          '• `/apagar <id>` — Apaga um gasto específico pelo ID.',
          '• `/exportar` — Baixa planilha em CSV dos seus dados.',
          '• `/viagem` — Cotação de moedas e modo viagem.',
          '• `/status` — Latência e saúde do sistema.',
        ].join('\n'),
        teclado: buildAjudaTopicoKeyboard(),
      };

    case 'menu':
    default:
      return {
        texto: [
          '📖 *CENTRAL DE AJUDA & TUTORIAIS*',
          '',
          'Seja bem-vindo ao guia interativo do *Guará IA*!',
          'Aqui você aprende a usar todos os recursos com rapidez.',
          '',
          '👉 *Escolha um tópico abaixo para ver exemplos e dicas:*',
          '• 💸 *Gastos:* como registrar por texto ou áudio',
          '• 💰 *Entradas:* salários, recargas e saldos',
          '• 💳 *Cartões:* faturas, limites e múltiplos cartões',
          '• 📈 *Investimentos:* CDI, caixinhas e metas de gastos',
          '• ⚙️ *Comandos:* índice de utilidades e atalhos',
          '',
          RODAPE_UX,
        ].join('\n'),
        teclado: buildAjudaMenuKeyboard(),
      };
  }
}

/**
 * Handler disparado via comando /ajuda ou /tutorial.
 */
export async function handleAjuda(
  chatId: number,
  topicoEscolhido: AjudaTopico = 'menu',
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const { texto, teclado } = obterConteudoAjuda(topicoEscolhido);
  await bot.sendMessage(chatId, texto, {
    parse_mode: 'Markdown',
    reply_markup: teclado,
  });
}
