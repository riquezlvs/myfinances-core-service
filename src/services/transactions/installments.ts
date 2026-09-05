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
  const parcelas: ParcelaCalculada[] = [];

  for (let i = 0; i < installmentTotal; i++) {
    const dataParcela = new Date(dataBase);
    dataParcela.setMonth(dataBase.getMonth() + i);

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