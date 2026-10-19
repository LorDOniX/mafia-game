import { createRng } from '@/core/rng';

/** Obdélník zarovnaný s osami v rovině terénu XZ. */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const TextureLayer = {
  /** Vozovka s namalovaným značením. Mapuje se přes šířku silnice. */
  Road: 0,
  Sidewalk: 1,
  Cobble: 2,
  Brick: 3,
  Plaster: 4,
  Roof: 5,
  /** Asfalt bez značení, volně dlaždicovaný. Použitý pro rovinu terénu. */
  Asphalt: 6,
  /** Parkové trávníky. */
  Grass: 7,
} as const;

export type TextureLayer = (typeof TextureLayer)[keyof typeof TextureLayer];

/** Vestavěné vrstvy jsou v texture array první; za nimi následují vlastní fasády. */
export const BUILTIN_LAYER_COUNT = Object.keys(TextureLayer).length;

/**
 * Libovolná vrstva texture array povrchů: vestavěná `TextureLayer`, nebo
 * vlastní fasáda přidaná za ně (viz `city/facades.ts`).
 */
export type SurfaceLayer = number;

/** Jakou část fasády pokryje jedno opakování její textury. */
export interface FacadeSpan {
  /** Okenní osy na šířku obrázku. */
  bays: number;
  /** Podlaží na výšku obrázku. */
  storeys: number;
}

export interface Building {
  footprint: Rect;
  height: number;
  facade: SurfaceLayer;
  /** Chybí-li, jde o jednu osu na jedno podlaží, tak jsou kresleny vestavěné fasády. */
  facadeSpan?: FacadeSpan;
  /** Vrstva textury, která v noci svítí místo náhodně rozsvícených oken. */
  nightFacade?: SurfaceLayer;
  tint: [number, number, number];
}

export interface Block {
  /** Stavební pozemek bez okolního chodníku. */
  plot: Rect;
  /** Pozemek rozšířený o šířku chodníku. */
  sidewalk: Rect;
  /** Otevřené bloky (náměstí/parky) nemají žádné budovy. */
  buildings: Building[];
  isPlaza: boolean;
  /** Náměstí zatravněné místo vydlážděného. */
  isPark: boolean;
}

export interface TreeSpot {
  x: number;
  z: number;
  /** Uliční stromy lemují chodníky a náměstí; parkové stromy jsou smíšené. */
  kind: 'street' | 'park';
  /** V [0, 1), pro výběr druhu ze seznamu, který používá `kind`. */
  variant: number;
  rotation: number;
  /** Násobitel výšky druhu. */
  size: number;
}

export interface LampSpot {
  x: number;
  z: number;
  /** Natáčí rameno lampy (model +Z) nad silnici; viz `rotationY`. */
  rotation: number;
}

export interface CityConfig {
  seed: number;
  /** Počet bloků na stranu; město je vždy čtvercové. */
  gridSize: number;
  blockSize: number;
  streetWidth: number;
  sidewalkWidth: number;
  sidewalkHeight: number;
  floorHeight: number;
  /** Jak hluboko sahá obvodová budova do svého bloku. */
  buildingDepth: number;
  minBuildingWidth: number;
  maxBuildingWidth: number;
  plazaChance: number;
  /** Šance, že se zastavěný blok na okraji města stane parkem; v centru nulová. */
  parkChance: number;
  /** Rozestup uličních stromů podél chodníku, v metrech. */
  streetTreeSpacing: number;
  /** Rozestup pouličních lamp podél chodníku, kromě lampy na každém rohu. */
  lampSpacing: number;
}

export const DEFAULT_CITY_CONFIG: CityConfig = {
  seed: 1930,
  gridSize: 8,
  blockSize: 62,
  streetWidth: 16,
  sidewalkWidth: 4,
  sidewalkHeight: 0.15,
  floorHeight: 3.6,
  buildingDepth: 15,
  minBuildingWidth: 9,
  maxBuildingWidth: 19,
  plazaChance: 0.09,
  parkChance: 0.3,
  streetTreeSpacing: 14 * 3,
  lampSpacing: 60,
};

export interface CityLayout {
  config: CityConfig;
  blocks: Block[];
  buildings: Building[];
  trees: TreeSpot[];
  lamps: LampSpot[];
  /** Celý rozsah roviny terénu včetně ulic. */
  bounds: Rect;
  /** Vzdálenost středů sousedních bloků. */
  pitch: number;
}

const FACADES: TextureLayer[] = [TextureLayer.Brick, TextureLayer.Plaster];

/** Teplé cihlové a světlé omítkové tóny, desaturované pro dobový vzhled. */
const BRICK_TINTS: Array<[number, number, number]> = [
  [1.0, 0.86, 0.76],
  [0.92, 0.74, 0.64],
  [0.82, 0.66, 0.6],
  [1.0, 0.78, 0.62],
];

const PLASTER_TINTS: Array<[number, number, number]> = [
  [0.96, 0.94, 0.88],
  [0.88, 0.86, 0.8],
  [0.82, 0.84, 0.82],
  [0.9, 0.88, 0.74],
];

export function generateCity(overrides: Partial<CityConfig> = {}): CityLayout {
  const config: CityConfig = { ...DEFAULT_CITY_CONFIG, ...overrides };
  const rng = createRng(config.seed);
  // Parky a stromy čerpají z vlastního proudu, takže jejich přidání nechá
  // každou budovu tam, kde byla.
  const greenRng = createRng(config.seed ^ 0x5eed7ee5);
  const pitch = config.blockSize + config.streetWidth;
  const half = config.streetWidth / 2;

  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const centre = (config.gridSize - 1) / 2;
  // Největší vzdálenost od prostředního bloku, slouží ke snižování výšek směrem ven.
  const maxDistance = Math.hypot(centre, centre) || 1;

  for (let j = 0; j < config.gridSize; j++) {
    for (let i = 0; i < config.gridSize; i++) {
      const plot: Rect = {
        minX: i * pitch + half,
        minZ: j * pitch + half,
        maxX: i * pitch + half + config.blockSize,
        maxZ: j * pitch + half + config.blockSize,
      };

      const sidewalk = expand(plot, config.sidewalkWidth);
      const isPlaza = rng.chance(config.plazaChance);

      // Centrum je uprostřed: 1 v prostředním bloku, 0 v rozích.
      const density = 1 - Math.hypot(i - centre, j - centre) / maxDistance;

      const block: Block = { plot, sidewalk, buildings: [], isPlaza, isPark: false };
      if (!isPlaza) {
        fillPerimeter(block, config, rng, density);
        if (greenRng.chance(config.parkChance * (1 - density))) {
          block.buildings = [];
          block.isPlaza = true;
          block.isPark = true;
        }
        buildings.push(...block.buildings);
      }
      blocks.push(block);
    }
  }

  const span = config.gridSize * pitch;
  const trees = plantTrees(blocks, config, greenRng);
  return {
    config,
    blocks,
    buildings,
    trees,
    lamps: placeLamps(blocks, config, trees),
    bounds: { minX: 0, minZ: 0, maxX: span, maxZ: span },
    pitch,
  };
}

function expand(rect: Rect, amount: number): Rect {
  return {
    minX: rect.minX - amount,
    minZ: rect.minZ - amount,
    maxX: rect.maxX + amount,
    maxZ: rect.maxZ + amount,
  };
}

/**
 * Řadí budovy podél všech čtyř okrajů bloku, jako řadovou zástavbu.
 *
 * Severní a jižní řada pokrývají celou šířku; východní a západní jsou odsazeny o
 * hloubku budovy, takže se čtyři řady v rozích setkají místo překrývání.
 */
function fillPerimeter(
  block: Block,
  config: CityConfig,
  rng: ReturnType<typeof createRng>,
  density: number,
): void {
  const { plot } = block;
  const d = config.buildingDepth;

  const rows: Array<{ start: number; end: number; toRect: (a: number, b: number) => Rect }> = [
    {
      start: plot.minX,
      end: plot.maxX,
      toRect: (a, b) => ({ minX: a, maxX: b, minZ: plot.minZ, maxZ: plot.minZ + d }),
    },
    {
      start: plot.minX,
      end: plot.maxX,
      toRect: (a, b) => ({ minX: a, maxX: b, minZ: plot.maxZ - d, maxZ: plot.maxZ }),
    },
    {
      start: plot.minZ + d,
      end: plot.maxZ - d,
      toRect: (a, b) => ({ minX: plot.minX, maxX: plot.minX + d, minZ: a, maxZ: b }),
    },
    {
      start: plot.minZ + d,
      end: plot.maxZ - d,
      toRect: (a, b) => ({ minX: plot.maxX - d, maxX: plot.maxX, minZ: a, maxZ: b }),
    },
  ];

  for (const row of rows) {
    let cursor = row.start;

    while (row.end - cursor >= config.minBuildingWidth) {
      const remaining = row.end - cursor;
      let width = rng.range(config.minBuildingWidth, config.maxBuildingWidth);

      // Pohltí zbytek příliš malý na samostatnou budovu, místo aby zůstala mezera.
      if (remaining - width < config.minBuildingWidth) width = remaining;

      const facade = rng.pick(FACADES);
      const maxFloors = Math.round(4 + density * 6);
      const floors = rng.int(Math.max(2, maxFloors - 3), maxFloors);

      block.buildings.push({
        footprint: row.toRect(cursor, cursor + width),
        height: floors * config.floorHeight,
        facade,
        tint: rng.pick(facade === TextureLayer.Brick ? BRICK_TINTS : PLASTER_TINTS),
      });

      cursor += width;
    }
  }
}

/** Vzdálenost kmene od obrubníkové hrany chodníku. */
const STREET_TREE_INSET = 1.2;
/** Volný úsek chodníku na každém rohu, kvůli přechodu. */
const CORNER_CLEARANCE = 7;
/** Náměstí: prstenec stromů takto daleko uvnitř pozemku, s tímto rozestupem. */
const SQUARE_TREE_INSET = 4;
const SQUARE_TREE_SPACING = 12;
/** Parky: nanejvýš jeden strom na buňku mřížky, středem vedou volné cesty. */
const PARK_CELL = 9;
const PARK_FILL = 0.75;
const PARK_PATH_HALF_WIDTH = 4;

/** Uliční stromy podél každého chodníku, prstenec kolem každého náměstí a osázené parky. */
function plantTrees(
  blocks: readonly Block[],
  config: CityConfig,
  rng: ReturnType<typeof createRng>,
): TreeSpot[] {
  const trees: TreeSpot[] = [];
  const spot = (x: number, z: number, kind: TreeSpot['kind'], variant: number): void => {
    trees.push({
      x,
      z,
      kind,
      variant,
      rotation: rng.range(0, Math.PI * 2),
      size: rng.range(0.85, 1.15),
    });
  };

  for (const block of blocks) {
    const { sidewalk, plot } = block;
    const s = STREET_TREE_INSET;
    for (const side of rectSides(sidewalk, s)) {
      // Jeden druh na každou stranu ulice, jak by se sázela alej.
      const variant = rng.next();
      for (const p of evenlyAlong(side, CORNER_CLEARANCE, config.streetTreeSpacing)) {
        spot(p.x, p.z, 'street', variant);
      }
    }

    if (block.isPark) {
      const cx = (plot.minX + plot.maxX) / 2;
      const cz = (plot.minZ + plot.maxZ) / 2;
      const jitter = PARK_CELL * 0.3;
      for (let x = plot.minX + PARK_CELL / 2; x < plot.maxX; x += PARK_CELL) {
        for (let z = plot.minZ + PARK_CELL / 2; z < plot.maxZ; z += PARK_CELL) {
          if (Math.abs(x - cx) < PARK_PATH_HALF_WIDTH || Math.abs(z - cz) < PARK_PATH_HALF_WIDTH) {
            continue;
          }
          if (!rng.chance(PARK_FILL)) continue;
          spot(x + rng.range(-jitter, jitter), z + rng.range(-jitter, jitter), 'park', rng.next());
        }
      }
    } else if (block.isPlaza) {
      const variant = rng.next();
      for (const side of rectSides(plot, SQUARE_TREE_INSET)) {
        for (const p of evenlyAlong(side, SQUARE_TREE_INSET * 2, SQUARE_TREE_SPACING)) {
          spot(p.x, p.z, 'street', variant);
        }
      }
    }
  }

  return trees;
}

/** Vzdálenost sloupu od obrubníkové hrany chodníku. */
const LAMP_INSET = 0.6;
/** Lampa takto blízko uličního stromu se vynechá, aby ji nepohltila koruna. */
const LAMP_TREE_CLEARANCE = 4;

/**
 * Lampa na každém rohu chodníku, natočená do křižovatky, a další podél
 * každé strany, s rameny nad silnicí.
 */
function placeLamps(
  blocks: readonly Block[],
  config: CityConfig,
  trees: readonly TreeSpot[],
): LampSpot[] {
  const lamps: LampSpot[] = [];
  const clearOfTrees = (x: number, z: number): boolean =>
    !trees.some(
      (t) => t.kind === 'street' && Math.hypot(t.x - x, t.z - z) < LAMP_TREE_CLEARANCE,
    );
  // Vnější normály stran, které vrací `rectSides`, ve stejném pořadí.
  const outward = [
    { x: 0, z: -1 },
    { x: 0, z: 1 },
    { x: -1, z: 0 },
    { x: 1, z: 0 },
  ];

  for (const { sidewalk: s } of blocks) {
    const i = LAMP_INSET;
    for (const [x, z, dx, dz] of [
      [s.minX + i, s.minZ + i, -1, -1],
      [s.maxX - i, s.minZ + i, 1, -1],
      [s.minX + i, s.maxZ - i, -1, 1],
      [s.maxX - i, s.maxZ - i, 1, 1],
    ] as const) {
      lamps.push({ x, z, rotation: Math.atan2(dx, dz) });
    }

    rectSides(s, i).forEach((side, k) => {
      const out = outward[k] ?? { x: 0, z: 1 };
      for (const p of evenlyAlong(side, CORNER_CLEARANCE, config.lampSpacing)) {
        if (clearOfTrees(p.x, p.z)) lamps.push({ ...p, rotation: Math.atan2(out.x, out.z) });
      }
    });
  }

  return lamps;
}

interface Segment {
  from: { x: number; z: number };
  to: { x: number; z: number };
}

/** Čtyři strany obdélníku, každá posunutá o `inset` dovnitř od okraje, po celé délce. */
function rectSides(rect: Rect, inset: number): Segment[] {
  const { minX, maxX, minZ, maxZ } = rect;
  return [
    { from: { x: minX, z: minZ + inset }, to: { x: maxX, z: minZ + inset } },
    { from: { x: minX, z: maxZ - inset }, to: { x: maxX, z: maxZ - inset } },
    { from: { x: minX + inset, z: minZ }, to: { x: minX + inset, z: maxZ } },
    { from: { x: maxX - inset, z: minZ }, to: { x: maxX - inset, z: maxZ } },
  ];
}

/** Body rovnoměrně rozmístěné podél úsečky, vystředěné, s volným `margin` na obou koncích. */
function evenlyAlong(
  { from, to }: Segment,
  margin: number,
  spacing: number,
): Array<{ x: number; z: number }> {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const usable = length - 2 * margin;
  if (usable < 0) return [];

  const count = Math.floor(usable / spacing) + 1;
  const start = margin + (usable - (count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, i) => {
    const t = (start + i * spacing) / length;
    return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
  });
}

export const rectContains = (rect: Rect, x: number, z: number): boolean =>
  x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
