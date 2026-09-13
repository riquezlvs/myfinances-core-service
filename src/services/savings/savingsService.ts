// src/services/savings/savingsService.ts
//
// Fase 8.7 — Metas de poupança de longo prazo (tabela savings_goals).
// O cálculo do aporte mensal sugerido é DETERMINÍSTICO (código): restante
// dividido pelos meses restantes até o prazo. Nenhuma regra financeira
// depende da IA — ela só roteia a intenção e os parâmetros.
import { getSupabaseClient } from '../../clients/supabaseClient';
import { withTiming, log } from '../../utils/logger';
import { MAX_TRANSACTION_AMOUNT } from '../../config/constants';

export interface MetaPoupanca {
  id: string;
  nome: string;
  alvo: number;
  poupado: number;
  /** Prazo em ISO curto (YYYY-MM-DD) ou null quando não definido. */
  prazo: string | null;
  restante: number;
  /** Meses restantes até o prazo (mínimo 1). null quando não há prazo. */
  mesesRestantes: number | null;
  /** Aporte mensal sugerido = restante / mesesRestantes. null sem prazo. */
  valorMensal: number | null;
  concluida: boolean;
}

export interface PlanoPoupanca {
  restante: number;
  mesesRestantes: number | null;
  valorMensal: number | null;
}

/** Arredonda para 2 casas evitando erros de ponto flutuante. */
function arredondar2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Plano de poupança: quanto falta e quanto poupar por mês.
 * - Sem prazo: informa só o restante (sem aporte mensal sugerido).
 * - Prazo no mês corrente ou passado: assume 1 mês restante (não divide
 *   por zero nem sugere aporte negativo).
 */
export function calcularPlanoPoupanca(
  alvo: number,
  poupado: number,
  prazoISO: string | null,
  agora: Date = new Date()
): PlanoPoupanca {
  const restante = arredondar2(Math.max(alvo - poupado, 0));
  if (!prazoISO) return { restante, mesesRestantes: null, valorMensal: null };

  const prazo = new Date(`${prazoISO}T12:00:00`);
  if (Number.isNaN(prazo.getTime())) return { restante, mesesRestantes: null, valorMensal: null };

  const bruto =
    (prazo.getFullYear() - agora.getFullYear()) * 12 + (prazo.getMonth() - agora.getMonth());
  const mesesRestantes = Math.max(bruto, 1);
  const valorMensal = restante > 0 ? arredondar2(restante / mesesRestantes) : 0;
  return { restante, mesesRestantes, valorMensal };
}

interface SavingsRow {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  deadline_date: string | null;
}

function paraMetaPoupanca(row: SavingsRow, agora: Date = new Date()): MetaPoupanca {
  const alvo = Number(row.target_amount);
  const poupado = Number(row.saved_amount);
  const plano = calcularPlanoPoupanca(alvo, poupado, row.deadline_date, agora);
  return {
    id: row.id,
    nome: row.name,
    alvo,
    poupado,
    prazo: row.deadline_date,
    ...plano,
    concluida: poupado >= alvo,
  };
}

/** Normaliza para comparação de nomes (sem acentos, minúsculas). */
function normalizarNome(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Lista todas as metas de poupança com o plano de aporte calculado. */
export async function listarMetasPoupanca(requestId: string): Promise<MetaPoupanca[]> {
  return withTiming('listar metas de poupança', { requestId }, async () => {
    const { data, error } = await getSupabaseClient()
      .from('savings_goals')
      .select('id, name, target_amount, saved_amount, deadline_date')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Erro ao listar metas de poupança: ${error.message}`);
    return ((data ?? []) as unknown as SavingsRow[]).map((row) => paraMetaPoupanca(row));
  });
}

/**
 * Define (cria) uma meta de poupança. Valida em CÓDIGO (nunca confia na IA):
 * alvo positivo com teto, nome não vazio e prazo válido quando informado.
 */
export async function definirMetaPoupanca(
  nomeBruto: string,
  alvo: number,
  prazoISO: string | null,
  requestId: string
): Promise<MetaPoupanca> {
  const nome = nomeBruto.trim();
  return withTiming('definir meta de poupança', { requestId, nome, alvo, prazoISO }, async () => {
    if (!nome || nome.length > 60) throw new Error('Nome da meta de poupança inválido.');
    if (!Number.isFinite(alvo) || alvo <= 0 || alvo > MAX_TRANSACTION_AMOUNT) {
      throw new Error('Valor-alvo da poupança inválido (deve ser positivo e dentro do limite).');
    }
    if (prazoISO && Number.isNaN(new Date(`${prazoISO}T12:00:00`).getTime())) {
      throw new Error('Prazo da poupança inválido (esperado AAAA-MM).');
    }

    const { data, error } = await getSupabaseClient()
      .from('savings_goals')
      .insert({
        name: nome,
        target_amount: alvo,
        saved_amount: 0,
        deadline_date: prazoISO,
      })
      .select('id, name, target_amount, saved_amount, deadline_date')
      .single();

    if (error) throw new Error(`Erro ao salvar meta de poupança: ${error.message}`);
    const meta = paraMetaPoupanca(data as unknown as SavingsRow);
    log('info', 'Meta de poupança criada', { requestId, nome: meta.nome, alvo: meta.alvo, prazo: meta.prazo });
    return meta;
  });
}

/**
 * Adiciona um aporte à meta. Se o valor exceder o restante, TRAVA no
 * restante (nunca gera "poupado" acima do alvo) e informa o ajuste.
 */
export async function adicionarAporte(
  nomeBruto: string,
  valorInformado: number,
  requestId: string
): Promise<{ meta: MetaPoupanca; valorAplicado: number; avisoValorAjustado?: string } | null> {
  const nome = nomeBruto.trim();
  return withTiming('adicionar aporte à poupança', { requestId, nome, valorInformado }, async () => {
    if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
      throw new Error('Valor do aporte inválido (deve ser positivo).');
    }

    const { data, error } = await getSupabaseClient()
      .from('savings_goals')
      .select('id, name, target_amount, saved_amount, deadline_date');
    if (error) throw new Error(`Erro ao buscar metas de poupança: ${error.message}`);

    const alvo = ((data ?? []) as unknown as SavingsRow[]).find(
      (row) => normalizarNome(row.name) === normalizarNome(nome)
    );
    if (!alvo) return null;

    const meta = paraMetaPoupanca(alvo);
    let valorAplicado = valorInformado;
    let avisoValorAjustado: string | undefined;
    if (meta.restante > 0 && valorAplicado > meta.restante) {
      valorAplicado = meta.restante;
      avisoValorAjustado = `Faltava apenas R$ ${meta.restante.toFixed(2).replace('.', ',')} — apliquei só o restante.`;
    }

    const novoPoupado = arredondar2(meta.poupado + valorAplicado);
    const { error: erroUpdate } = await getSupabaseClient()
      .from('savings_goals')
      .update({ saved_amount: novoPoupado })
      .eq('id', meta.id);
    if (erroUpdate) throw new Error(`Erro ao atualizar poupança: ${erroUpdate.message}`);

    log('info', 'Aporte aplicado à poupança', {
      requestId,
      nome: meta.nome,
      valorAplicado,
      poupadoAgora: novoPoupado,
    });

    return {
      meta: paraMetaPoupanca({ ...alvo, saved_amount: novoPoupado }),
      valorAplicado,
      avisoValorAjustado,
    };
  });
}