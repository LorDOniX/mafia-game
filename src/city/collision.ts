import { rectContains, type CityLayout, type Rect } from './layout';

const CELL_SIZE = 20;
/** Polovina strany čtverce, který zastupuje kmen stromu. */
export const TRUNK_RADIUS = 0.3;
export const LAMP_POST_RADIUS = 0.15;
/** Výšky pro výstřely a linie pohledu, metry; budovy mají vlastní. */
const TRUNK_HEIGHT = 3;
const LAMP_POST_HEIGHT = 5.3;
const CAR_HEIGHT = 1.6;
/** Jak jemně se paprsek krokuje světem, metry. */
const RAY_STEP = 0.2;

/** Pohyblivý box: půdorys auta v konvenci natočení vozidla. */
export interface Obstacle {
  x: number;
  z: number;
  /** 0 míří k -Z, pi/2 míří k +X. */
  heading: number;
  halfLength: number;
  halfWidth: number;
  /** Jak je vysoký, pro paprsky; pokud chybí, použije se výška auta. */
  height?: number;
  /** Cokoli, co překážka představuje, aby auto mohlo ignorovat svůj vlastní box. */
  owner?: unknown;
}

/**
 * Rovnoměrná mřížka nad půdorysy budov, kmeny stromů a sloupy lamp.
 *
 * Město má několik set metrů napříč a ~700 budov, takže testovat každý půdorys
 * v každém snímku by bylo zbytečné; rozdělení do buněk omezí každý dotaz na
 * hrstku kandidátů.
 */
export class CityCollision {
  private readonly cells = new Map<number, Rect[]>();
  private readonly heights = new Map<Rect, number>();
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
    for (const b of layout.buildings) this.heights.set(b.footprint, b.height);
    for (const t of trunks) this.heights.set(t, TRUNK_HEIGHT);
    for (const l of lampPosts) this.heights.set(l, LAMP_POST_HEIGHT);

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

  /** Půdorysy v buňkách, které zasahují do okruhu kolem (x, z). */
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

  /** True, pokud kruh o poloměru `radius` v (x, z) zasahuje do budovy, kmene, sloupu či auta. */
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
   * Věci, které se pohybují, nahrazované každý snímek: auta, aby hráč narážel
   * do provozu a provoz byl pod nohama pevný. `ignore` v dotazech přeskakuje
   * vlastní záznam tazatele.
   */
  setObstacles(obstacles: readonly Obstacle[]): void {
    this.obstacles = obstacles;
  }

  /** True, pokud kruh v (x, z) zasahuje do něčeho pevného nebo přes okraj mapy. */
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
   * Posune kruh z aktuální pozice směrem k cíli.
   *
   * Každá osa se řeší zvlášť, takže chůze do zdi pod úhlem po ní klouže
   * místo okamžitého zastavení.
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

  /**
   * Jak daleko paprsek doletí, než narazí na zem, budovu, kmen, sloup
   * nebo auto, nejvýše `maxDistance`. Používá se pro výstřely a linie pohledu.
   */
  raycast(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    maxDistance: number,
    ignore?: unknown,
  ): number {
    for (let d = 0; d < maxDistance; d += RAY_STEP) {
      const x = origin.x + direction.x * d;
      const y = origin.y + direction.y * d;
      const z = origin.z + direction.z * d;
      if (y < 0) return d;
      for (const rect of this.candidates(x, z, 0)) {
        if (y <= (this.heights.get(rect) ?? 0) && rectContains(rect, x, z)) return d;
      }
      for (const o of this.obstacles) {
        if (o.owner !== ignore && y <= (o.height ?? CAR_HEIGHT) && circleHitsObstacle(x, z, 0.01, o)) {
          return d;
        }
      }
    }
    return maxDistance;
  }

  /** Chodníky a náměstí leží o obrubník výš než vozovka. */
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

/** True, pokud kruh v (x, z) zasahuje do půdorysu překážky. */
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
