/** Real seconds in one game day. */
export const DAY_LENGTH_SECONDS = 120;
export const START_HOUR = 12;

/** How the time of day lights the city; every value runs smoothly from 0 to 1. */
export interface Daylight {
  /** 1 at full day, 0 at full night: sun, sky light, fog and sky blend on this. */
  daylight: number;
  /** Peaks at sunrise and sunset, for the warm glow low in the sky. */
  dusk: number;
  /** How far up the street lamps and headlights are turned. */
  lights: number;
}

/** Game time, in hours since the start, advancing with play. */
export class GameClock {
  constructor(public elapsedHours = START_HOUR) {}

  advance(seconds: number): void {
    this.elapsedHours += (seconds * 24) / DAY_LENGTH_SECONDS;
  }

  /** Hour of the day, 0 up to 24. */
  get hour(): number {
    return ((this.elapsedHours % 24) + 24) % 24;
  }

  /** 1 on the first day. */
  get day(): number {
    return Math.floor(this.elapsedHours / 24) + 1;
  }

  /** Jumps forward to the next time the clock reads `hour`. */
  skipTo(hour: number): void {
    this.elapsedHours += (hour - this.hour + 24) % 24 || 24;
  }

  /** "HH:MM", in 24-hour time. */
  label(): string {
    const minutes = Math.floor(this.hour * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

/**
 * Sunrise at 6, noon overhead at 12, sunset at 18. Each transition spans an
 * hour or two of game time, a handful of real seconds, so dusk is a fade.
 */
export function daylightAt(hour: number): Daylight {
  const elevation = Math.sin(((hour - 6) / 12) * Math.PI);
  return {
    daylight: smoothstep(-0.12, 0.3, elevation),
    dusk: Math.max(0, 1 - Math.abs(elevation - 0.03) / 0.25),
    lights: 1 - smoothstep(0, 0.25, elevation),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
