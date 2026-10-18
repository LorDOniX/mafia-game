export type Role = 'civilian' | 'mafia' | 'detective' | 'doctor';
export type Phase = 'lobby' | 'night' | 'day' | 'vote' | 'gameover';

export interface Player {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
}

export interface GameState {
  phase: Phase;
  round: number;
  players: Player[];
}

export function createGameState(players: Player[] = []): GameState {
  return { phase: 'lobby', round: 0, players };
}

export const alivePlayers = (state: GameState): Player[] => state.players.filter((p) => p.alive);

export const countAlive = (state: GameState, role: Role): number =>
  state.players.filter((p) => p.alive && p.role === role).length;

/** Vrátí vítěznou stranu, nebo null, pokud hra pokračuje. */
export function checkWinner(state: GameState): 'mafia' | 'town' | null {
  const mafia = countAlive(state, 'mafia');
  const town = alivePlayers(state).length - mafia;

  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}
