import { TextureLayer } from './layout';
import {
  createFlatNormalMap,
  createSurfaceTextures,
  overlayFacadeWindow,
  TEXTURE_SIZE,
} from './textures';
import {
  createSkyFaces,
  HORIZON_COLOR,
  panoramaToSkyFaces,
  SKY_FACE_SIZE,
  SUN_DIRECTION,
} from './sky';
import { loadImageBitmap, rasterise, readPixels } from '@/gfx/image';
import { normalize, type Vec3 } from '@/math/vec3';

/**
 * Where the city gets its art.
 *
 * This is the only file you need to touch to swap procedural textures for
 * downloaded PNGs. Put the files in `public/`, which Vite serves verbatim, and
 * reference them by absolute path — `public/textures/brick.png` is
 * `/textures/brick.png` at runtime. Do not import them from `src/`: that route
 * hashes the filename, which is pointless for art you address by name.
 *
 * Any layer left out falls back to its procedural texture, and a URL that fails
 * to load warns and falls back too, so a typo degrades instead of breaking.
 */
export const SURFACE_TEXTURES: Partial<Record<TextureLayer, string>> = {
  // ambientCG "Road008B" (CC0). This layer is mapped across the width of a
  // street, so its texture must be a road cross-section: kerb lines on the two
  // vertical edges, centre line down the middle. A plain asphalt swatch here
  // would work but would leave the city unmarked.
  [TextureLayer.Road]: '/textures/road/Road008B_1K-JPG_Color.jpg',
  // Freely tiled, so this one wants a seamless swatch with nothing painted on
  // it. Only the outskirts and the map-edge streets show it.
  // [TextureLayer.Asphalt]: '/textures/asphalt.png',
  // [TextureLayer.Sidewalk]: '/textures/pavement.png',
  // [TextureLayer.Cobble]: '/textures/cobblestone.png',
  // [TextureLayer.Brick]: '/textures/brick.png',
  // [TextureLayer.Plaster]: '/textures/plaster.png',
  // [TextureLayer.Roof]: '/textures/roof.png',
};

/**
 * Tangent-space normal maps, keyed the same way as `SURFACE_TEXTURES`.
 *
 * Use the **OpenGL** convention, where green points up (+Y). Packs that ship
 * both variants label them `NormalGL` and `NormalDX`; the DirectX one has its
 * green channel inverted and would light every bump from the wrong side.
 *
 * Layers with no entry get a flat normal and shade exactly as before.
 */
export const SURFACE_NORMAL_MAPS: Partial<Record<TextureLayer, string>> = {
  [TextureLayer.Road]: '/textures/road/Road008B_1K-JPG_NormalGL.jpg',
};

/**
 * Global multiplier on normal-map strength. 1 is the map as authored, 0 falls
 * back to flat geometric normals. Asphalt maps tend to be aggressive, and the
 * roadway is viewed at grazing angles where strong normals read as noise.
 */
export const NORMAL_STRENGTH = 0.6;

/**
 * Whether to paint the procedural window over loaded facade textures.
 *
 * Leave this on unless your facade art already contains windows: the mesh maps
 * one tile to one storey and one window bay, so a plain wall photo would
 * otherwise tile into a blank cliff.
 */
export const OVERLAY_WINDOWS_ON_FACADES = true;

export type SkySource =
  | { kind: 'procedural' }
  /** Six cube faces in GL order: +X, -X, +Y, -Y, +Z, -Z. */
  | { kind: 'faces'; urls: readonly string[]; sunDirection: Vec3; horizonColor: RGB }
  /** A single equirectangular panorama, resampled into cube faces on load. */
  | { kind: 'panorama'; url: string; sunDirection: Vec3; horizonColor: RGB };

export type RGB = readonly [number, number, number];

/**
 * The sky, and the lighting that has to agree with it.
 *
 * `sunDirection` and `horizonColor` travel with the sky on purpose: the city's
 * shading and its distance fog are keyed off them, so a photographic sky whose
 * sun sits somewhere else will look wrong until these match it. Point
 * `sunDirection` from the ground toward the sun, and sample `horizonColor`
 * straight off the image at eye level.
 */
export const SKY: SkySource = { kind: 'procedural' };

// Example, using a Poly Haven panorama saved as public/sky/afternoon.jpg:
//
// export const SKY: SkySource = {
//   kind: 'panorama',
//   url: '/sky/afternoon.jpg',
//   sunDirection: normalize({ x: 0.38, y: 0.42, z: -0.82 }),
//   horizonColor: [0.74, 0.76, 0.75],
// };

export interface ResolvedSky {
  faces: ImageData[];
  sunDirection: Vec3;
  horizonColor: RGB;
}

export interface CityAssets {
  /** One canvas per TextureLayer, all TEXTURE_SIZE square. */
  surfaces: HTMLCanvasElement[];
  /** Matching normal maps, flat where a layer has none. */
  normals: HTMLCanvasElement[];
  sky: ResolvedSky;
}

export async function loadCityAssets(): Promise<CityAssets> {
  const [surfaces, normals, sky] = await Promise.all([
    loadSurfaceTextures(),
    loadNormalMaps(),
    loadSky(SKY),
  ]);
  return { surfaces, normals, sky };
}

const KNOWN_LAYERS = new Set<number>(Object.values(TextureLayer));

/**
 * Manifest entries with their keys back as numbers.
 *
 * Object keys stringify, so an entry that is not a real layer would otherwise
 * land on NaN and silently do nothing.
 */
function layerEntries(
  manifest: Partial<Record<TextureLayer, string>>,
): Array<[TextureLayer, string]> {
  return Object.entries(manifest).flatMap(([key, url]) => {
    const layer = Number(key) as TextureLayer;

    if (!KNOWN_LAYERS.has(layer)) {
      console.warn(`Ignoring unknown texture layer "${key}" (${url})`);
      return [];
    }

    return [[layer, url] as [TextureLayer, string]];
  });
}

async function loadSurfaceTextures(): Promise<HTMLCanvasElement[]> {
  const surfaces = createSurfaceTextures();

  await Promise.all(
    layerEntries(SURFACE_TEXTURES).map(async ([layer, url]) => {
      try {
        const canvas = rasterise(await loadImageBitmap(url), TEXTURE_SIZE);
        if (OVERLAY_WINDOWS_ON_FACADES) overlayFacadeWindow(canvas, layer);
        surfaces[layer] = canvas;
      } catch (error) {
        console.warn(`Keeping the procedural texture for layer ${layer}:`, error);
      }
    }),
  );

  return surfaces;
}

async function loadNormalMaps(): Promise<HTMLCanvasElement[]> {
  // One flat canvas, shared by every layer without a map of its own: the
  // upload reads it per layer, so there is no need for six copies.
  const flat = createFlatNormalMap();
  const normals = Object.values(TextureLayer).map(() => flat);

  await Promise.all(
    layerEntries(SURFACE_NORMAL_MAPS).map(async ([layer, url]) => {
      try {
        normals[layer] = rasterise(await loadImageBitmap(url), TEXTURE_SIZE);
      } catch (error) {
        console.warn(`No normal map for layer ${layer}, shading it flat:`, error);
      }
    }),
  );

  return normals;
}

async function loadSky(source: SkySource): Promise<ResolvedSky> {
  const procedural = (): ResolvedSky => ({
    faces: createSkyFaces(),
    sunDirection: SUN_DIRECTION,
    horizonColor: HORIZON_COLOR,
  });

  if (source.kind === 'procedural') return procedural();

  try {
    if (source.kind === 'panorama') {
      const panorama = readPixels(await loadImageBitmap(source.url));
      return {
        faces: panoramaToSkyFaces(panorama, SKY_FACE_SIZE),
        sunDirection: normalize(source.sunDirection),
        horizonColor: source.horizonColor,
      };
    }

    if (source.urls.length !== 6) {
      throw new Error(`A cube map needs 6 faces, got ${source.urls.length}`);
    }

    const faces = await Promise.all(
      source.urls.map(async (url) => {
        const canvas = rasterise(await loadImageBitmap(url), SKY_FACE_SIZE);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        return ctx.getImageData(0, 0, SKY_FACE_SIZE, SKY_FACE_SIZE);
      }),
    );

    return {
      faces,
      sunDirection: normalize(source.sunDirection),
      horizonColor: source.horizonColor,
    };
  } catch (error) {
    console.warn('Falling back to the procedural sky:', error);
    return procedural();
  }
}
