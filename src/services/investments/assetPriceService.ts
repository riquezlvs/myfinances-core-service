import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import type { InvestmentAsset, AssetType } from '../../types/investment';

// Cache em memória de cotações por 15 minutos
interface QuoteCacheEntry {
  price: number;
  timestamp: number;
}
const quoteCache = new Map<string, QuoteCacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Busca a cotação atual de mercado de um ativo (B3 ou Cripto).
 * Tenta Brapi -> Yahoo Finance -> Fallback.
 */
export async function obterCotacaoMercado(ticker: string, fallbackPrice: number = 0): Promise<number> {
  const normalTicker = ticker.trim().toUpperCase();
  const cached = quoteCache.get(normalTicker);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // Brapi API pública
    const res = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(normalTicker)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const regularMarketPrice = data.results?.[0]?.regularMarketPrice;
      if (typeof regularMarketPrice === 'number' && regularMarketPrice > 0) {
        quoteCache.set(normalTicker, { price: regularMarketPrice, timestamp: Date.now() });
        return regularMarketPrice;
      }
    }
  } catch (err) {
    // Continua para fallback
  }

  // Fallback para Yahoo Finance
  try {
    const yahooTicker = normalTicker.includes('.') || normalTicker === 'BTC' || normalTicker.includes('-')
      ? normalTicker === 'BTC' ? 'BTC-USD' : normalTicker
      : `${normalTicker}.SA`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const metaPrice = data.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof metaPrice === 'number' && metaPrice > 0) {
        quoteCache.set(normalTicker, { price: metaPrice, timestamp: Date.now() });
        return metaPrice;
      }
    }
  } catch (err) {
    // Falha silenciosa
  }

  // Fallback seguro: usa o preço médio ou valor anterior
  return fallbackPrice;
}

/**
 * Lista os ativos cadastrados.
 */
export async function listarAtivos(accountId?: string, requestId: string = 'listar-ativos'): Promise<InvestmentAsset[]> {
  return withTiming('listar ativos de investimento', { requestId, accountId }, async () => {
    let query = getSupabaseClient().from('investment_assets').select('*');
    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query.order('ticker', { ascending: true });
    if (error) throw new Error(`Erro ao listar ativos: ${error.message}`);
    return (data ?? []) as unknown as InvestmentAsset[];
  });
}

/**
 * Cadastra ou atualiza um ativo de investimento.
 */
export async function cadastrarOuAtualizarAtivo(
  ativo: {
    account_id: string;
    ticker: string;
    asset_type: AssetType;
    quantity: number;
    average_price: number;
  },
  requestId: string
): Promise<InvestmentAsset> {
  return withTiming('cadastrar ativo de investimento', { requestId, ticker: ativo.ticker }, async () => {
    const normalTicker = ativo.ticker.trim().toUpperCase();
    const { data, error } = await getSupabaseClient()
      .from('investment_assets')
      .upsert(
        {
          account_id: ativo.account_id,
          ticker: normalTicker,
          asset_type: ativo.asset_type,
          quantity: ativo.quantity,
          average_price: ativo.average_price,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,ticker' }
      )
      .select('*')
      .single();

    if (error) throw new Error(`Erro ao salvar ativo: ${error.message}`);
    return data as unknown as InvestmentAsset;
  });
}

/**
 * Retorna a carteira consolidada enriquecida com cotações atuais e rentabilidade.
 */
export async function obterCarteiraComCotacoes(
  requestId: string = 'carteira-renda-variavel'
): Promise<{ assets: InvestmentAsset[]; totalInvested: number; totalMarketValue: number; totalProfitLoss: number }> {
  return withTiming('obter carteira com cotações', { requestId }, async () => {
    const ativos = await listarAtivos(undefined, requestId);
    let totalInvested = 0;
    let totalMarketValue = 0;

    const enrichedAssets: InvestmentAsset[] = [];

    for (const item of ativos) {
      const precoMedio = Number(item.average_price);
      const qtd = Number(item.quantity);
      const invested = Math.round(precoMedio * qtd * 100) / 100;

      const currentPrice = await obterCotacaoMercado(item.ticker, precoMedio);
      const marketVal = Math.round(currentPrice * qtd * 100) / 100;
      const profitLoss = Math.round((marketVal - invested) * 100) / 100;
      const profitLossPct = invested > 0 ? Math.round(((marketVal - invested) / invested) * 10000) / 100 : 0;

      totalInvested += invested;
      totalMarketValue += marketVal;

      enrichedAssets.push({
        ...item,
        current_price: currentPrice,
        total_invested: invested,
        market_value: marketVal,
        profit_loss: profitLoss,
        profit_loss_pct: profitLossPct,
      });
    }

    totalInvested = Math.round(totalInvested * 100) / 100;
    totalMarketValue = Math.round(totalMarketValue * 100) / 100;
    const totalProfitLoss = Math.round((totalMarketValue - totalInvested) * 100) / 100;

    return {
      assets: enrichedAssets,
      totalInvested,
      totalMarketValue,
      totalProfitLoss,
    };
  });
}
