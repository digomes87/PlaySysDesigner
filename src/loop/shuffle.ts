import { mulberry32 } from '../engine/prng';

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Shuffles without changing the original. The same key gives the same order, so
 * options do not jump around on every render, but they change between attempts.
 */
export function shuffled<T>(items: readonly T[], key: string): T[] {
  const random = mulberry32(hash(key));
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const current = result[index] as T;
    result[index] = result[other] as T;
    result[other] = current;
  }
  return result;
}
