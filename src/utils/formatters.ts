import type { PaymentMethod, ResultadoPagamento } from '../types/transaction';
import { RODAPE_UX } from '../config/constants';

const formatadorReal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata como moeda brasileira: 1234.5 -> "1.234,50". */
export function formatarReal(valor: number): string {
  return formatadorReal.format(valor);
}

/** Formata um ISO 8601 como "dd/mm" para exibição compacta em listas. */
export function formatarDataCurta(iso: string): string {
  const data = new Date(iso);
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

/** Escapa caracteres reservados do Markdown clássico do Telegram (*, _, `, [). */
export function escaparMarkdown(texto?: string | null): string {
  if (!texto) return '';
  return texto.replace(/([*_`\[\]])/g, '\\$1');
}

const LABEL_METODO: Record<PaymentMethod, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  meal_voucher: 'Vale-refeição',
  food_voucher: 'Vale-alimentação',
};

/** 8.2 — Rótulo legível do método de pagamento (ex.: "Vale-refeição"). */
export function formatarMetodo(metodo: PaymentMethod): string {
  return LABEL_METODO[metodo] ?? metodo;
}

/**
 * Formata a confirmação de um pagamento de dívida, encerrando com o rodapé
 * humanizado padrão (8.1). Usado pelo /pago e pelo fluxo conversacional.
 */
export function formatarPagamento(resultado: ResultadoPagamento): string {
  return formatarPagamentoTexto(resultado) + `\n\n${RODAPE_UX}`;
}

function formatarPagamentoTexto(resultado: ResultadoPagamento): string {
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
