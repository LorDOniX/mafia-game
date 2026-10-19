import { createRng, type Rng } from '@/core/rng';
import { TextureLayer } from './layout';

/**
 * Délka hrany každé vrstvy texture array povrchů.
 *
 * Všechny vrstvy se musí shodovat, takže stažená grafika se na tuto velikost
 * přeškáluje. Každá vrstva stojí size^2 * 4 bajtů plus další třetinu na mipmapy —
 * zhruba 21 MB při 2048 — v barevném i normalovém poli, za každou vestavěnou vrstvu
 * a každou vlastní fasádu. Při nedostatku paměti GPU snižte na 1024.
 */
export const TEXTURE_SIZE = 2048;

/**
 * Souřadnicový prostor, ve kterém se kreslí procedurální grafika.
 *
 * Šířky tahů, odsazení a velikosti skvrn níže jsou v těchto jednotkách a každé
 * plátno se z nich škáluje na TEXTURE_SIZE, takže vyšší rozlišení procedurální
 * textury zaostří, místo aby zmenšilo jejich detaily.
 */
const ART_SIZE = 1024;

/**
 * Všechny textury povrchů se kreslí procedurálně, takže projekt nepotřebuje žádné
 * binární assety. Každá se dlažduce bez švů: vzorkují se s REPEAT a mipmapami,
 * takže jakýkoli šev by se ukázal jako viditelná mřížka přes celé město.
 *
 * Pro pozdější přechod na ručně tvořenou grafiku nahraďte tuto funkci načítáním
 * obrázků — renderer potřebuje jen jedno plátno TEXTURE_SIZE na vrstvu.
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
  textures[TextureLayer.Grass] = drawGrass();
  return textures;
}

/**
 * Plochá normála v tangent space, (0, 0, 1) zakódovaná do RGB.
 *
 * Dostanou ji vrstvy bez vlastní normal mapy, takže celé pole lze vzorkovat
 * bezpodmínečně a shader nepotřebuje větvení podle vrstvy.
 */
export function createFlatNormalMap(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  ctx.fillStyle = 'rgb(128, 128, 255)';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);
  return canvas;
}

/** Černá vrstva: noční textura, která nesvítí vůbec. */
export function createUnlitTexture(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);
  return canvas;
}

/** Barvy oken podle vrstvy fasády: cihla má tmavší truhlářské prvky než omítka. */
const FACADE_TRIM: Partial<Record<TextureLayer, { frame: string; sill: string }>> = {
  [TextureLayer.Brick]: { frame: '#2e2722', sill: '#6d675e' },
  [TextureLayer.Plaster]: { frame: '#494036', sill: '#8e887a' },
};

/**
 * Namaluje procedurální okno přes existující dlaždici fasády, na místě.
 *
 * Stažené cihlové nebo omítkové textury jsou holé zdi, ale mesh mapuje jednu
 * dlaždici na jedno podlaží a jednu okenní osu. Složení okna navrch udrží toto
 * mapování smysluplné, takže i fotka holé zdi působí jako fasáda.
 */
export function overlayFacadeWindow(canvas: HTMLCanvasElement, layer: TextureLayer): void {
  const trim = FACADE_TRIM[layer];
  if (!trim) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot overlay windows');

  // Načtená plátna nemají žádnou transformaci, takže jednotky grafiky na ně mapujeme tady.
  ctx.save();
  ctx.scale(canvas.width / ART_SIZE, canvas.height / ART_SIZE);
  drawWindow(ctx, createRng(layer + 1), trim.frame, trim.sill);
  ctx.restore();
}

/**
 * Opakuje dlaždici fasády s jednou osou přes mřížku `bays` x `storeys`.
 *
 * Vrstva vlastní fasády se mapuje jako celá víceosová stěna, takže když se její
 * obrázek nepodaří načíst, náhrada musí být rozvržená stejně, jinak by se jedno
 * okno roztáhlo přes několik os.
 */
export function repeatFacadeTile(
  tile: HTMLCanvasElement,
  bays: number,
  storeys: number,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const w = ART_SIZE / bays;
  const h = ART_SIZE / storeys;

  for (let row = 0; row < storeys; row++) {
    for (let col = 0; col < bays; col++) {
      ctx.drawImage(tile, col * w, row * h, w, h);
    }
  }

  return canvas;
}

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot build textures');

  ctx.scale(TEXTURE_SIZE / ART_SIZE, TEXTURE_SIZE / ART_SIZE);
  return { canvas, ctx };
}

/**
 * Jednobarevné zrno, jedna tečka na jednotku grafiky. Levný způsob, jak zabránit
 * plastovému vzhledu plochých výplní.
 *
 * Přístup k pixelům ignoruje transformaci plátna, takže zrno se rozvádí v jednotkách
 * grafiky ručně. Velikost tečky i sekvence RNG, která ji řídí, tak zůstávají
 * nezávislé na TEXTURE_SIZE.
 */
function addGrain(ctx: CanvasRenderingContext2D, rng: Rng, amount: number): void {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;

  const grain = new Float32Array(ART_SIZE * ART_SIZE);
  for (let i = 0; i < grain.length; i++) grain[i] = (rng.next() - 0.5) * amount;

  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * ART_SIZE) / height) * ART_SIZE;

    for (let x = 0; x < width; x++) {
      const delta = grain[row + Math.floor((x * ART_SIZE) / width)] ?? 0;
      const i = (y * width + x) * 4;
      data[i] = clampByte((data[i] ?? 0) + delta);
      data[i + 1] = clampByte((data[i + 1] ?? 0) + delta);
      data[i + 2] = clampByte((data[i + 2] ?? 0) + delta);
    }
  }

  ctx.putImageData(image, 0, 0);
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Nakreslí obdélník a zopakuje ho přes okraje, aby dlaždice zůstala bez švů. */
function fillWrapped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (const dx of [0, -ART_SIZE, ART_SIZE]) {
    for (const dy of [0, -ART_SIZE, ART_SIZE]) {
      if (x + dx > ART_SIZE || x + dx + w < 0) continue;
      if (y + dy > ART_SIZE || y + dy + h < 0) continue;
      ctx.fillRect(x + dx, y + dy, w, h);
    }
  }
}

function drawGrass(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(44);

  ctx.fillStyle = '#4c6a32';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  // Kreslí se s každým posunem přes okraj, takže skvrny přes hranu zůstávají bez švů.
  const wrapped = (draw: (dx: number, dy: number) => void): void => {
    for (const dx of [0, -ART_SIZE, ART_SIZE]) {
      for (const dy of [0, -ART_SIZE, ART_SIZE]) draw(dx, dy);
    }
  };

  // Flekovitý trávník: sušší a bujnější místa.
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, ART_SIZE);
    const y = rng.range(0, ART_SIZE);
    const rx = rng.range(30, 110);
    const ry = rng.range(20, 80);
    const angle = rng.range(0, Math.PI);
    const dry = rng.chance(0.4);
    ctx.fillStyle = dry ? 'rgba(122,128,62,0.22)' : 'rgba(38,78,30,0.25)';
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rx, ry, angle, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Stébla, krátké tahy ve světlých a tmavých odstínech zelené.
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(0, ART_SIZE);
    const y = rng.range(0, ART_SIZE);
    const length = rng.range(4, 10);
    const lean = rng.range(-0.5, 0.5);
    const g = Math.floor(rng.range(80, 140));
    ctx.strokeStyle = `rgba(${Math.floor(g * 0.55)},${g},${Math.floor(g * 0.4)},0.55)`;
    wrapped((dx, dy) => {
      if (x + dx < -12 || x + dx > ART_SIZE + 12 || y + dy < -12 || y + dy > ART_SIZE + 12) return;
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + lean * length, y + dy - length);
      ctx.stroke();
    });
  }

  addGrain(ctx, rng, 18);
  return canvas;
}

function drawAsphalt(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(11);

  ctx.fillStyle = '#3b3b40';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  // Opotřebené záplaty, kde byl povrch znovu utěsněn.
  for (let i = 0; i < 26; i++) {
    const shade = Math.floor(rng.range(52, 78));
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},0.5)`;
    ctx.beginPath();
    ctx.ellipse(
      rng.range(0, ART_SIZE),
      rng.range(0, ART_SIZE),
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
    let x = rng.range(0, ART_SIZE);
    let y = rng.range(0, ART_SIZE);
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
 * Vozovka: asfalt s namalovaným značením.
 *
 * Tato vrstva se mapuje přes šířku ulice, nikoli volně dlaždicově, takže dlaždice
 * je příčný řez silnicí. Okrajové čáry leží na švu dlaždice, čímž po aplikaci
 * textury vyjde jedna na každou stranu silnice; přerušovaná čára vede středem.
 *
 * Stažená textura silnice musí mít stejné rozvržení, aby lícovala — viz
 * `SURFACE_TEXTURES` v `city/assets.ts`.
 */
function drawRoadway(): HTMLCanvasElement {
  const canvas = drawAsphalt();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint road markings');

  const s = ART_SIZE;
  const line = s * 0.016;
  ctx.fillStyle = '#c4a02a';

  // Jeden přeložený pruh na švu namaluje okrajovou čáru na obou hranách.
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
  const slab = ART_SIZE / 4;

  ctx.fillStyle = '#8d8a81';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const shade = Math.floor(rng.range(128, 152));
      ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 11})`;
      ctx.fillRect(i * slab + 1.5, j * slab + 1.5, slab - 3, slab - 3);
    }
  }

  // Spáry, kreslené jako tmavé vnořené čáry místo tahů, aby zůstaly ostré.
  ctx.fillStyle = 'rgba(60,58,52,0.75)';
  for (let i = 0; i < 4; i++) {
    fillWrapped(ctx, i * slab - 1.5, 0, 3, ART_SIZE);
    fillWrapped(ctx, 0, i * slab - 1.5, ART_SIZE, 3);
  }

  addGrain(ctx, rng, 20);
  return canvas;
}

function drawCobble(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(33);
  const stone = ART_SIZE / 8;

  ctx.fillStyle = '#4a453e';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  for (let j = 0; j < 8; j++) {
    // Každá druhá řada je posunutá o půl kamene, jak se kládá skutečná dlažba.
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
 * Jedna dlaždice fasády pokrývá jedno podlaží a jednu okenní osu, takže její
 * opakování po stěně vytvoří zarovnanou mřížku oken.
 */
function drawWindow(ctx: CanvasRenderingContext2D, rng: Rng, frame: string, sill: string): void {
  const s = ART_SIZE;
  const x = s * 0.29;
  const y = s * 0.2;
  const w = s * 0.42;
  const h = s * 0.5;

  // Překlad nahoře a parapet dole dodávají otvoru zdánlivou hloubku.
  ctx.fillStyle = sill;
  ctx.fillRect(x - 7, y - 10, w + 14, 10);
  ctx.fillRect(x - 9, y + h, w + 18, 9);

  ctx.fillStyle = frame;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);

  // Sklo: nahoře tmavé, kde odráží zastíněnou stranu oblohy.
  const glass = ctx.createLinearGradient(x, y, x, y + h);
  glass.addColorStop(0, '#20262e');
  glass.addColorStop(0.55, '#39424d');
  glass.addColorStop(1, '#556070');
  ctx.fillStyle = glass;
  ctx.fillRect(x, y, w, h);

  // Několik tabulí osvětlených zevnitř naráží opakování.
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
  const brickH = ART_SIZE / 8;
  const brickW = ART_SIZE / 4;

  ctx.fillStyle = '#4b3229';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

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
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  // Skvrnité zvětrání po celé omítce.
  for (let i = 0; i < 60; i++) {
    const shade = Math.floor(rng.range(160, 200));
    ctx.fillStyle = `rgba(${shade},${shade - 5},${shade - 18},0.25)`;
    ctx.beginPath();
    ctx.ellipse(
      rng.range(0, ART_SIZE),
      rng.range(0, ART_SIZE),
      rng.range(10, 40),
      rng.range(10, 40),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Kordonová římsa na okraji dlaždice, aby naskládané dlaždice působily jako dělení podlaží.
  ctx.fillStyle = 'rgba(120,114,100,0.55)';
  fillWrapped(ctx, 0, -3, ART_SIZE, 6);

  drawWindow(ctx, rng, '#494036', '#8e887a');
  addGrain(ctx, rng, 14);
  return canvas;
}

function drawRoof(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas();
  const rng = createRng(66);

  ctx.fillStyle = '#34323a';
  ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);

  for (let i = 0; i < 300; i++) {
    const shade = Math.floor(rng.range(44, 86));
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 5})`;
    ctx.fillRect(rng.range(0, ART_SIZE), rng.range(0, ART_SIZE), rng.range(2, 7), rng.range(2, 7));
  }

  addGrain(ctx, rng, 30);
  return canvas;
}
