# ADR-0001: Uso de Intent Routing com Payload Único

**Status:** Aceito  
**Data:** 2026-09-13  
**Contexto:** Fase 8 — Otimização de chamadas ao Gemini

---

## Contexto

Inicialmente, o bot fazia **duas chamadas ao Gemini** por mensagem de texto:
1. `classificarIntencao()` → retornava apenas a intenção (enum)
2. `interpretarGasto()` → retornava os dados da transação (JSON)

Isso gerava:
- **Custo dobrado** de API (Free Tier limitado)
- **Latência dobrada** (2 chamadas sequenciais)
- **Janela de inconsistência**: a intenção podia divergir dos dados extraídos

## Decisão

Unificar em **uma única chamada** que retorna `{ intent, params, transaction, avisos }` (payload único).

## Implementação

```typescript
// Antes: 2 chamadas
const intent = await classificarIntencao(texto, requestId);
const transaction = await interpretarGasto(texto, requestId);

// Depois: 1 chamada
const payload = await classificarIntencao(texto, requestId);
// payload.intent, payload.params, payload.transaction, payload.avisos
```

O `intentRouter.ts` agora usa `buildPayloadSchema` (Zod) para validar o JSON de resposta em runtime.

## Consequências

**Positivas:**
- Redução de ~50% nas chamadas ao Gemini (custo e latência)
- Eliminação da janela de inconsistência entre intent e transaction
- Validação Zod centralizada no payload

**Negativas:**
- Prompt ligeiramente mais complexo (mas dentro dos limites do modelo)
- Aumento marginal no tamanho da resposta (aceitável)

## Referências

- `src/services/gemini/intentRouter.ts`
- `src/services/gemini/schemas.ts` (buildPayloadSchema)