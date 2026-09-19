// src/services/cards/paymentInference.ts
import { log } from '../../utils/logger';
import { obterCartaoPrincipal } from './cardService';
import type { CardType, ParsedTransaction, PaymentMethod } from '../../types/transaction';

/**
 * 8.2 — Inferência DETERMINÍSTICA de método de pagamento (código, nunca IA).
 *
 * Regras (em ordem):
 *  1. IA citou o método → respeitado (origem 'ia', sem card_id).
 *  2. Sem método citado + categoria compatível com benefícios (restaurantes,
 *     supermercado...) → PRINCIPAL meal_voucher (ou food_voucher como 2ª
 *     opção) → gasto no vale (origem 'inferido', com card_id).
 *  3. Sem método citado + categoria comum → PRINCIPAL credit (origem
 *     'inferido', com card_id).
 *  4. Sem cartão elegível → fallback neutro 'pix' (origem 'fallback').
 *
 * O card_id só é preenchido AQUI, em código — o transactionGuard descarta e
 * audita qualquer `card_id` que o LLM tente injetar no payload.
 */
const PALAVRAS_BENEFICIO = [
  'aliment',
  'restaur',
  'supermerc',
  'mercado',
  'lanche',
  'delivery',
  'padaria',
  'ifood',
  'café',
  'cafe',
];

export interface PagamentoResolvido {
  payment_method: PaymentMethod;
  card_id: string | null;
  origem: 'ia' | 'inferido' | 'fallback';
  /** Nome do cartão usado (só na origem 'inferido') — para exibição. */
  cartaoNome?: string;
}

/** Mapeia o tipo do cartão para o payment_method equivalente na transação. */
export function cardTypeParaPaymentMethod(tipo: CardType): PaymentMethod {
  if (tipo === 'credit') return 'credit_card';
  if (tipo === 'debit') return 'debit_card';
  return tipo;
}

/** Função pura: a categoria é compatível com vale-refeição/alimentação? */
export function categoriaEhBeneficio(nomeCategoria: string): boolean {
  const nome = nomeCategoria.toLowerCase();
  return PALAVRAS_BENEFICIO.some((palavra) => nome.includes(palavra));
}

export async function resolverPagamento(input: {
  paymentMethodIA: PaymentMethod | null;
  categoryName: string;
  requestId: string;
}): Promise<PagamentoResolvido> {
  const { paymentMethodIA, categoryName, requestId } = input;

  if (paymentMethodIA) {
    return { payment_method: paymentMethodIA, card_id: null, origem: 'ia' };
  }

  const querBeneficio = categoriaEhBeneficio(categoryName);
  const tipoAlvo: CardType = querBeneficio ? 'meal_voucher' : 'credit';

  const cartao =
    (await obterCartaoPrincipal(tipoAlvo, requestId)) ??
    (querBeneficio ? await obterCartaoPrincipal('food_voucher', requestId) : null);

  if (cartao) {
    log('info', '💳 Método de pagamento inferido', {
      requestId,
      categoria: categoryName,
      cartao: cartao.name,
      tipo: cartao.card_type,
    });
    return {
      payment_method: cardTypeParaPaymentMethod(cartao.card_type),
      card_id: cartao.id,
      origem: 'inferido',
      cartaoNome: cartao.name,
    };
  }

  log('info', '💳 Sem cartão elegível para inferência; usando fallback', {
    requestId,
    categoria: categoryName,
  });
  return { payment_method: 'pix', card_id: null, origem: 'fallback' };
}

/**
 * 8.2 — Wrapper usado por novoGasto/voiceHandler: recebe o payload JÁ
 * validado pelo transactionGuard + o categoryMap e devolve o método final
 * e o card_id (SEMPRE decididos em código, nunca pelo LLM), o nome do
 * cartão usado (exibição) e um aviso opcional anexado à confirmação.
 */
export async function inferirMetodoPagamento(
  dados: ParsedTransaction,
  categoryMap: Record<number, string>,
  requestId: string
): Promise<{
  payment_method: PaymentMethod;
  card_id: string | null;
  cartaoNome?: string;
  aviso?: string;
}> {
  const decisao = await resolverPagamento({
    paymentMethodIA: dados.payment_method,
    categoryName: categoryMap[dados.category_id] ?? '',
    requestId,
  });

  // A IA citou o método explicitamente: respeitado, sem card_id e sem aviso.
  if (decisao.origem === 'ia') {
    return { payment_method: decisao.payment_method, card_id: decisao.card_id };
  }

  if (decisao.origem === 'inferido' && decisao.cartaoNome) {
    return {
      payment_method: decisao.payment_method,
      card_id: decisao.card_id,
      cartaoNome: decisao.cartaoNome,
      aviso: `ℹ️ Você não citou o método — lancei em "${decisao.cartaoNome}". Toque em "Alterar Método" se preferir outro.`,
    };
  }

  return {
    payment_method: decisao.payment_method,
    card_id: decisao.card_id,
    aviso: 'ℹ️ Sem cartão/vale principal cadastrado — lancei como Pix. Toque em "Alterar Método" se preferir outro.',
  };
}
