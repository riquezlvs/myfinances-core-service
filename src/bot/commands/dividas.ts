import type TelegramBot from 'node-telegram-bot-api';
import { getTelegramBot } from '../../clients/telegramClient';
import { getSaldoTerceiros } from '../../services/debts/debtService';
import { formatarReal, formatarDataCurta } from '../../utils/formatters';
import { RODAPE_UX } from '../../config/constants';
import { mesAnoAtual, rotuloDoMes } from '../../utils/month';

export async function handleDividas(
  chatId: number,
  requestId: string,
  bot: TelegramBot = getTelegramBot()
): Promise<void> {
  const saldos = await getSaldoTerceiros(requestId, true);
  if (saldos.length === 0) {
    await bot.sendMessage(chatId, `✅ Ninguém te deve nada no momento.\n\n${RODAPE_UX}`);
    return;
  }
  const total = saldos.reduce((soma, saldo) => soma + (saldo.total ?? saldo.valor), 0);
  const totalMes = saldos.reduce((soma, saldo) => soma + (saldo.totalMes ?? 0), 0);
  const restante = saldos.reduce((soma, saldo) => soma + saldo.valor, 0);
  const resumo = [
    `📌 Total: R$ ${formatarReal(total)}`,
    `📅 Total de ${rotuloDoMes(mesAnoAtual())}: R$ ${formatarReal(totalMes)}`,
    `🔻 Restante: R$ ${formatarReal(restante)}`,
  ];
  const linhas = saldos.flatMap((s) => {
    const linhasPessoa = [`👤 ${s.nome}: R$ ${formatarReal(s.valor)}`];
    if (s.parcelas?.length) {
      linhasPessoa.push(
        ...s.parcelas.map((parcela) => {
          const id = parcela.displayId ? `#${parcela.displayId} · ` : '';
          const data = parcela.ocorreuEm ? `${formatarDataCurta(parcela.ocorreuEm)} · ` : '';
          const desc = parcela.descricao ? `${parcela.descricao} ` : 'Lançamento ';
          const identificador = parcela.numero && parcela.total ? `(${parcela.numero}/${parcela.total}) ` : '';
          return `   └ ${id}${data}${desc}${identificador}— R$ ${formatarReal(parcela.valor)}`;
        })
      );
    }
    return linhasPessoa;
  });
  await bot.sendMessage(chatId, ['💰 *Quem te deve:*', '', ...resumo, '', ...linhas, '', RODAPE_UX].join('\n'), {
    parse_mode: 'Markdown',
  });
}
