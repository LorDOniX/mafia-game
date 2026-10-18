import { daylightAt } from '@/game/clock';

/** Colours round the ring, by hour: night blue, pale dawn, gold noon, pale dusk, night again. */
const RING_STOPS: ReadonlyArray<[number, string]> = [
  [0, '#0f1c45'],
  [4.5, '#16285c'],
  [6, '#7f9cc4'],
  [7.5, '#e4ecf3'],
  [10, '#f3d58a'],
  [12, '#f0b231'],
  [14, '#f3d58a'],
  [16.5, '#e4ecf3'],
  [18, '#7f9cc4'],
  [19.5, '#16285c'],
  [24, '#0f1c45'],
];
const GOLD = '#c9993a';
const GOLD_LIGHT = '#f2d27a';
const SERIF = "Georgia, 'Times New Roman', serif";

/**
 * A 24-hour dial: the ring of hours turns so the current time sits under the
 * pointer at the top, sun at noon and moon at midnight, with the time written
 * in the middle.
 */
export class ClockDial {
  private readonly ctx: CanvasRenderingContext2D;
  private ring: HTMLCanvasElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unsupported');
    this.ctx = ctx;
  }

  draw(hour: number, time: string, day: number): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size || !this.ring) {
      canvas.width = size;
      canvas.height = size;
      this.ring = drawRing(size);
    }

    const c = size / 2;
    const r = c * 0.94;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-(hour / 24) * Math.PI * 2);
    ctx.drawImage(this.ring, -c, -c);
    ctx.restore();

    // Dark wooden centre with the time on it.
    const wood = ctx.createRadialGradient(c, c - r * 0.2, r * 0.05, c, c, r * 0.62);
    wood.addColorStop(0, '#6a4528');
    wood.addColorStop(1, '#2e1c10');
    disc(ctx, c, c, r * 0.62, wood);
    ring(ctx, c, c, r * 0.62, GOLD, r * 0.02);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6e7c4';
    ctx.font = `bold ${r * 0.3}px ${SERIF}`;
    ctx.fillText(time, c, c - r * 0.04);
    ctx.fillStyle = '#d8c39a';
    ctx.font = `${r * 0.12}px ${SERIF}`;
    ctx.fillText(`Day ${day}`, c, c + r * 0.27);

    // Pointer at the top, over the hour now.
    ctx.fillStyle = GOLD_LIGHT;
    ctx.strokeStyle = '#7a5a1c';
    ctx.lineWidth = r * 0.015;
    ctx.beginPath();
    ctx.moveTo(c, c - r * 0.9);
    ctx.lineTo(c - r * 0.07, c - r * 1.04);
    ctx.lineTo(c + r * 0.07, c - r * 1.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** The turning part: coloured ring, hours, sun, moon and stars, with midnight at the top. */
function drawRing(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unsupported');

  const c = size / 2;
  const r = c * 0.94;
  const mid = r * 0.835;
  const at = (hour: number, radius: number): { x: number; y: number; a: number } => {
    const a = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    return { x: c + Math.cos(a) * radius, y: c + Math.sin(a) * radius, a };
  };

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = r * 0.08;
  disc(ctx, c, c, r, GOLD);
  ctx.restore();

  const band = ctx.createConicGradient(-Math.PI / 2, c, c);
  for (const [hour, color] of RING_STOPS) band.addColorStop(hour / 24, color);
  disc(ctx, c, c, r * 0.97, band);

  // Sun at noon.
  const sun = at(12, mid);
  const halo = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, r * 0.28);
  halo.addColorStop(0, 'rgba(255, 214, 90, 0.95)');
  halo.addColorStop(1, 'rgba(255, 190, 60, 0)');
  disc(ctx, sun.x, sun.y, r * 0.28, halo);
  ctx.strokeStyle = '#e39a1c';
  ctx.lineWidth = r * 0.012;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const inner = r * 0.08;
    const outer = r * (k % 2 === 0 ? 0.15 : 0.12);
    ctx.beginPath();
    ctx.moveTo(sun.x + Math.cos(a) * inner, sun.y + Math.sin(a) * inner);
    ctx.lineTo(sun.x + Math.cos(a) * outer, sun.y + Math.sin(a) * outer);
    ctx.stroke();
  }
  disc(ctx, sun.x, sun.y, r * 0.075, '#f7b52c');

  // Moon at midnight.
  const moon = at(0, mid);
  disc(ctx, moon.x, moon.y, r * 0.1, '#e9ebef');
  disc(ctx, moon.x - r * 0.03, moon.y - r * 0.02, r * 0.022, '#c3c7cf');
  disc(ctx, moon.x + r * 0.035, moon.y + r * 0.03, r * 0.016, '#c3c7cf');
  ring(ctx, moon.x, moon.y, r * 0.1, '#9aa0aa', r * 0.01);

  // Stars on the half hours of the night, where the numbers leave room.
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let half = 19.5; half < 29; half += 1) {
    const hour = half % 24;
    if (Math.abs(hour - 0) < 1 || Math.abs(hour - 24) < 1) continue;
    const p = at(hour, mid + (random() - 0.5) * r * 0.12);
    star(ctx, p.x, p.y, r * (0.025 + random() * 0.02));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${r * 0.105}px ${SERIF}`;
  for (let hour = 1; hour <= 24; hour++) {
    if (hour === 12 || hour === 24) continue;
    const p = at(hour, mid);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a + Math.PI / 2);
    ctx.fillStyle = daylightAt(hour).daylight > 0.5 ? '#2b1d0e' : '#f4f1e8';
    ctx.fillText(String(hour), 0, 0);
    ctx.restore();
  }

  // Dark band of quarter-hour ticks between the ring and the centre.
  disc(ctx, c, c, r * 0.71, '#17120c');
  ctx.strokeStyle = GOLD;
  for (let q = 0; q < 96; q++) {
    const a = (q / 96) * Math.PI * 2;
    ctx.lineWidth = r * (q % 4 === 0 ? 0.012 : 0.006);
    const inner = r * (q % 4 === 0 ? 0.64 : 0.665);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * r * 0.7, c + Math.sin(a) * r * 0.7);
    ctx.stroke();
  }
  ring(ctx, c, c, r * 0.97, GOLD_LIGHT, r * 0.02);
  ring(ctx, c, c, r * 0.71, GOLD, r * 0.015);
  return canvas;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = '#f5d77a';
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const reach = k % 2 === 0 ? size : size * 0.35;
    const px = x + Math.cos(a) * reach;
    const py = y + Math.sin(a) * reach;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
