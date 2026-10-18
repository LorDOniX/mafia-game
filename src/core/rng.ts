export interface Rng {
  /** Rovnoměrně v [0, 1). */
  next(): number;
  /** Rovnoměrně v [min, max). */
  range(min: number, max: number): number;
  /** Celé číslo v [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

/**
 * mulberry32 — malý, rychlý a deterministický. Rozvržení města se generuje
 * znovu ze seedu místo ukládání, takže stejný seed musí vždy dát stejné město
 * napříč běhy i platformami.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number): number => min + next() * (max - min);

  return {
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('Cannot pick from an empty array');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}
