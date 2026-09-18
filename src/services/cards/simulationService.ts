import { withTiming } from '../../utils/logger';
import { listarCartoes, type Cartao, type PeriodoFatura } from './cardService';
import { buscarRecorrenciasAtivasCredito } from '../recurring/recurringService';
import { calcularParcelas } from '../transactions/installments';
import { getSupabaseClient } from '../../clients/supabaseClient';

export interface MesSimulacao {
  mesIndice: number; // 1..N
  nomeMes: string; // Ex: "Out/26"
  dataFechamento: Date;
  valorBase: number; // Fatura já existente (lançamentos + parcelas futuras + recorrências)
  valorNovaParcela: number; // Valor da parcela adicional
  valorTotalProjetado: number; // valorBase + valorNovaParcela
  percentualAumento: number; // acréscimo % sobre o valorBase (ou 0 se base for 0)
}

export interface ResultadoSimulacao {
  cartao: Cartao;
  valorTotalCompra: number;
  totalParcelas: number;
  valorMedioParcela: number;
  meses: MesSimulacao[];
  maiorFatura: {
    nomeMes: string;
    valor: number;
  };
}

/**
 * Calcula os N períodos de fatura consecutivos a partir da data de referência.
 */
export function calcularProximosPeriodosFatura(closingDay: number, totalMeses: number, agora = new Date()): PeriodoFatura[] {
  const periodos: PeriodoFatura[] = [];
  const ano = agora.getFullYear();
  const mes = agora.getMonth();

  // Se hoje <= closing_day, o mês corrente ainda está aberto. Caso contrário, começa no mês seguinte.
  const mesOffsetInicial = agora.getDate() <= closingDay ? 0 : 1;

  for (let i = 0; i < totalMeses; i++) {
    const mesFechamento = mes + mesOffsetInicial + i;
    // O ciclo vai de (closingDay + 1) do mês anterior até closingDay do mês do fechamento
    const inicio = new Date(ano, mesFechamento - 1, closingDay + 1);
    const fim = new Date(ano, mesFechamento, closingDay + 1);
    const fechamento = new Date(ano, mesFechamento, closingDay);

    periodos.push({ inicio, fim, fechamento });
  }

  return periodos;
}

/**
 * Motor do Simulador de Compras Parceladas.
 * Projeta o impacto nas próximas N faturas do cartão escolhido (ou principal).
 */
export async function simularParcelamento(
  valorTotal: number,
  totalParcelas: number,
  nomeCartao?: string,
  requestId = 'simulacao',
  dataReferencia = new Date()
): Promise<ResultadoSimulacao> {
  return withTiming('simular parcelamento', { requestId, valorTotal, totalParcelas, nomeCartao }, async () => {
    if (totalParcelas < 2 || totalParcelas > 48) {
      throw new Error('O número de parcelas deve estar entre 2 e 48 vezes.');
    }
    if (valorTotal <= 0) {
      throw new Error('O valor da compra deve ser maior que zero.');
    }

    const cartoes = await listarCartoes(requestId);
    const cartoesCredito = cartoes.filter((c) => c.card_type === 'credit');

    let cartao: Cartao | undefined;
    if (nomeCartao) {
      cartao = cartoesCredito.find((c) => c.name.toLowerCase() === nomeCartao.toLowerCase());
      if (!cartao) {
        throw new Error(`Cartão de crédito "${nomeCartao}" não encontrado.`);
      }
    } else {
      cartao = cartoesCredito.find((c) => c.is_default) || cartoesCredito[0];
      if (!cartao) {
        // Se não tiver cartão cadastrado, usa um default virtual dia 15
        cartao = {
          id: 'default-simulacao',
          name: 'Cartão de Crédito',
          closing_day: 15,
          card_type: 'credit',
          is_default: true,
        };
      }
    }

    const periodos = calcularProximosPeriodosFatura(cartao.closing_day, totalParcelas, dataReferencia);
    const parcelasNovas = calcularParcelas(valorTotal, totalParcelas, dataReferencia.toISOString());

    // 1. Busca todas as recorrências ativas de cartão de crédito
    const recorrencias = await buscarRecorrenciasAtivasCredito(requestId);
    const totalRecorrenciasMensal = recorrencias.reduce((acc, r) => acc + Number(r.total_amount), 0);

    // 2. Busca lançamentos existentes já agendados para os períodos futuros
    const supabase = getSupabaseClient();
    const dataInicioGeral = periodos[0].inicio.toISOString();
    const dataFimGeral = periodos[periodos.length - 1].fim.toISOString();

    let query = supabase
      .from('transactions')
      .select('total_amount, occurred_at, card_id')
      .eq('payment_method', 'credit_card')
      .gte('occurred_at', dataInicioGeral)
      .lt('occurred_at', dataFimGeral);

    if (cartao.id !== 'default-simulacao') {
      const primeiroCreditoId = cartoesCredito[0]?.id;
      const ehPrimeiro = cartao.id === primeiroCreditoId;
      query = ehPrimeiro
        ? query.or(`card_id.eq.${cartao.id},card_id.is.null`)
        : query.eq('card_id', cartao.id);
    }

    const { data: transacoes, error } = await query;
    if (error) {
      throw new Error(`Erro ao consultar gastos existentes: ${error.message}`);
    }

    const itens = (transacoes ?? []) as Array<{ total_amount: number; occurred_at: string }>;

    // 3. Monta mês a mês a projeção
    const meses: MesSimulacao[] = [];
    let maiorFaturaValor = 0;
    let maiorFaturaNome = '';

    for (let i = 0; i < totalParcelas; i++) {
      const p = periodos[i];
      const novaParcela = parcelasNovas[i];

      // Soma transações existentes que caem neste ciclo de fechamento
      const transacoesDoCiclo = itens.filter((it) => {
        const d = new Date(it.occurred_at);
        return d >= p.inicio && d < p.fim;
      });

      const totalExistente = transacoesDoCiclo.reduce((acc, it) => acc + Number(it.total_amount), 0);
      const valorBase = Math.round((totalExistente + totalRecorrenciasMensal) * 100) / 100;
      const valorNovaParcela = novaParcela.amount;
      const valorTotalProjetado = Math.round((valorBase + valorNovaParcela) * 100) / 100;

      const percentualAumento = valorBase > 0
        ? Math.round((valorNovaParcela / valorBase) * 100)
        : 100;

      const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })
        .format(p.fechamento)
        .replace('.', '');

      if (valorTotalProjetado > maiorFaturaValor) {
        maiorFaturaValor = valorTotalProjetado;
        maiorFaturaNome = nomeMes;
      }

      meses.push({
        mesIndice: i + 1,
        nomeMes,
        dataFechamento: p.fechamento,
        valorBase,
        valorNovaParcela,
        valorTotalProjetado,
        percentualAumento,
      });
    }

    return {
      cartao,
      valorTotalCompra: valorTotal,
      totalParcelas,
      valorMedioParcela: Math.round((valorTotal / totalParcelas) * 100) / 100,
      meses,
      maiorFatura: {
        nomeMes: maiorFaturaNome,
        valor: maiorFaturaValor,
      },
    };
  });
}
