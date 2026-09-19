import { randomUUID } from 'crypto';

export interface ParcelaCalculada {
  installmentGroupId: string;
  installmentNumber: number;
  installmentTotal: number;
  amount: number;
  occurredAt: string; // ISO
  descriptionSuffix: string; // "(1/3)"
}

/**
 * Divide um valor total em N parcelas iguais, incrementando o mês a cada
 * parcela. A primeira parcela absorve o resto do arredondamento (centavos),
 * para que a soma de todas as parcelas seja exatamente igual ao total_amount
 * original (ex: 100 / 3 = 33.34 + 33.33 + 33.33).
 *
 * Opcionalmente aceita `closingDay` (dia de fechamento do cartão de crédito):
 * se a data de ocorrência for posterior ao fechamento do cartão, a primeira
 * parcela é postergada para o ciclo seguinte (mês seguinte).
 */
export function calcularParcelas(
  totalAmount: number,
  installmentTotal: number,
  occorridaEmISO: string,
  closingDay?: number | null
): ParcelaCalculada[] {
  if (installmentTotal < 2) {
    throw new Error('calcularParcelas exige installmentTotal >= 2.');
  }

  const installmentGroupId = randomUUID();
  const valorBase = Math.floor((totalAmount / installmentTotal) * 100) / 100;
  const somaBaseDemais = valorBase * (installmentTotal - 1);
  const valorPrimeira = Math.round((totalAmount - somaBaseDemais) * 100) / 100;

  const dataBase = new Date(occorridaEmISO);
  const diaBase = dataBase.getUTCDate();
  const parcelas: ParcelaCalculada[] = [];

  // Se houver dia de fechamento e a compra ocorreu após esse dia,
  // a fatura atual já fechou e o lançamento entra no ciclo subsequente.
  let deslocamentoMesInicial = 0;
  if (closingDay != null && closingDay >= 1 && closingDay <= 31) {
    const ultimoDiaDoMesCompra = new Date(Date.UTC(dataBase.getUTCFullYear(), dataBase.getUTCMonth() + 1, 0)).getUTCDate();
    const fechamentoEfetivo = Math.min(closingDay, ultimoDiaDoMesCompra);
    if (diaBase > fechamentoEfetivo) {
      deslocamentoMesInicial = 1;
    }
  }

  for (let i = 0; i < installmentTotal; i++) {
    const anoAlvo = dataBase.getUTCFullYear();
    const mesAlvo = dataBase.getUTCMonth() + i + deslocamentoMesInicial;

    // último dia do mês alvo (Date.UTC(ano, mes+1, 0) retorna o dia 0 do
    // próximo mês, ou seja, o último dia do mês atual)
    const ultimoDiaMesAlvo = new Date(Date.UTC(anoAlvo, mesAlvo + 1, 0)).getUTCDate();
    const diaClamped = Math.min(diaBase, ultimoDiaMesAlvo);

    const dataParcela = new Date(
      Date.UTC(
        anoAlvo,
        mesAlvo,
        diaClamped,
        dataBase.getUTCHours(),
        dataBase.getUTCMinutes(),
        dataBase.getUTCSeconds(),
        dataBase.getUTCMilliseconds()
      )
    );

    parcelas.push({
      installmentGroupId,
      installmentNumber: i + 1,
      installmentTotal,
      amount: i === 0 ? valorPrimeira : valorBase,
      occurredAt: dataParcela.toISOString(),
      descriptionSuffix: `(${i + 1}/${installmentTotal})`,
    });
  }

  return parcelas;
}