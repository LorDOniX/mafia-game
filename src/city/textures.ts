import { createRng, type Rng } from '@/core/rng';
import { TextureLayer } from './layout';

/**
 * Edge length of every layer in the surface texture array.
 *
 * All layers must match, so downloaded art is rescaled to this. Raise it if you
 * swap in photographic textures and want more detail than 1024 carries; cost is
 * 6 * size^2 * 4 bytes plus a third again for mipmaps, for each of the colour
 * and normal arrays.
 */
export const TEXTURE_SIZE = 1024;

/**
 * Every surface texture is drawn procedurally so the project needs no binary
 * assets. Each one tiles seamlessly: they are sampled with REPEAT and mipmaps,
 * so any seam would show up as a visible grid across the city.
 *
 * To move to authored art later, replace this function with image loading —
 * the renderer only needs `TextureLayer.length` canvases of equal size.
 */
export function createSurfaceTextures(): HTMLCanvasElement[] {
  const textures: HTMLCanvasElement[] = [];
  textures[TextureLayer.Road] = drawRoadway();
  textures[TextureLayer.Asphalt] = drawAsphalt();
  textures[TextureLayer.Sidewalk] = drawSidewalk();
  textures[TextureLayer.Cobble] = drawCobble();
  textures[TextureLayer.Brick] = drawBrickFacade();
  textures[TextureLayer.Plaster] = drawPlasterFacade();
  textures[TextureLayer.Roof] = drawRoof();
  return textures;
}

/**
 * A flat tangent-space normal, (0, 0, 1) encoded into RGB.
 *
 * Layers with no normal map of their own get this, so the whole array can be
 * sampled unconditionally and the shader needs no per-layer branch.
 */
export function createFlatNormalMap(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  ctx.fillStyle = 'rgb(128, 128, 255)';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  return canvas;
}

/** Window colours per facade layer: brick gets darker joinery than stucco. */
const FACADE_TRIM: Partial<Record<TextureLayer, { frame: string; sill: string }>> = {
  [TextureLayer.Brick]: { frame: '#2e2722', sill: '#6d675e' },
  [TextureLayer.Plaster]: { frame: '#494036', sill: '#8e887a' },
};

/**
 * Paints the procedural window over an existing facade tile, in place.
 *
 * Downloaded brick or stucco textures are plain walls, but the mesh maps one
 * tile to one storey and one window bay. Compositing the window on top keeps
 * that mapping meaningful, so a bare wall photo still reads as a facade.
 */
export function overlayFacadeWindow(canvas: HTMLCanvasElement, layer: TextureLayer): void {
  const trim = FACADE_TRIM[layer];
  if (!trim) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot overlay windows');

  drawWindow(ctx, createRng(layer + 1), trim.frame, trim.sill);
}

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot build textures');

  return { canvas, ctx };
}

/** Per-pixel monochrome grain. Cheap way to stop flat fills looking plastic. */
function addGrain(ctx: CanvasRenderingContext2D, rng: Rng, amount: number): void {
  const image = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const { data } = image;

  for (let i = 0; i < data.length; i += 4) {
    const delta = (rng.next() - 0.5) * amount;
    data[i] = clampByte((data[i] ?? 0) + delta);
    data[i + 1] = clampByte((data[i + 1] ?? 0) + delta);
    data[i + 2] = clampByte((data[i + 2] ?? 0) + delta);
  }

  ctx.putImageData(image, 0, 0);
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Draws a rect, repeating it across the wrap edges so the tile stays seamless. */
function fillWrapped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (const dx of [0, -TEXTURE_SIZE, TEXTURE_SIZE]) {
    for (const dy of [0, -TEXTURE_SIZE, TEXTURE_SIZE]) {
      if (x + dx > TEXTURE_SIZE || x + dx + w < 0) continue;
      if (y + dy > TEXTURE_SIZE || y + dy + h < 0) continue;
      ctx.fillRect(x + dx, y + dy, w, h);
    }
  }
}

function drawAsphalt(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(11);

  ctx.fillStyle = '#3b3b40';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Worn patches where the surface has been resealed.
  for (let i = 0; i < 26; i++) {
    const shade = Math.floor(rng.range(52, 78));
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},0.5)`;
    ctx.beginPath();
    ctx.ellipse(
      rng.range(0, TEXTURE_SIZE),
      rng.range(0, TEXTURE_SIZE),
      rng.range(8, 34),
      rng.range(6, 22),
      rng.range(0, Math.PI),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(24,24,28,0.6)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    let x = rng.range(0, TEXTURE_SIZE);
    let y = rng.range(0, TEXTURE_SIZE);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let segment = 0; segment < 5; segment++) {
      x += rng.range(-26, 26);
      y += rng.range(-26, 26);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  addGrain(ctx, rng, 26);
  return canvas;
}

/**
 * The carriageway: asphalt with painted markings.
 *
 * This layer is mapped across the width of a street rather than tiled freely,
 * so the tile is a road cross-section. The kerb lines sit on the tile seam,
 * which puts one on each side of the road once the texture is applied; the
 * dashed line runs down the middle.
 *
 * A downloaded road texture must follow the same layout to line up — see
 * `SURFACE_TEXTURES` in `city/assets.ts`.
 */
function drawRoadway(): HTMLCanvasElement {
  const canvas = drawAsphalt();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint road markings');

  const s = TEXTURE_SIZE;
  const line = s * 0.016;
  ctx.fillStyle = '#c4a02a';

  // One wrapped strip on the seam paints the kerb line on both edges.
  fillWrapped(ctx, -line / 2, 0, line, s);

  const dashes = 4;
  const period = s / dashes;
  for (let i = 0; i < dashes; i++) {
    ctx.fillRect(s / 2 - line / 2, i * period + period * 0.2, line, period * 0.6);
  }

  return canvas;
}

function drawSidewalk(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(22);
  const slab = TEXTURE_SIZE / 4;

  ctx.fillStyle = '#8d8a81';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const shade = Math.floor(rng.range(128, 152));
      ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 11})`;
      ctx.fillRect(i * slab + 1.5, j * slab + 1.5, slab - 3, slab - 3);
    }
  }

  // Joints, drawn as dark inset lines rather than strokes so they stay crisp.
  ctx.fillStyle = 'rgba(60,58,52,0.75)';
  for (let i = 0; i < 4; i++) {
    fillWrapped(ctx, i * slab - 1.5, 0, 3, TEXTURE_SIZE);
    fillWrapped(ctx, 0, i * slab - 1.5, TEXTURE_SIZE, 3);
  }

  addGrain(ctx, rng, 20);
  return canvas;
}

function drawCobble(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(33);
  const stone = TEXTURE_SIZE / 8;

  ctx.fillStyle = '#4a453e';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let j = 0; j < 8; j++) {
    // Alternate rows are offset half a stone, as real setts are laid.
    const offset = j % 2 === 0 ? 0 : stone / 2;

    for (let i = -1; i < 9; i++) {
      const x = i * stone + offset + rng.range(-1, 1);
      const y = j * stone + rng.range(-1, 1);
      const r = Math.floor(rng.range(96, 134));

      ctx.fillStyle = `rgb(${r},${r - 6},${r - 16})`;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, stone - 3, stone - 3, 4);
      ctx.fill();
    }
  }

  addGrain(ctx, rng, 24);
  return canvas;
}

/**
 * One facade tile covers a single storey and a single window bay, so tiling it
 * across a wall produces an aligned grid of windows.
 */
function drawWindow(ctx: CanvasRenderingContext2D, rng: Rng, frame: string, sill: string): void {
  const s = ctx.canvas.width;
  const x = s * 0.29;
  const y = s * 0.2;
  const w = s * 0.42;
  const h = s * 0.5;

  // Lintel above and sill below give the opening some apparent depth.
  ctx.fillStyle = sill;
  ctx.fillRect(x - 7, y - 10, w + 14, 10);
  ctx.fillRect(x - 9, y + h, w + 18, 9);

  ctx.fillStyle = frame;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);

  // Glass: dark at the top where it reflects the sky's shadowed side.
  const glass = ctx.createLinearGradient(x, y, x, y + h);
  glass.addColorStop(0, '#20262e');
  glass.addColorStop(0.55, '#39424d');
  glass.addColorStop(1, '#556070');
  ctx.fillStyle = glass;
  ctx.fillRect(x, y, w, h);

  // A few panes lit from inside break up the repetition.
  if (rng.chance(0.18)) {
    ctx.fillStyle = 'rgba(226,196,132,0.35)';
    ctx.fillRect(x, y, w, h);
  }

  ctx.fillStyle = frame;
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x, y + h * 0.45 - 2, w, 4);
}

function drawBrickFacade(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(44);
  const brickH = TEXTURE_SIZE / 8;
  const brickW = TEXTURE_SIZE / 4;

  ctx.fillStyle = '#4b3229';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let row = 0; row < 8; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;

    for (let col = -1; col < 5; col++) {
      const r = Math.floor(rng.range(118, 162));
      ctx.fillStyle = `rgb(${r},${Math.floor(r * 0.55)},${Math.floor(r * 0.44)})`;
      fillWrapped(ctx, col * brickW + offset + 1.5, row * brickH + 1.5, brickW - 3, brickH - 3);
    }
  }

  drawWindow(ctx, rng, '#2e2722', '#6d675e');
  addGrain(ctx, rng, 18);
  return canvas;
}

function drawPlasterFacade(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(55);

  ctx.fillStyle = '#b9b4a6';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Blotchy weathering across the stucco.
  for (let i = 0; i < 60; i++) {
    const shade = Math.floor(rng.range(160, 200));
    ctx.fillStyle = `rgba(${shade},${shade - 5},${shade - 18},0.25)`;
    ctx.beginPath();
    ctx.ellipse(
      rng.range(0, TEXTURE_SIZE),
      rng.range(0, TEXTURE_SIZE),
      rng.range(10, 40),
      rng.range(10, 40),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Storey band at the tile edge, so stacked tiles read as floor divisions.
  ctx.fillStyle = 'rgba(120,114,100,0.55)';
  fillWrapped(ctx, 0, -3, TEXTURE_SIZE, 6);

  drawWindow(ctx, rng, '#494036', '#8e887a');
  addGrain(ctx, rng, 14);
  return canvas;
}

function drawRoof(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(66);

  ctx.fillStyle = '#34323a';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let i = 0; i < 300; i++) {
    const shade = Math.floor(rng.range(44, 86));
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 5})`;
    ctx.fillRect(
      rng.range(0, TEXTURE_SIZE),
      rng.range(0, TEXTURE_SIZE),
      rng.range(2, 7),
      rng.range(2, 7),
    );
  }

  addGrain(ctx, rng, 30);
  return canvas;
}
