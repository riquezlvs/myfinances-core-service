import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { withTiming, log } from '../../utils/logger';
import { formatarReal } from '../../utils/formatters';
import { simularParcelamento, type ResultadoSimulacao } from '../../services/cards/simulationService';
import { RODAPE_UX } from '../../config/constants';

/**
 * Formata o resultado da simulação para apresentação rica no Telegram.
 */
export function formatarMensagemSimulacao(resultado: ResultadoSimulacao): string {
  const { cartao, valorTotalCompra, totalParcelas, valorMedioParcela, meses, maiorFatura } = resultado;

  const linhas: string[] = [];

  linhas.push('📱 *SIMULAÇÃO DE PARCELAMENTO*');
  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  linhas.push(`💳 *Cartão:* ${cartao.name} (fecha todo dia ${cartao.closing_day})`);
  linhas.push(
    `🏷️ *Compra:* R$ ${formatarReal(valorTotalCompra)} em *${totalParcelas}x de R$ ${formatarReal(valorMedioParcela)}*\n`
  );

  linhas.push('📊 *IMPACTO NAS PRÓXIMAS FATURAS:*');
  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const m of meses) {
    const dataFmt = `${String(m.dataFechamento.getDate()).padStart(2, '0')}/${String(
      m.dataFechamento.getMonth() + 1
    ).padStart(2, '0')}`;

    const tagAumento = m.valorBase > 0
      ? `(+R$ ${formatarReal(m.valorNovaParcela)} | +${m.percentualAumento}%)`
      : `(+R$ ${formatarReal(m.valorNovaParcela)})`;

    linhas.push(
      `• *${m.nomeMes}* _(fecha ${dataFmt})_:\n` +
      `  R$ ${formatarReal(m.valorBase)} ➔ *R$ ${formatarReal(m.valorTotalProjetado)}* ${tagAumento}`
    );
  }

  linhas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  linhas.push(`📈 *Pico da Maior Fatura:* R$ ${formatarReal(maiorFatura.valor)} (em ${maiorFatura.nomeMes})`);
  linhas.push(`💰 *Comprometimento Total:* ${totalParcelas} meses até ${meses[meses.length - 1].nomeMes}`);
  linhas.push('\n💡 _Essa é apenas uma simulação visual. Nada foi lançado nas suas contas._');
  linhas.push(`\n${RODAPE_UX}`);

  return linhas.join('\n');
}

/**
 * Faz o parsing dos argumentos de /simular.
 * Formatos aceitos:
 * - "/simular 2400 12x"
 * - "/simular 2400 12"
 * - "/simular 1500 5x Nubank"
 * - "/simular celular 2400 12x" (tolerante)
 */
export function parseArgumentosSimulacao(argumentos: string): {
  valor: number;
  parcelas: number;
  cartao?: string;
} {
  const partes = argumentos.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) {
    throw new Error(
      '⚠️ *Como simular compras parceladas:*\n\n' +
        'Uso: `/simular <valor> <parcelas>x [cartão]`\n\n' +
        '📌 *Exemplos:*\n' +
        '• `/simular 2400 12x`\n' +
        '• `/simular 1500 6x Nubank`\n' +
        '• `/simular 800 5`\n\n' +
        '_Ou fale normalmente:_ "simula comprar um celular de 2400 em 12x"'
    );
  }

  let valor: number | undefined;
  let parcelas: number | undefined;
  const restosCartao: string[] = [];

  for (const p of partes) {
    // Detecta parcelas com sufixo "x" ou "vezes" (ex: "12x", "12X")
    const matchX = p.match(/^(\d{1,2})x?$/i);
    const matchSoNumero = p.match(/^\d+$/);

    // Se tem vírgula ou ponto decimal, provavelmente é o valor monetário
    if (/^\d+(?:[.,]\d{1,2})?$/.test(p) && !p.toLowerCase().includes('x') && valor === undefined && parseFloat(p.replace(',', '.')) > 48) {
      valor = parseFloat(p.replace(',', '.'));
      continue;
    }

    if (matchX && p.toLowerCase().endsWith('x') && parcelas === undefined) {
      parcelas = parseInt(matchX[1], 10);
      continue;
    }

    if (valor === undefined && /^\d+(?:[.,]\d{1,2})?$/.test(p)) {
      valor = parseFloat(p.replace(',', '.'));
      continue;
    }

    if (parcelas === undefined && matchSoNumero) {
      const n = parseInt(p, 10);
      if (n >= 2 && n <= 48) {
        parcelas = n;
        continue;
      }
    }

    restosCartao.push(p);
  }

  if (!valor || valor <= 0) {
    throw new Error('⚠️ Valor da compra inválido. Exemplo: `/simular 2400 12x`');
  }

  if (!parcelas || parcelas < 2 || parcelas > 48) {
    throw new Error('⚠️ Número de parcelas deve estar entre 2 e 48. Exemplo: `/simular 2400 12x`');
  }

  const cartao = restosCartao.length > 0 ? restosCartao.join(' ') : undefined;

  return { valor, parcelas, cartao };
}

/**
 * Handler do comando /simular.
 */
export async function handleSimular(
  chatId: number,
  argumentos: string,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  await withTiming('comando /simular', { requestId, argumentos }, async () => {
    try {
      const { valor, parcelas, cartao } = parseArgumentosSimulacao(argumentos);
      const resultado = await simularParcelamento(valor, parcelas, cartao, requestId);
      const texto = formatarMensagemSimulacao(resultado);

      await bot.sendMessage(chatId, texto, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Ver Fatura Atual', callback_data: 'nav:fatura' },
              { text: '💵 Ver Saldo Livre', callback_data: 'nav:saldo' },
            ],
          ],
        },
      });
    } catch (err) {
      log('warn', 'Aviso no comando /simular', {
        requestId,
        erro: err instanceof Error ? err.message : String(err),
      });
      await bot.sendMessage(
        chatId,
        err instanceof Error ? err.message : '❌ Não consegui realizar a simulação. Tente novamente.',
        { parse_mode: 'Markdown' }
      );
    }
  });
}
