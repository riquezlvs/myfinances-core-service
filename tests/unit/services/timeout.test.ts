import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../../../src/utils/timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('deve resolver normalmente quando a promise original é mais rápida que o timeout', async () => {
    const resultado = await withTimeout(Promise.resolve('ok'), 1000, 'timeout');
    expect(resultado).toBe('ok');
  });

  it('deve propagar a rejeição original quando a promise falha antes do timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('falhou')), 1000, 'timeout')).rejects.toThrow('falhou');
  });

  it('deve rejeitar com a mensagem de timeout quando a promise demora demais', async () => {
    vi.useFakeTimers();
    const promessaLenta = new Promise(() => {});

    const expectativa = expect(withTimeout(promessaLenta, 5000, 'Demorou demais')).rejects.toThrow(
      'Demorou demais'
    );

    await vi.advanceTimersByTimeAsync(5000);
    await expectativa;
  });

  it('não deve deixar o timer pendurado após a promise resolver primeiro', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await withTimeout(Promise.resolve('ok'), 5000, 'timeout');

    expect(clearSpy).toHaveBeenCalled();
  });
});