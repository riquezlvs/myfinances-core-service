import type { ResultadoPagamento } from '../types/transaction';

export function formatarReal(valor: number): string {
  return valor.toFixed(2);
}

/** Formata um ISO 8601 como "dd/mm" para exibição compacta em listas. */
export function formatarDataCurta(iso: string): string {
  const data = new Date(iso);
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

export function formatarPagamento(resultado: ResultadoPagamento): string {
  switch (resultado.status) {
    case 'pessoa_nao_encontrada':
      return `❓ Não encontrei ninguém chamado "${resultado.nome}" nos seus registros.`;
    case 'sem_divida':
      return `✅ ${resultado.nome} já não tem nenhuma dívida em aberto.`;
    case 'quitado': {
      const aviso = resultado.avisoValorAjustado ? `\n⚠️ ${resultado.avisoValorAjustado}` : '';
      return `✅ Quitado! ${resultado.nome} pagou R$ ${formatarReal(resultado.valorPago)} e não deve mais nada.${aviso}`;
    }
    case 'parcial': {
      const aviso = resultado.avisoValorAjustado ? `\n⚠️ ${resultado.avisoValorAjustado}` : '';
      return `✅ Pagamento parcial registrado! ${resultado.nome} pagou R$ ${formatarReal(
        resultado.valorPago
      )}. Saldo restante: R$ ${formatarReal(resultado.saldoRestante)}.${aviso}`;
    }
  }
}