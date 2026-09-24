import { normalize, type Vec3 } from '@/math/vec3';
import { sampleBilinear } from '@/gfx/image';

export const SKY_FACE_SIZE = 256;

/** Late-afternoon sun. Shared with the renderer so shading matches the sky. */
export const SUN_DIRECTION: Vec3 = normalize({ x: 0.38, y: 0.42, z: -0.82 });

/** The haze colour at eye level; the city's fog fades to this exact value. */
export const HORIZON_COLOR: [number, number, number] = [0.74, 0.76, 0.75];

const ZENITH_COLOR: [number, number, number] = [0.21, 0.38, 0.66];
const GROUND_COLOR: [number, number, number] = [0.3, 0.29, 0.27];

/**
 * Cube map faces in the order WebGL expects: +X, -X, +Y, -Y, +Z, -Z.
 *
 * Each texel is converted back to a direction and shaded analytically, which
 * keeps the sky consistent with `SUN_DIRECTION` without needing any artwork.
 */
export function createSkyFaces(size = SKY_FACE_SIZE): ImageData[] {
  return [0, 1, 2, 3, 4, 5].map((face) => renderFace(face, size));
}

/**
 * Direction to equirectangular (longitude, latitude) in normalised UV.
 *
 * u wraps at the -Z meridian, matching the convention panorama HDRIs use, so
 * a sky loaded this way lines up with the same world axes as the procedural one.
 */
export function directionToEquirectUV(dir: Vec3): { u: number; v: number } {
  return {
    u: Math.atan2(dir.x, -dir.z) / (Math.PI * 2) + 0.5,
    v: Math.acos(Math.min(Math.max(dir.y, -1), 1)) / Math.PI,
  };
}

/**
 * Resamples an equirectangular panorama into six cube faces.
 *
 * Sky HDRIs are distributed as panoramas rather than cube maps, so this is the
 * conversion step between what you can download and what WebGL can sample.
 */
export function panoramaToSkyFaces(panorama: ImageData, size = SKY_FACE_SIZE): ImageData[] {
  const rgb: [number, number, number] = [0, 0, 0];

  return [0, 1, 2, 3, 4, 5].map((face) => {
    const image = new ImageData(size, size);
    const { data } = image;

    for (let py = 0; py < size; py++) {
      const v = (2 * (py + 0.5)) / size - 1;

      for (let px = 0; px < size; px++) {
        const u = (2 * (px + 0.5)) / size - 1;
        const { u: su, v: sv } = directionToEquirectUV(normalize(faceDirection(face, u, v)));
        sampleBilinear(panorama, su, sv, rgb);

        const i = (py * size + px) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255;
      }
    }

    return image;
  });
}

function renderFace(face: number, size: number): ImageData {
  const image = new ImageData(size, size);
  const { data } = image;

  for (let py = 0; py < size; py++) {
    const v = (2 * (py + 0.5)) / size - 1;

    for (let px = 0; px < size; px++) {
      const u = (2 * (px + 0.5)) / size - 1;
      const dir = normalize(faceDirection(face, u, v));
      const [r, g, b] = shadeSky(dir);

      const i = (py * size + px) * 4;
      data[i] = Math.round(Math.min(r, 1) * 255);
      data[i + 1] = Math.round(Math.min(g, 1) * 255);
      data[i + 2] = Math.round(Math.min(b, 1) * 255);
      data[i + 3] = 255;
    }
  }

  return image;
}

/**
 * Maps a texel on cube face `face` to the direction it represents.
 *
 * Face order and axis conventions follow GL_TEXTURE_CUBE_MAP_POSITIVE_X..
 * NEGATIVE_Z, including the flipped vertical axis.
 */
export function faceDirection(face: number, u: number, v: number): Vec3 {
  switch (face) {
    case 0:
      return { x: 1, y: -v, z: -u };
    case 1:
      return { x: -1, y: -v, z: u };
    case 2:
      return { x: u, y: 1, z: v };
    case 3:
      return { x: u, y: -1, z: -v };
    case 4:
      return { x: u, y: -v, z: 1 };
    default:
      return { x: -u, y: -v, z: -1 };
  }
}

function shadeSky(dir: Vec3): [number, number, number] {
  // Above the horizon: haze near eye level easing up into deep blue.
  const up = Math.max(dir.y, 0);
  const gradient = Math.pow(up, 0.45);

  let r = lerp(HORIZON_COLOR[0], ZENITH_COLOR[0], gradient);
  let g = lerp(HORIZON_COLOR[1], ZENITH_COLOR[1], gradient);
  let b = lerp(HORIZON_COLOR[2], ZENITH_COLOR[2], gradient);

  if (dir.y < 0) {
    // Below the horizon the city covers almost everything; a dull haze is
    // enough, and it keeps gaps between buildings from flashing bright.
    const down = Math.min(-dir.y / 0.25, 1);
    r = lerp(HORIZON_COLOR[0], GROUND_COLOR[0], down);
    g = lerp(HORIZON_COLOR[1], GROUND_COLOR[1], down);
    b = lerp(HORIZON_COLOR[2], GROUND_COLOR[2], down);
    return [r, g, b];
  }

  // Clouds: sample noise on a plane above the viewer, projected along the view
  // ray, and fade them out toward the horizon where the plane goes singular.
  if (dir.y > 0.02) {
    const scale = 1.6;
    const px = (dir.x / dir.y) * scale;
    const pz = (dir.z / dir.y) * scale;
    const density = fbm(px, pz);
    const coverage = smoothstep(0.5, 0.82, density) * smoothstep(0.02, 0.3, dir.y);

    r = lerp(r, 0.98, coverage * 0.85);
    g = lerp(g, 0.97, coverage * 0.85);
    b = lerp(b, 0.96, coverage * 0.85);
  }

  const cosSun = dir.x * SUN_DIRECTION.x + dir.y * SUN_DIRECTION.y + dir.z * SUN_DIRECTION.z;
  if (cosSun > 0) {
    const glow = Math.pow(cosSun, 64) * 0.5 + Math.pow(cosSun, 6) * 0.12;
    const disc = cosSun > 0.9996 ? 1 : 0;

    r = Math.min(r + glow * 1.0 + disc, 1);
    g = Math.min(g + glow * 0.92 + disc, 1);
    b = Math.min(b + glow * 0.72 + disc, 1);
  }

  return [r, g, b];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic 2D hash in [0, 1). */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x: number, y: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;

  for (let octave = 0; octave < 5; octave++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.07;
    amplitude *= 0.5;
  }

  return value;
}
