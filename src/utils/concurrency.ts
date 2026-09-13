/**
 * Fase 9 — Fila serial por chave (chatId).
 *
 * Resolve o problema de race condition quando o Telegram entrega múltiplas
 * mensagens quase simultâneas para o mesmo chat. Sem isso, dois gastos podem
 * ser registrados em paralelo e atropelar o fluxo do menu ou criar dados
 * inconsistentes.
 *
 * Implementação: Promise chain por chave. Cada enqueue() encadeia sua execução
 * após a anterior da mesma key. Se uma task falha, a fila para de receber
 * novas tasks até o próximo reset explícito.
 */

type Task<T> = () => Promise<T>;

interface FilaEntry {
  task: Task<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const filas = new Map<string, Promise<unknown>>();
const filasAtivas = new Map<string, number>();

/**
 * Enfileira uma task para execução serial por key.
 * Tasks da mesma key executam em ordem FIFO, uma por vez.
 */
export async function enqueue<T>(key: string, task: Task<T>): Promise<T> {
  const anterior = filas.get(key) ?? Promise.resolve();

  const promise = anterior
    .then(async () => {
      filasAtivas.set(key, (filasAtivas.get(key) ?? 0) + 1);
      return task();
    })
    .finally(() => {
      const ativas = (filasAtivas.get(key) ?? 1) - 1;
      filasAtivas.set(key, ativas);
      if (ativas <= 0) {
        filas.delete(key);
        filasAtivas.delete(key);
      }
    });

  filas.set(key, promise);
  return promise as Promise<T>;
}

/**
 * Retorna o número de tasks em execução + aguardando para uma key.
 */
export function tamanhoFila(key: string): number {
  return filasAtivas.get(key) ?? 0;
}

/**
 * Limpa a fila de uma key específica (útil para testes ou reset manual).
 */
export function limparFila(key: string): void {
  filas.delete(key);
  filasAtivas.delete(key);
}