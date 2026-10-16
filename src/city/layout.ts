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
};

export interface CityLayout {
  config: CityConfig;
  blocks: Block[];
  buildings: Building[];
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

      const block: Block = { plot, sidewalk, buildings: [], isPlaza };
      if (!isPlaza) {
        fillPerimeter(block, config, rng, density);
        buildings.push(...block.buildings);
      }
      blocks.push(block);
    }
  }

  const span = config.gridSize * pitch;
  return {
    config,
    blocks,
    buildings,
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

export const rectContains = (rect: Rect, x: number, z: number): boolean =>
  x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
