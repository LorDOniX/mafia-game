/** Maximum stupnice, km/h. */
const SPEED_MAX = 240;
const SPEED_LABEL_STEP = 15;
/** Maximum otáčkoměru, rpm. */
const RPM_MAX = 8000;
const IDLE_RPM = 800;
const REDLINE_RPM = 6500;
/** Maximální rychlost každého převodu vpřed, km/h; poslední vede až na konec stupnice. */
const GEAR_TOPS = [25, 45, 65, 90, SPEED_MAX];
const REVERSE_TOP = 26;

/** Rozsah ručičky: zleva dole, po směru hodinových ručiček přes vrchol, doprava dolů. */
const START_ANGLE = (135 * Math.PI) / 180;
const SWEEP = (270 * Math.PI) / 180;

const NAVY = '#1b2b55';
const NAVY_DARK = '#0e1734';
const NEEDLE = '#d4322a';

export interface DashState {
  /** Se znaménkem: záporná znamená couvání. */
  speedKmh: number;
  odometerKm: number;
}

/**
 * Předstíraná převodovka, protože model auta žádnou nemá: řadí nahoru podle
 * GEAR_TOPS a otáčky odvozuje z toho, kde v aktuálním převodu rychlost leží.
 */
export function engine(speedKmh: number): { gear: string; rpm: number } {
  const speed = Math.abs(speedKmh);
  if (speed < 0.5) return { gear: 'N', rpm: IDLE_RPM };
  if (speedKmh < 0) {
    return {
      gear: 'R',
      rpm: IDLE_RPM + (REDLINE_RPM - IDLE_RPM) * Math.min(speed / REVERSE_TOP, 1),
    };
  }

  let bottom = 0;
  for (let i = 0; i < GEAR_TOPS.length; i++) {
    const top = GEAR_TOPS[i] ?? SPEED_MAX;
    if (speed <= top || i === GEAR_TOPS.length - 1) {
      // Každé přeřazení nahoru srazí otáčky zpět na třetinu pásma.
      const floor = i === 0 ? IDLE_RPM : IDLE_RPM + (REDLINE_RPM - IDLE_RPM) / 3;
      const t = Math.min((speed - bottom) / (top - bottom), 1);
      return { gear: String(i + 1), rpm: floor + (REDLINE_RPM - floor) * t };
    }
    bottom = top;
  }
  return { gear: String(GEAR_TOPS.length), rpm: REDLINE_RPM };
}

/**
 * Tachometr ve stylu 30. let s chromovaným rámečkem a malým otáčkoměrem vedle,
 * kreslený na jeden canvas. Ciferníky se kreslí jednou pro každou velikost; každý
 * snímek se mění jen ručičky, převod a počítadlo kilometrů.
 */
export class Speedometer {
  private readonly ctx: CanvasRenderingContext2D;
  private face: HTMLCanvasElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unsupported');
    this.ctx = ctx;
  }

  draw(state: DashState): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height || !this.face) {
      canvas.width = width;
      canvas.height = height;
      this.face = drawFaces(width, height);
    }

    const { speed, rev } = layoutOf(width, height);
    const { gear, rpm } = engine(state.speedKmh);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.face, 0, 0);

    drawGear(ctx, speed, gear);
    drawOdometer(ctx, speed, state.odometerKm);
    drawNeedle(ctx, speed, Math.min(Math.abs(state.speedKmh) / SPEED_MAX, 1), 0.78);
    drawNeedle(ctx, rev, Math.min(rpm / RPM_MAX, 1), 0.72);
  }
}

interface Dial {
  x: number;
  y: number;
  r: number;
}

/** Velký ciferník vpravo dole na canvasu, malý zastrčený u jeho levé dolní strany. */
function layoutOf(width: number, height: number): { speed: Dial; rev: Dial } {
  const r = Math.min(width * 0.36, height * 0.48);
  const speed = { x: width - r - 2, y: height - r - 2, r };
  const rev = { x: speed.x - r * 1.05, y: height - r * 0.42 - 2, r: r * 0.42 };
  return { speed, rev };
}

function drawFaces(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unsupported');

  const { speed, rev } = layoutOf(width, height);
  drawSpeedFace(ctx, speed);
  drawRevFace(ctx, rev);
  return canvas;
}

function drawSpeedFace(ctx: CanvasRenderingContext2D, { x, y, r }: Dial): void {
  bezel(ctx, x, y, r);

  // Námořnicky modrý prstenec s čísly, uvnitř něj bílý ciferník.
  const ring = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 0.92);
  ring.addColorStop(0, NAVY);
  ring.addColorStop(1, NAVY_DARK);
  disc(ctx, x, y, r * 0.92, ring);

  const face = ctx.createRadialGradient(x, y - r * 0.2, r * 0.05, x, y, r * 0.64);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(1, '#d9dde4');
  disc(ctx, x, y, r * 0.64, face);

  ctx.strokeStyle = '#e9edf5';
  for (let kmh = 0; kmh <= SPEED_MAX; kmh += 5) {
    const major = kmh % SPEED_LABEL_STEP === 0;
    const a = angleAt(kmh / SPEED_MAX);
    ctx.lineWidth = r * (major ? 0.018 : 0.009);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64);
    ctx.lineTo(
      x + Math.cos(a) * r * (major ? 0.71 : 0.68),
      y + Math.sin(a) * r * (major ? 0.71 : 0.68),
    );
    ctx.stroke();
  }

  ctx.fillStyle = '#f4f6fb';
  ctx.font = `bold ${r * 0.1}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let kmh = SPEED_LABEL_STEP; kmh <= SPEED_MAX; kmh += SPEED_LABEL_STEP) {
    const a = angleAt(kmh / SPEED_MAX);
    ctx.fillText(String(kmh), x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
  }

  ctx.fillStyle = '#1d2433';
  ctx.font = `${r * 0.1}px Georgia, 'Times New Roman', serif`;
  ctx.fillText('km/h', x, y - r * 0.36);
}

function drawRevFace(ctx: CanvasRenderingContext2D, { x, y, r }: Dial): void {
  bezel(ctx, x, y, r);
  const face = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r * 0.9);
  face.addColorStop(0, '#2a3d72');
  face.addColorStop(1, NAVY_DARK);
  disc(ctx, x, y, r * 0.88, face);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= RPM_MAX / 1000; k++) {
    const a = angleAt((k * 1000) / RPM_MAX);
    const red = k * 1000 >= REDLINE_RPM;
    ctx.strokeStyle = red ? NEEDLE : '#e9edf5';
    ctx.lineWidth = r * 0.04;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72);
    ctx.lineTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86);
    ctx.stroke();

    ctx.fillStyle = red ? '#ff6a5e' : '#f4f6fb';
    ctx.font = `bold ${r * 0.2}px Georgia, 'Times New Roman', serif`;
    ctx.fillText(String(k), x + Math.cos(a) * r * 0.54, y + Math.sin(a) * r * 0.54);
  }

  ctx.fillStyle = '#c9d2e6';
  ctx.font = `${r * 0.15}px Georgia, 'Times New Roman', serif`;
  ctx.fillText('RPM', x, y - r * 0.22);
  ctx.font = `${r * 0.12}px Georgia, 'Times New Roman', serif`;
  ctx.fillText('x1000', x, y + r * 0.42);
}

/** Leštěný chromový rámeček. */
function bezel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = r * 0.12;
  ctx.shadowOffsetY = r * 0.03;
  const chrome = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  chrome.addColorStop(0, '#fbfbf8');
  chrome.addColorStop(0.35, '#9ea3ab');
  chrome.addColorStop(0.55, '#f2f2ee');
  chrome.addColorStop(1, '#6d727a');
  disc(ctx, x, y, r, chrome);
  ctx.restore();
}

function drawGear(ctx: CanvasRenderingContext2D, { x, y, r }: Dial, gear: string): void {
  const w = r * 0.17;
  const h = r * 0.17;
  const top = y - r * 0.25;
  ctx.fillStyle = '#20314f';
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.strokeStyle = '#8b97ad';
  ctx.lineWidth = r * 0.012;
  ctx.strokeRect(x - w / 2, top, w, h);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = `bold ${r * 0.13}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(gear, x, top + h / 2 + r * 0.005);
}

/** Válečkové počítadlo kilometrů: celé kilometry, pak desetiny na červeném válečku. */
function drawOdometer(ctx: CanvasRenderingContext2D, { x, y, r }: Dial, km: number): void {
  const digits = 5;
  const cell = r * 0.085;
  const h = r * 0.12;
  const left = x - (cell * (digits + 1)) / 2;
  const top = y + r * 0.18;

  const tenths = Math.floor(km * 10) % 10;
  const whole = String(Math.floor(km) % 10 ** digits).padStart(digits, '0');

  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(left - r * 0.01, top - r * 0.01, cell * (digits + 1) + r * 0.02, h + r * 0.02);
  ctx.font = `bold ${r * 0.095}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= digits; i++) {
    const red = i === digits;
    ctx.fillStyle = red ? '#b3261e' : '#1b1e25';
    ctx.fillRect(left + i * cell + r * 0.004, top, cell - r * 0.008, h);
    ctx.fillStyle = '#f2efe6';
    ctx.fillText(red ? String(tenths) : (whole[i] ?? '0'), left + i * cell + cell / 2, top + h / 2);
  }
}

function drawNeedle(
  ctx: CanvasRenderingContext2D,
  { x, y, r }: Dial,
  t: number,
  length: number,
): void {
  const a = angleAt(t);
  const tip = { x: x + Math.cos(a) * r * length, y: y + Math.sin(a) * r * length };
  const tail = { x: x - Math.cos(a) * r * 0.14, y: y - Math.sin(a) * r * 0.14 };
  const side = { x: -Math.sin(a) * r * 0.025, y: Math.cos(a) * r * 0.025 };

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = r * 0.03;
  ctx.shadowOffsetY = r * 0.015;
  ctx.fillStyle = NEEDLE;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(x + side.x, y + side.y);
  ctx.lineTo(tail.x, tail.y);
  ctx.lineTo(x - side.x, y - side.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const hub = ctx.createRadialGradient(x - r * 0.02, y - r * 0.02, 0, x, y, r * 0.07);
  hub.addColorStop(0, '#ff8f84');
  hub.addColorStop(1, '#8e1a14');
  disc(ctx, x, y, r * 0.07, hub);
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

const angleAt = (t: number): number => START_ANGLE + SWEEP * t;
