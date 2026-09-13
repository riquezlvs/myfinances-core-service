import { describe, it, expect, beforeEach } from 'vitest';
import { verificarRateLimit, tokensRestantes, limparBucket } from '../../../src/utils/rateLimit';

describe('verificarRateLimit (Token Bucket)', () => {
  const chave = 'teste-rate-limit';

  beforeEach(() => {
    limparBucket(chave);
  });

  it('deve permitir requisições dentro do limite', () => {
    for (let i = 0; i < 30; i++) {
      expect(verificarRateLimit(chave)).toBe(true);
    }
  });

  it('deve bloquear após exceder o limite', () => {
    for (let i = 0; i < 30; i++) {
      verificarRateLimit(chave);
    }
    // 31ª requisição deve ser bloqueada.
    expect(verificarRateLimit(chave)).toBe(false);
  });

  it('tokensRestantes deve refletir o consumo', () => {
    expect(tokensRestantes(chave)).toBe(30);
    verificarRateLimit(chave);
    verificarRateLimit(chave);
    expect(tokensRestantes(chave)).toBe(28);
  });

  it('deve isolar buckets por chave', () => {
    const outra = 'outra-chave';
    for (let i = 0; i < 30; i++) {
      verificarRateLimit(chave);
    }
    // 'chave' está bloqueada, mas 'outra' ainda tem tokens.
    expect(verificarRateLimit(chave)).toBe(false);
    expect(verificarRateLimit(outra)).toBe(true);
    limparBucket(outra);
  });

  it('limparBucket deve resetar o bucket', () => {
    for (let i = 0; i < 30; i++) {
      verificarRateLimit(chave);
    }
    expect(verificarRateLimit(chave)).toBe(false);
    limparBucket(chave);
    expect(verificarRateLimit(chave)).toBe(true);
  });
});