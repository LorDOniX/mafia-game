import { createRng } from '@/core/rng';

/** Axis-aligned rectangle on the XZ ground plane. */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const TextureLayer = {
  /** Carriageway, with painted markings. Mapped across the road width. */
  Road: 0,
  Sidewalk: 1,
  Cobble: 2,
  Brick: 3,
  Plaster: 4,
  Roof: 5,
  /** Unmarked asphalt, tiled freely. Used for the ground plane. */
  Asphalt: 6,
  /** Park lawns. */
  Grass: 7,
} as const;

export type TextureLayer = (typeof TextureLayer)[keyof typeof TextureLayer];

/** Built-in layers come first in the texture array; custom facades follow. */
export const BUILTIN_LAYER_COUNT = Object.keys(TextureLayer).length;

/**
 * Any layer of the surface texture array: a built-in `TextureLayer`, or a
 * custom facade appended after them (see `city/facades.ts`).
 */
export type SurfaceLayer = number;

/** How much of a facade one repeat of its texture covers. */
export interface FacadeSpan {
  /** Window bays across the image. */
  bays: number;
  /** Storeys up the image. */
  storeys: number;
}

export interface Building {
  footprint: Rect;
  height: number;
  facade: SurfaceLayer;
  /** Absent means one bay by one storey, which is how built-in facades are drawn. */
  facadeSpan?: FacadeSpan;
  tint: [number, number, number];
}

export interface Block {
  /** The buildable plot, excluding the surrounding sidewalk. */
  plot: Rect;
  /** The plot expanded by the sidewalk width. */
  sidewalk: Rect;
  /** Open blocks (plazas/parks) carry no buildings. */
  buildings: Building[];
  isPlaza: boolean;
  /** A plaza laid to grass rather than paved. */
  isPark: boolean;
}

export interface TreeSpot {
  x: number;
  z: number;
  /** Street trees line sidewalks and squares; park trees are mixed. */
  kind: 'street' | 'park';
  /** In [0, 1), for picking a species from whichever list `kind` uses. */
  variant: number;
  rotation: number;
  /** Multiplier on the species' height. */
  size: number;
}

export interface LampSpot {
  x: number;
  z: number;
  /** Turns the lamp's arm (model +Z) out over the road; see `rotationY`. */
  rotation: number;
}

export interface CityConfig {
  seed: number;
  /** Blocks per side; the city is always square. */
  gridSize: number;
  blockSize: number;
  streetWidth: number;
  sidewalkWidth: number;
  sidewalkHeight: number;
  floorHeight: number;
  /** How far a perimeter building reaches into its block. */
  buildingDepth: number;
  minBuildingWidth: number;
  maxBuildingWidth: number;
  plazaChance: number;
  /** Chance of a built block becoming a park instead, at the edge of town; none downtown. */
  parkChance: number;
  /** Gap between street trees along a sidewalk, metres. */
  streetTreeSpacing: number;
  /** Gap between street lamps along a sidewalk, besides the one on every corner. */
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
  /** Full extent of the ground plane, streets included. */
  bounds: Rect;
  /** Centre-to-centre distance between adjacent blocks. */
  pitch: number;
}

const FACADES: TextureLayer[] = [TextureLayer.Brick, TextureLayer.Plaster];

/** Warm brick and pale stucco tones, kept desaturated for a period look. */
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
  // Parks and trees draw from their own stream, so adding them leaves every
  // building where it was.
  const greenRng = createRng(config.seed ^ 0x5eed7ee5);
  const pitch = config.blockSize + config.streetWidth;
  const half = config.streetWidth / 2;

  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const centre = (config.gridSize - 1) / 2;
  // Longest distance from the middle block, used to taper heights outward.
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

      // Downtown sits in the middle: 1 at the centre block, 0 at the corners.
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
 * Lines buildings up along all four edges of a block, terrace-style.
 *
 * North and south rows span the full width; east and west rows are inset by the
 * building depth so the four rows meet at the corners instead of overlapping.
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

      // Absorb a stub too small to stand on its own rather than leaving a gap.
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

/** Trunk distance from the kerb edge of a sidewalk. */
const STREET_TREE_INSET = 1.2;
/** Sidewalk left bare at each corner, for the crossing. */
const CORNER_CLEARANCE = 7;
/** Squares: a ring of trees this far inside the plot, this far apart. */
const SQUARE_TREE_INSET = 4;
const SQUARE_TREE_SPACING = 12;
/** Parks: one tree per grid cell, maybe, with paths left clear through the middle. */
const PARK_CELL = 9;
const PARK_FILL = 0.75;
const PARK_PATH_HALF_WIDTH = 4;

/** Street trees along every sidewalk, a ring round each square, and parks planted. */
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
      // One species per side of the street, as an avenue would be planted.
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

/** Pole distance from the kerb edge of a sidewalk. */
const LAMP_INSET = 0.6;
/** A lamp this close to a street tree is dropped, so the crown does not swallow it. */
const LAMP_TREE_CLEARANCE = 4;

/**
 * A lamp on every sidewalk corner, angled into the crossroads, and more along
 * each side, arms out over the road.
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
  // Outward normals of the sides `rectSides` returns, in the same order.
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

/** The four sides of a rect, each pulled `inset` in from its edge, running full length. */
function rectSides(rect: Rect, inset: number): Segment[] {
  const { minX, maxX, minZ, maxZ } = rect;
  return [
    { from: { x: minX, z: minZ + inset }, to: { x: maxX, z: minZ + inset } },
    { from: { x: minX, z: maxZ - inset }, to: { x: maxX, z: maxZ - inset } },
    { from: { x: minX + inset, z: minZ }, to: { x: minX + inset, z: maxZ } },
    { from: { x: maxX - inset, z: minZ }, to: { x: maxX - inset, z: maxZ } },
  ];
}

/** Points spaced evenly along a segment, centred, keeping `margin` clear at both ends. */
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
