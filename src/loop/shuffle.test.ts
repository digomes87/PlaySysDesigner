import { describe, expect, test } from 'vitest';
import { shuffled } from './shuffle';

const OPTIONS = ['a', 'b', 'c', 'd'];

describe('shuffled', () => {
  test('mantém os mesmos itens e não altera o original', () => {
    const original = [...OPTIONS];

    const result = shuffled(original, 'pergunta-1');

    expect([...result].sort()).toEqual(OPTIONS);
    expect(original).toEqual(OPTIONS);
  });

  test('a mesma chave dá sempre a mesma ordem', () => {
    expect(shuffled(OPTIONS, 'pergunta-1')).toEqual(shuffled(OPTIONS, 'pergunta-1'));
  });

  test('chaves diferentes produzem ordens diferentes', () => {
    const orders = new Set(Array.from({ length: 12 }, (_, attempt) => shuffled(OPTIONS, `pergunta-${attempt}`).join('')));

    expect(orders.size).toBeGreaterThan(3);
  });

  test('a primeira opção não fica sempre no mesmo lugar', () => {
    const positions = new Set(
      Array.from({ length: 20 }, (_, attempt) => shuffled(OPTIONS, `q:${attempt}`).indexOf('a')),
    );

    expect(positions.size).toBe(OPTIONS.length);
  });
});
