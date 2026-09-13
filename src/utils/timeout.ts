// src/utils/timeout.ts
/**
 * Fase 7 (7.4) — Timeout genérico para chamadas externas (Gemini). Usa
 * Promise.race porque o SDK @google/genai não expõe AbortSignal nativo;
 * o efeito colateral aceito é que a chamada perdedora pode seguir rodando
 * em background (consumindo quota), mas o handler é liberado e o usuário
 * recebe uma resposta de erro em vez de ficar esperando indefinidamente.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, mensagemErro: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(mensagemErro)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}