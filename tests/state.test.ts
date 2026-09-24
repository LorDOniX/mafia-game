import { describe, expect, it } from 'vitest';
import { checkWinner, countAlive, createGameState, type Player } from '@/game/state';

const player = (id: string, role: Player['role'], alive = true): Player => ({
  id,
  name: id,
  role,
  alive,
});

describe('checkWinner', () => {
  it('returns null while town outnumbers mafia', () => {
    const state = createGameState([
      player('a', 'mafia'),
      player('b', 'civilian'),
      player('c', 'detective'),
    ]);
    expect(checkWinner(state)).toBeNull();
  });

  it('gives town the win once all mafia are dead', () => {
    const state = createGameState([player('a', 'mafia', false), player('b', 'civilian')]);
    expect(checkWinner(state)).toBe('town');
  });

  it('gives mafia the win at parity', () => {
    const state = createGameState([player('a', 'mafia'), player('b', 'civilian')]);
    expect(checkWinner(state)).toBe('mafia');
  });
});

describe('countAlive', () => {
  it('only counts living players of the role', () => {
    const state = createGameState([
      player('a', 'mafia'),
      player('b', 'mafia', false),
      player('c', 'civilian'),
    ]);
    expect(countAlive(state, 'mafia')).toBe(1);
  });
});
