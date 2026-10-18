/**
 * Pomocné funkce pro načítání obrázků.
 *
 * Vše jde přes `createImageBitmap` místo `new Image()`: dekóduje mimo hlavní
 * vlákno a chyby HTTP hlásí jako zamítnutí (rejection), takže chybějící textura
 * je zachytitelná chyba místo tiše prázdného povrchu.
 */

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }

  // Vite dev server odpovídá na neznámé cesty kódem 200 a HTML stránkou, takže
  // překlep v názvu souboru sem dorazí jako úspěch. Bez této kontroly se chyba
  // projeví až mnohem později jako nejasná chyba dekódování.
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) {
    throw new Error(`Failed to load ${url}: expected an image, got "${type}"`);
  }

  return createImageBitmap(await response.blob());
}

function createCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');

  return ctx;
}

/**
 * Přeškáluje obrázek na canvas o rozměrech přesně `width` x `height`.
 *
 * Všechny vrstvy texture array musí mít stejnou velikost, takže příchozí grafika
 * se normalizuje zde, a ne v místě volání.
 */
export function rasterise(source: ImageBitmap, width: number, height = width): HTMLCanvasElement {
  const ctx = createCanvas(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.canvas;
}

/** Pixelová data v plném rozlišení pro převzorkování na CPU. */
export function readPixels(source: ImageBitmap): ImageData {
  const ctx = createCanvas(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height);
}

/** Bilineární vzorek `image` v normalizovaných (u, v), vodorovně opakovaný. */
export function sampleBilinear(
  image: ImageData,
  u: number,
  v: number,
  out: [number, number, number],
): void {
  const x = u * image.width - 0.5;
  const y = Math.min(Math.max(v * image.height - 0.5, 0), image.height - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  // Panoramata se v zeměpisné délce opakují, ale u pólů se ořezávají.
  const wrapX = (n: number): number => ((n % image.width) + image.width) % image.width;
  const clampY = (n: number): number => Math.min(Math.max(n, 0), image.height - 1);

  const x1 = wrapX(x0 + 1);
  const y1 = clampY(y0 + 1);
  const cx0 = wrapX(x0);
  const cy0 = clampY(y0);

  const { data } = image;
  for (let channel = 0; channel < 3; channel++) {
    const p00 = data[(cy0 * image.width + cx0) * 4 + channel] ?? 0;
    const p10 = data[(cy0 * image.width + x1) * 4 + channel] ?? 0;
    const p01 = data[(y1 * image.width + cx0) * 4 + channel] ?? 0;
    const p11 = data[(y1 * image.width + x1) * 4 + channel] ?? 0;

    const top = p00 + (p10 - p00) * fx;
    const bottom = p01 + (p11 - p01) * fx;
    out[channel] = top + (bottom - top) * fy;
  }
}
