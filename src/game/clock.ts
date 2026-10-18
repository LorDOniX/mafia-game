/** Skutečné sekundy jednoho herního dne. */
export const DAY_LENGTH_SECONDS = 300;
export const START_HOUR = 7;

/** Jak denní doba osvětluje město; každá hodnota plynule běží od 0 do 1. */
export interface Daylight {
  /** 1 za plného dne, 0 za plné noci: podle toho se míchá slunce, světlo oblohy, mlha a nebe. */
  daylight: number;
  /** Vrchol při východu a západu slunce, pro teplý zář nízko na obloze. */
  dusk: number;
  /** Jak moc jsou zapnuté pouliční lampy a světlomety. */
  lights: number;
}

/** Herní čas v hodinách od začátku, plyne s hrou. */
export class GameClock {
  constructor(public elapsedHours = START_HOUR) {}

  advance(seconds: number): void {
    this.elapsedHours += (seconds * 24) / DAY_LENGTH_SECONDS;
  }

  /** Hodina dne, od 0 do 24. */
  get hour(): number {
    return ((this.elapsedHours % 24) + 24) % 24;
  }

  /** 1 první den. */
  get day(): number {
    return Math.floor(this.elapsedHours / 24) + 1;
  }

  /** Skočí dopředu na nejbližší okamžik, kdy hodiny ukážou `hour`. */
  skipTo(hour: number): void {
    this.elapsedHours += (hour - this.hour + 24) % 24 || 24;
  }

  /** "HH:MM", ve 24hodinovém formátu. */
  label(): string {
    const minutes = Math.floor(this.hour * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

/**
 * Východ slunce v 6, poledne nad hlavou ve 12, západ v 18. Každý přechod trvá
 * hodinu či dvě herního času, pár skutečných sekund, takže soumrak je prolnutí.
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
