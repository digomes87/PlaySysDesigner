import { describe, expect, test } from 'vitest';
import { shuffled } from './shuffle';

const OPTIONS = ['a', 'b', 'c', 'd'];

describe('shuffled', () => {
  test('keeps the same items and does not change the original', () => {
    const original = [...OPTIONS];

    const result = shuffled(original, 'pergunta-1');

    expect([...result].sort()).toEqual(OPTIONS);
    expect(original).toEqual(OPTIONS);
  });

  test('the same key always gives the same order', () => {
    expect(shuffled(OPTIONS, 'pergunta-1')).toEqual(shuffled(OPTIONS, 'pergunta-1'));
  });

  test('different keys produce different orders', () => {
    const orders = new Set(Array.from({ length: 12 }, (_, attempt) => shuffled(OPTIONS, `pergunta-${attempt}`).join('')));

    expect(orders.size).toBeGreaterThan(3);
  });

  test('the first option does not always stay in the same place', () => {
    const positions = new Set(
      Array.from({ length: 20 }, (_, attempt) => shuffled(OPTIONS, `q:${attempt}`).indexOf('a')),
    );

    expect(positions.size).toBe(OPTIONS.length);
  });
});
