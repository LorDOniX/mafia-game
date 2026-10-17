import { TextureLayer } from './layout';
import { customFacadeLayer, type CustomFacade } from './facades';
import {
  createFlatNormalMap,
  createSurfaceTextures,
  overlayFacadeWindow,
  repeatFacadeTile,
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
import { loadModel, type LoadedModel } from '@/gfx/gltf';
import type { VehicleModelConfig } from '@/vehicle/model';
import type { AnimalSpecies } from '@/animals/animal';
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
  // Park lawns, tiled freely; e.g. an ambientCG "Grass" swatch.
  [TextureLayer.Grass]: '/textures/park/grass.png',
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

/**
 * Facades of your own, for individual buildings or groups of them.
 *
 * Each entry gets its own texture layer and goes on the buildings its targets
 * pick; everything else keeps the built-in brick and stucco. Add entries to
 * add facades — nothing else needs touching. See `CustomFacade` in
 * `city/facades.ts` for the fields, and the README for how to prepare images.
 */
export const CUSTOM_FACADES: readonly CustomFacade[] = [
  {
    // Granite-clad block, cropped to exactly 9 x 7 window bays so it tiles.
    // Source photo in assets-src/textures/facades/.
    name: 'granite-grid',
    url: '/textures/facades/granite-grid.jpg',
    span: { bays: 9, storeys: 7 },
    targets: [
      // The corner block ahead and to the right of the spawn point.
      { at: { x: 328, z: 327 } },
    ],
  },
  {
    // Granite-clad block, cropped to exactly 9 x 7 window bays so it tiles.
    // Source photo in assets-src/textures/facades/.
    name: 'granite-grid',
    url: '/textures/facades/granite-grid.jpg',
    span: { bays: 9, storeys: 7 },
    targets: [
      // The corner block ahead and to the right of the spawn point.
      { at: { x: 248, z: 325 } },
    ],
  },
];

/**
 * The drivable car.
 *
 * A binary glTF (.glb) facing +Z, with Y up. Textures it references by
 * relative path are resolved against the model file, so keep the folder
 * layout the model shipped with: Kenney's kit expects `Textures/colormap.png`
 * next to the .glb. Size, wheelbase and wheel radius are measured off the
 * model; `scale` converts its units to metres. See `VehicleModelConfig` for
 * how wheels are found.
 */
export const VEHICLE: VehicleModelConfig = {
  // Kenney "Car Kit" (CC0). Licence and preview in assets-src/models/.
  url: '/models/ambulance.glb',
  scale: 1.4,
  spinPrefix: 'wheel-',
  steerPrefix: 'wheel-front',
};

/** Police cars that patrol the streets on their own. Same kit, same wheel names. */
export const POLICE: VehicleModelConfig = {
  url: '/models/police.glb',
  scale: 1.4,
  spinPrefix: 'wheel-',
  steerPrefix: 'wheel-front',
};

export const POLICE_COUNT = 5;

/**
 * Tree species: a model and the height it should stand, in metres. Width
 * follows from the model's proportions.
 *
 * Kenney "Nature Kit" (CC0). Each tree is two coloured materials, crown and
 * trunk, with no texture.
 */
export const TREE_MODELS = {
  oak: { url: '/models/tree_oak.glb', height: 8 },
  pine: { url: '/models/tree_pineDefaultA.glb', height: 10 },
  smallPine: { url: '/models/tree_pineSmallA.glb', height: 5 },
} satisfies Record<string, { url: string; height: number }>;

export type TreeSpecies = keyof typeof TREE_MODELS;

/** Sidewalks and squares. One species per side of a street, picked from here. */
export const STREET_TREES: readonly TreeSpecies[] = ['oak'];
/** Parks, mixed tree by tree; repeat an entry to make it more common. */
export const PARK_TREES: readonly TreeSpecies[] = ['oak', 'oak', 'pine', 'smallPine'];

/**
 * Park animals: Kenney "Cube Pets" (CC0), standing `height` metres tall.
 * Flyers circle above the park; everything else wanders the lawn.
 * The fish is in the kit too, but left out: it would only flop about.
 */
export const ANIMALS: readonly AnimalSpecies[] = [
  { url: '/models-animals/animal-beaver.glb', height: 0.6 },
  { url: '/models-animals/animal-bee.glb', height: 0.6, flies: true },
  { url: '/models-animals/animal-bunny.glb', height: 0.6 },
  { url: '/models-animals/animal-cat.glb', height: 0.6 },
  { url: '/models-animals/animal-caterpillar.glb', height: 0.4 },
  { url: '/models-animals/animal-chick.glb', height: 0.45 },
  { url: '/models-animals/animal-cow.glb', height: 1.6 },
  { url: '/models-animals/animal-crab.glb', height: 0.4 },
  { url: '/models-animals/animal-deer.glb', height: 1.6 },
  { url: '/models-animals/animal-dog.glb', height: 0.8 },
  { url: '/models-animals/animal-elephant.glb', height: 3 },
  { url: '/models-animals/animal-fox.glb', height: 0.7 },
  { url: '/models-animals/animal-giraffe.glb', height: 4.5 },
  { url: '/models-animals/animal-hog.glb', height: 1 },
  { url: '/models-animals/animal-koala.glb', height: 0.7 },
  { url: '/models-animals/animal-lion.glb', height: 1.3 },
  { url: '/models-animals/animal-monkey.glb', height: 0.9 },
  { url: '/models-animals/animal-panda.glb', height: 1.4 },
  { url: '/models-animals/animal-parrot.glb', height: 0.7, flies: true },
  { url: '/models-animals/animal-penguin.glb', height: 0.9 },
  { url: '/models-animals/animal-pig.glb', height: 1 },
  { url: '/models-animals/animal-polar.glb', height: 1.6 },
  { url: '/models-animals/animal-tiger.glb', height: 1.2 },
];

/** How many animals each park gets, inclusive. */
export const ANIMALS_PER_PARK = { min: 3, max: 7 };

/** A model, or null if it fails to load: the city still works without it. */
export async function loadOptionalModel(url: string): Promise<LoadedModel | null> {
  try {
    return await loadModel(url);
  } catch (error) {
    console.warn(`No ${url} this session, the model failed to load:`, error);
    return null;
  }
}

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
  /** One canvas per TextureLayer, then one per custom facade, all TEXTURE_SIZE square. */
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
  // Taken before any override lands, as the stand-in for custom facades.
  const plaster = surfaces[TextureLayer.Plaster];
  if (!plaster) throw new Error('Procedural plaster texture missing');

  await Promise.all([
    ...layerEntries(SURFACE_TEXTURES).map(async ([layer, url]) => {
      try {
        const canvas = rasterise(await loadImageBitmap(url), TEXTURE_SIZE);
        if (OVERLAY_WINDOWS_ON_FACADES) overlayFacadeWindow(canvas, layer);
        surfaces[layer] = canvas;
      } catch (error) {
        console.warn(`Keeping the procedural texture for layer ${layer}:`, error);
      }
    }),
    ...CUSTOM_FACADES.map(async (facade, index) => {
      const layer = customFacadeLayer(index);
      try {
        surfaces[layer] = rasterise(await loadImageBitmap(facade.url), TEXTURE_SIZE);
      } catch (error) {
        console.warn(`Custom facade "${facade.name}" falls back to plaster:`, error);
        surfaces[layer] = repeatFacadeTile(plaster, facade.span.bays, facade.span.storeys);
      }
    }),
  ]);

  return surfaces;
}

async function loadNormalMaps(): Promise<HTMLCanvasElement[]> {
  // One flat canvas, shared by every layer without a map of its own: the
  // upload reads it per layer, so there is no need for six copies.
  const flat = createFlatNormalMap();
  // Custom facades included, so both arrays have the same depth.
  const normals = [...Object.values(TextureLayer), ...CUSTOM_FACADES].map(() => flat);

  await Promise.all([
    ...layerEntries(SURFACE_NORMAL_MAPS).map(async ([layer, url]) => {
      try {
        normals[layer] = rasterise(await loadImageBitmap(url), TEXTURE_SIZE);
      } catch (error) {
        console.warn(`No normal map for layer ${layer}, shading it flat:`, error);
      }
    }),
    ...CUSTOM_FACADES.map(async ({ name, normalUrl }, index) => {
      if (!normalUrl) return;
      try {
        normals[customFacadeLayer(index)] = rasterise(
          await loadImageBitmap(normalUrl),
          TEXTURE_SIZE,
        );
      } catch (error) {
        console.warn(`No normal map for custom facade "${name}", shading it flat:`, error);
      }
    }),
  ]);

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
