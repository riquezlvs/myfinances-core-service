import { describe, it, expect, vi } from 'vitest';
import { enqueue, tamanhoFila, limparFila } from '../../../src/utils/concurrency';

describe('enqueue (fila serial)', () => {
  it('deve executar tasks em ordem FIFO', async () => {
    const ordem: number[] = [];
    const key = 'teste-fifo';

    await Promise.all([
      enqueue(key, async () => {
        await new Promise((r) => setTimeout(r, 30));
        ordem.push(1);
      }),
      enqueue(key, async () => {
        await new Promise((r) => setTimeout(r, 10));
        ordem.push(2);
      }),
      enqueue(key, async () => {
        ordem.push(3);
      }),
    ]);

    expect(ordem).toEqual([1, 2, 3]);
    limparFila(key);
  });

  it('deve isolar filas por chave', async () => {
    const ordem: string[] = [];

    await Promise.all([
      enqueue('a', async () => {
        await new Promise((r) => setTimeout(r, 20));
        ordem.push('a');
      }),
      enqueue('b', async () => {
        ordem.push('b');
      }),
    ]);

    // 'b' não depende de 'a' porque são chaves diferentes.
    expect(ordem).toEqual(['b', 'a']);
    limparFila('a');
    limparFila('b');
  });

  it('deve propagar erro sem quebrar a fila permanentemente', async () => {
    const key = 'teste-erro';

    await expect(
      enqueue(key, async () => {
        throw new Error('falha intencional');
      })
    ).rejects.toThrow('falha intencional');

    // Após a falha, a fila deve continuar funcionando.
    const resultado = await enqueue(key, async () => 'sucesso');
    expect(resultado).toBe('sucesso');
    limparFila(key);
  });

  it('tamanhoFila deve refletir tasks em execução', () => {
    const key = 'teste-tamanho';
    expect(tamanhoFila(key)).toBe(0);

    enqueue(key, async () => {
      // Durante a execução, o tamanho deve ser > 0.
      expect(tamanhoFila(key)).toBeGreaterThan(0);
    });
  });

  it('limparFila deve remover a fila', async () => {
    const key = 'teste-limpar';
    await enqueue(key, async () => 'ok');
    limparFila(key);
    expect(tamanhoFila(key)).toBe(0);
  });
});