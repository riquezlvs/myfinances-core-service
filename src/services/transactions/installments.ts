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
 * parcela. A última parcela absorve o resto do arredondamento, para que a
 * soma de todas as parcelas seja exatamente igual ao total_amount original
 * (ex: 100 / 3 = 33.33 + 33.33 + 33.34).
 *
 * IMPORTANTE (bug corrigido): o mês é avançado usando componentes de data
 * (ano/mês/dia) em vez de `setMonth()`, que faz overflow em JS. Uma compra
 * em 31/01 parcelada em 3x agora produz 31/01, 28/02, 31/03 — em vez de
 * 31/01, 03/03, 31/03. O dia é clampado para o último dia do mês alvo
 * quando necessário (ex: 30/01 + 1 mês = 28/02, não 02/03).
 */
export function calcularParcelas(
  totalAmount: number,
  installmentTotal: number,
  occorridaEmISO: string
): ParcelaCalculada[] {
  if (installmentTotal < 2) {
    throw new Error('calcularParcelas exige installmentTotal >= 2.');
  }

  const installmentGroupId = randomUUID();
  const valorBase = Math.floor((totalAmount / installmentTotal) * 100) / 100;
  const somaBase = valorBase * (installmentTotal - 1);
  const valorUltima = Math.round((totalAmount - somaBase) * 100) / 100;

  const dataBase = new Date(occorridaEmISO);
  const diaBase = dataBase.getUTCDate();
  const parcelas: ParcelaCalculada[] = [];

  for (let i = 0; i < installmentTotal; i++) {
    const anoAlvo = dataBase.getUTCFullYear();
    const mesAlvo = dataBase.getUTCMonth() + i;

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
      amount: i === installmentTotal - 1 ? valorUltima : valorBase,
      occurredAt: dataParcela.toISOString(),
      descriptionSuffix: `(${i + 1}/${installmentTotal})`,
    });
  }

  return parcelas;
}