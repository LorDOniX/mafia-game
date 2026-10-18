import type { CityLayout, Rect } from '@/city/layout';

/** Metres across the visible map. */
const RANGE = 160;
/** Resolution of the pre-drawn city, pixels per metre. */
const BAKE_SCALE = 2;
/** How far the view cone reaches, metres. */
const CONE_LENGTH = 70;

const ROAD = '#2b2a28';
const SIDEWALK = '#55524b';
const SQUARE = '#625d53';
const PARK = '#4b5a3c';
const BUILDING = '#a99d84';
const TREE = '#2f4a26';
/** Crown radius drawn on the map, metres. */
const TREE_RADIUS = 2;

export interface MapView {
  x: number;
  z: number;
  /** Camera yaw: 0 looks toward -Z, which is up on the map. */
  yaw: number;
  /** Horizontal field of view, radians. */
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

/** Tinted areas (districts) and dots (people) drawn over the map. */
export interface MapMarks {
  areas: ReadonlyArray<{ rect: Rect; color: string }>;
  dots: ReadonlyArray<{ x: number; z: number; color: string }>;
}

const NO_MARKS: MapMarks = { areas: [], dots: [] };
/** Radius of a person's dot, metres. */
const DOT_RADIUS = 1.6;

/** North-up minimap centred on the camera, with its view cone and every car. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly city: HTMLCanvasElement;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    layout: CityLayout,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unsupported');
    this.ctx = ctx;
    this.city = bakeCity(layout);
  }

  draw(view: MapView, cars: readonly MapCar[], marks: MapMarks = NO_MARKS): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const scale = size / RANGE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ROAD;
    ctx.fillRect(0, 0, size, size);

    // World to canvas: x right, z down, the camera in the middle.
    ctx.setTransform(scale, 0, 0, scale, size / 2 - view.x * scale, size / 2 - view.z * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.city, 0, 0, this.city.width / BAKE_SCALE, this.city.height / BAKE_SCALE);

    for (const { rect, color } of marks.areas) {
      ctx.fillStyle = color;
      fillRect(ctx, rect);
    }

    // Canvas angles run clockwise from +X; yaw 0 points up the map.
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
      // Bonnet marker, so the direction of travel reads at a glance.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(-car.width / 2, -car.length / 2, car.width, car.length * 0.2);
      ctx.restore();
    }

    for (const dot of marks.dots) {
      ctx.fillStyle = dot.color;
      ctx.beginPath();
      ctx.arc(dot.x, dot.z, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** The static city, drawn once: streets, sidewalks, open blocks, buildings and trees. */
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
