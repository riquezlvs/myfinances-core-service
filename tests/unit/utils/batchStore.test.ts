import { describe, it, expect } from 'vitest';
import { salvarLoteIds, obterLoteIds } from '../../../src/utils/batchStore';

describe('batchStore', () => {
  it('deve gerar um token curto e recuperar a lista de IDs', () => {
    const ids = [101, 102, 103];
    const token = salvarLoteIds(ids);

    expect(token).toHaveLength(8);
    expect(obterLoteIds(token)).toEqual(ids);
  });

  it('deve fazer fallback se receber uma lista separada por vírgula', () => {
    expect(obterLoteIds('50,51,52')).toEqual([50, 51, 52]);
  });

  it('deve fazer fallback se receber um único ID numérico', () => {
    expect(obterLoteIds('42')).toEqual([42]);
  });

  it('deve retornar array vazio se o token não existir e não for numérico', () => {
    expect(obterLoteIds('inexistente')).toEqual([]);
  });
});
