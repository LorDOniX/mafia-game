import { rectContains, type CityLayout, type Rect } from './layout';

const CELL_SIZE = 20;
/** Half the side of the square that stands in for a tree trunk. */
export const TRUNK_RADIUS = 0.3;

/**
 * Uniform grid over building footprints and tree trunks.
 *
 * The city is a few hundred metres across with ~700 buildings, so testing every
 * footprint per frame would be wasteful; bucketing by cell keeps each query to a
 * handful of candidates.
 */
export class CityCollision {
  private readonly cells = new Map<number, Rect[]>();
  private readonly columns: number;
  private readonly bounds: Rect;

  constructor(private readonly layout: CityLayout) {
    this.bounds = layout.bounds;
    this.columns = Math.ceil((this.bounds.maxX - this.bounds.minX) / CELL_SIZE) + 1;

    const trunks = layout.trees.map(({ x, z }) => ({
      minX: x - TRUNK_RADIUS,
      maxX: x + TRUNK_RADIUS,
      minZ: z - TRUNK_RADIUS,
      maxZ: z + TRUNK_RADIUS,
    }));

    for (const rect of [...layout.buildings.map((b) => b.footprint), ...trunks]) {
      const minI = this.cellIndex(rect.minX);
      const maxI = this.cellIndex(rect.maxX);
      const minJ = this.cellIndex(rect.minZ);
      const maxJ = this.cellIndex(rect.maxZ);

      for (let j = minJ; j <= maxJ; j++) {
        for (let i = minI; i <= maxI; i++) {
          const key = j * this.columns + i;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(rect);
          else this.cells.set(key, [rect]);
        }
      }
    }
  }

  private cellIndex(coord: number): number {
    return Math.max(0, Math.floor(coord / CELL_SIZE));
  }

  /** Footprints in the cells overlapping a radius around (x, z). */
  private candidates(x: number, z: number, radius: number): Rect[] {
    const found: Rect[] = [];
    const minI = this.cellIndex(x - radius);
    const maxI = this.cellIndex(x + radius);
    const minJ = this.cellIndex(z - radius);
    const maxJ = this.cellIndex(z + radius);

    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const bucket = this.cells.get(j * this.columns + i);
        if (!bucket) continue;
        for (const rect of bucket) {
          if (!found.includes(rect)) found.push(rect);
        }
      }
    }
    return found;
  }

  /** True if a circle of `radius` at (x, z) overlaps any building. */
  overlaps(x: number, z: number, radius: number): boolean {
    for (const rect of this.candidates(x, z, radius)) {
      const nearestX = Math.min(Math.max(x, rect.minX), rect.maxX);
      const nearestZ = Math.min(Math.max(z, rect.minZ), rect.maxZ);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  /** True if a circle at (x, z) overlaps a building or reaches past the map edge. */
  blocked(x: number, z: number, radius: number): boolean {
    const { bounds } = this;
    return (
      x - radius < bounds.minX ||
      x + radius > bounds.maxX ||
      z - radius < bounds.minZ ||
      z + radius > bounds.maxZ ||
      this.overlaps(x, z, radius)
    );
  }

  /**
   * Slides a circle from its current position toward a target.
   *
   * Each axis is resolved on its own so that walking into a wall at an angle
   * slides along it instead of stopping dead.
   */
  resolve(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): { x: number; z: number } {
    let x = fromX;
    let z = fromZ;

    if (!this.overlaps(toX, z, radius)) x = toX;
    if (!this.overlaps(x, toZ, radius)) z = toZ;

    return {
      x: clamp(x, this.bounds.minX + radius, this.bounds.maxX - radius),
      z: clamp(z, this.bounds.minZ + radius, this.bounds.maxZ - radius),
    };
  }

  /** Sidewalks and plazas sit a kerb above the roadway. */
  groundHeightAt(x: number, z: number): number {
    const { config, pitch, blocks } = this.layout;
    const i = Math.floor(x / pitch);
    const j = Math.floor(z / pitch);

    if (i < 0 || j < 0 || i >= config.gridSize || j >= config.gridSize) return 0;

    const block = blocks[j * config.gridSize + i];
    if (!block) return 0;

    return rectContains(block.sidewalk, x, z) ? config.sidewalkHeight : 0;
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
