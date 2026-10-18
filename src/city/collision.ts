import { rectContains, type CityLayout, type Rect } from './layout';

const CELL_SIZE = 20;
/** Half the side of the square that stands in for a tree trunk. */
export const TRUNK_RADIUS = 0.3;
export const LAMP_POST_RADIUS = 0.15;

/** A box that moves: a car's footprint, in the vehicle heading convention. */
export interface Obstacle {
  x: number;
  z: number;
  /** 0 faces -Z, pi/2 faces +X. */
  heading: number;
  halfLength: number;
  halfWidth: number;
  /** Whatever the obstacle stands for, so a car can ignore its own box. */
  owner?: unknown;
}

/**
 * Uniform grid over building footprints, tree trunks and lamp posts.
 *
 * The city is a few hundred metres across with ~700 buildings, so testing every
 * footprint per frame would be wasteful; bucketing by cell keeps each query to a
 * handful of candidates.
 */
export class CityCollision {
  private readonly cells = new Map<number, Rect[]>();
  private readonly columns: number;
  private readonly bounds: Rect;
  private obstacles: readonly Obstacle[] = [];

  constructor(private readonly layout: CityLayout) {
    this.bounds = layout.bounds;
    this.columns = Math.ceil((this.bounds.maxX - this.bounds.minX) / CELL_SIZE) + 1;

    const post = (x: number, z: number, r: number): Rect => ({
      minX: x - r,
      maxX: x + r,
      minZ: z - r,
      maxZ: z + r,
    });
    const trunks = layout.trees.map(({ x, z }) => post(x, z, TRUNK_RADIUS));
    const lampPosts = layout.lamps.map(({ x, z }) => post(x, z, LAMP_POST_RADIUS));

    for (const rect of [...layout.buildings.map((b) => b.footprint), ...trunks, ...lampPosts]) {
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

  /** True if a circle of `radius` at (x, z) overlaps a building, trunk, post or car. */
  overlaps(x: number, z: number, radius: number, ignore?: unknown): boolean {
    for (const rect of this.candidates(x, z, radius)) {
      const nearestX = Math.min(Math.max(x, rect.minX), rect.maxX);
      const nearestZ = Math.min(Math.max(z, rect.minZ), rect.maxZ);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return this.obstacles.some((o) => o.owner !== ignore && circleHitsObstacle(x, z, radius, o));
  }

  /**
   * Things that move, replaced every frame: cars, so the player bumps into
   * traffic and traffic is solid underfoot. `ignore` in the queries skips the
   * asker's own entry.
   */
  setObstacles(obstacles: readonly Obstacle[]): void {
    this.obstacles = obstacles;
  }

  /** True if a circle at (x, z) overlaps something solid or reaches past the map edge. */
  blocked(x: number, z: number, radius: number, ignore?: unknown): boolean {
    const { bounds } = this;
    return (
      x - radius < bounds.minX ||
      x + radius > bounds.maxX ||
      z - radius < bounds.minZ ||
      z + radius > bounds.maxZ ||
      this.overlaps(x, z, radius, ignore)
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

/** True if a circle at (x, z) overlaps an obstacle's footprint. */
export function circleHitsObstacle(x: number, z: number, radius: number, o: Obstacle): boolean {
  const dx = x - o.x;
  const dz = z - o.z;
  const reach = Math.max(o.halfLength, o.halfWidth) + radius;
  if (dx * dx + dz * dz > reach * reach) return false;

  const along = dx * Math.sin(o.heading) - dz * Math.cos(o.heading);
  const across = dx * Math.cos(o.heading) + dz * Math.sin(o.heading);
  const ax = along - clamp(along, -o.halfLength, o.halfLength);
  const az = across - clamp(across, -o.halfWidth, o.halfWidth);
  return ax * ax + az * az < radius * radius;
}
