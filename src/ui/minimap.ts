import type { CityLayout, Rect } from '@/city/layout';

/** Šířka viditelné mapy v metrech. */
const RANGE = 160;
/** Rozlišení předkresleného města, pixely na metr. */
const BAKE_SCALE = 2;
/** Dosah zorného kužele, v metrech. */
const CONE_LENGTH = 70;

const ROAD = '#2b2a28';
const SIDEWALK = '#55524b';
const SQUARE = '#625d53';
const PARK = '#4b5a3c';
const BUILDING = '#a99d84';
const TREE = '#2f4a26';
/** Poloměr koruny kreslený na mapě, v metrech. */
const TREE_RADIUS = 2;

export interface MapView {
  x: number;
  z: number;
  /** Yaw kamery: 0 se dívá směrem k -Z, což je na mapě nahoře. */
  yaw: number;
  /** Horizontální zorné pole, v radiánech. */
  fov: number;
}

export interface MapCar {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  color: string;
}

/** Obarvené oblasti (čtvrti) a tečky (lidé) kreslené přes mapu. */
export interface MapMarks {
  areas: ReadonlyArray<{ rect: Rect; color: string }>;
  dots: ReadonlyArray<{ x: number; z: number; color: string }>;
}

const NO_MARKS: MapMarks = { areas: [], dots: [] };
/** Poloměr tečky osoby, v metrech. */
const DOT_RADIUS = 1.6;

/** Nejmenší poloměr tečky osoby na canvasu, v CSS pixelech, aby nezmizela na celé mapě. */
const MIN_DOT_PX = 2;
/** Poloměr značky hráče, v CSS pixelech. */
const PLAYER_PX = 3.5;

/**
 * Minimapa se severem nahoře, s zorným kuželem kamery a všemi auty. Výchozí je
 * výřez centrovaný na kameru; `wholeCity` místo toho ukáže celé město najednou.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly city: HTMLCanvasElement;
  private readonly range: number;
  private readonly center: { x: number; z: number } | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    layout: CityLayout,
    wholeCity = false,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unsupported');
    this.ctx = ctx;
    this.city = bakeCity(layout);
    const { bounds } = layout;
    this.range = wholeCity
      ? Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 1.04
      : RANGE;
    this.center = wholeCity
      ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
      : null;
  }

  draw(view: MapView, cars: readonly MapCar[], marks: MapMarks = NO_MARKS): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const scale = size / this.range;
    const center = this.center ?? view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ROAD;
    ctx.fillRect(0, 0, size, size);

    // Ze světa na canvas: x doprava, z dolů, střed výřezu uprostřed.
    const offsetX = size / 2 - center.x * scale;
    const offsetZ = size / 2 - center.z * scale;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetZ);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.city, 0, 0, this.city.width / BAKE_SCALE, this.city.height / BAKE_SCALE);

    for (const { rect, color } of marks.areas) {
      ctx.fillStyle = color;
      fillRect(ctx, rect);
    }

    // Úhly canvasu běží ve směru hodinových ručiček od +X; yaw 0 míří na mapě nahoru.
    const facing = view.yaw - Math.PI / 2;
    const cone = ctx.createRadialGradient(view.x, view.z, 0, view.x, view.z, CONE_LENGTH);
    cone.addColorStop(0, 'rgba(255, 236, 170, 0.55)');
    cone.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(view.x, view.z);
    ctx.arc(view.x, view.z, CONE_LENGTH, facing - view.fov / 2, facing + view.fov / 2);
    ctx.closePath();
    ctx.fill();

    for (const car of cars) {
      ctx.save();
      ctx.translate(car.x, car.z);
      ctx.rotate(car.heading);
      ctx.fillStyle = car.color;
      ctx.fillRect(-car.width / 2, -car.length / 2, car.width, car.length);
      // Značka kapoty, aby byl směr jízdy patrný na první pohled.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(-car.width / 2, -car.length / 2, car.width, car.length * 0.2);
      ctx.restore();
    }

    const dotRadius = Math.max(DOT_RADIUS, (MIN_DOT_PX * dpr) / scale);
    for (const dot of marks.dots) {
      ctx.fillStyle = dot.color;
      ctx.beginPath();
      ctx.arc(dot.x, dot.z, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(offsetX + view.x * scale, offsetZ + view.z * scale, PLAYER_PX * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Statické město, nakreslené jednou: ulice, chodníky, otevřené bloky, budovy a stromy. */
function bakeCity(layout: CityLayout): HTMLCanvasElement {
  const { bounds } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) * BAKE_SCALE);
  canvas.height = Math.ceil((bounds.maxZ - bounds.minZ) * BAKE_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unsupported');

  ctx.scale(BAKE_SCALE, BAKE_SCALE);
  ctx.translate(-bounds.minX, -bounds.minZ);
  ctx.fillStyle = ROAD;
  fillRect(ctx, bounds);

  for (const block of layout.blocks) {
    ctx.fillStyle = SIDEWALK;
    fillRect(ctx, block.sidewalk);
    if (block.isPlaza) {
      ctx.fillStyle = block.isPark ? PARK : SQUARE;
      fillRect(ctx, block.plot);
    }
  }

  ctx.fillStyle = BUILDING;
  for (const building of layout.buildings) fillRect(ctx, building.footprint);

  ctx.fillStyle = TREE;
  for (const tree of layout.trees) {
    ctx.beginPath();
    ctx.arc(tree.x, tree.z, TREE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillRect(rect.minX, rect.minZ, rect.maxX - rect.minX, rect.maxZ - rect.minZ);
}
