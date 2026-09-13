# ADR-0003: Fila Serial por ChatId

**Status:** Aceito  
**Data:** 2026-09-13  
**Contexto:** Fase 9 — Resiliência e concorrência

---

## Contexto

O Telegram pode entregar múltiplas mensagens quase simultaneamente para o mesmo chat (ex: usuário envia 3 mensagens rápido, ou o Telegram reentrega uma mensagem por timeout de rede).

Sem coordenação, isso causa **race conditions**:
- Dois gastos idênticos registrados em paralelo
- Fluxo do menu atropelado (ex: /grafico enquanto processa gasto)
- Leituras inconsistentes no banco (ex: calcular saldo enquanto registra transação)

## Decisão

Implementar **fila serial por chatId** usando `Promise` chain (sem Redis/dependência externa).

## Implementação

```typescript
export async function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const anterior = filas.get(key) ?? Promise.resolve();
  const promise = anterior
    .then(async () => task())
    .finally(() => { /* limpa se não houver mais tasks */ });
  filas.set(key, promise);
  return promise;
}

// Uso no messageHandler
await enqueue(`chat:${chatId}`, async () => {
  await processarMensagemAutorizada(chatId, texto, requestId, bot, msg);
});
```

Cada chat tem sua própria fila, isolada das demais.

## Consequências

**Positivas:**
- Sem dependência externa (Redis/DB) — funciona em single-thread
- Isolamento total entre chats (chat A não bloqueia chat B)
- Simples de entender e manter

**Negativas:**
- Não funciona em múltiplas instâncias (necessitaria Redis no futuro)
- Tasks travadas podem acumular memória (mitigado por timeout do Telegram)

## Referências

- `src/utils/concurrency.ts`
- `src/bot/handlers/messageHandler.ts`