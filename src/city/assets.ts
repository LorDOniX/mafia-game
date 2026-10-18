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
 * Odkud město bere svou grafiku.
 *
 * Toto je jediný soubor, na který je třeba sáhnout při záměně procedurálních textur
 * za stažená PNG. Soubory dejte do `public/`, který Vite servíruje beze změny,
 * a odkazujte na ně absolutní cestou — `public/textures/brick.png` je za běhu
 * `/textures/brick.png`. Neimportujte je ze `src/`: tato cesta přidá do názvu
 * souboru hash, což nemá smysl u grafiky, na kterou se odkazujete jménem.
 *
 * Každá vynechaná vrstva se vrátí ke své procedurální textuře a URL, které se
 * nepodaří načíst, vypíše varování a také se vrátí, takže překlep zhorší výsledek
 * místo toho, aby něco rozbil.
 */
export const SURFACE_TEXTURES: Partial<Record<TextureLayer, string>> = {
  // ambientCG "Road008B" (CC0). Tato vrstva se mapuje přes šířku ulice, takže
  // její textura musí být příčný řez vozovkou: čáry obrubníků na obou svislých
  // okrajích, středová čára uprostřed. Obyčejný vzorek asfaltu by tu fungoval,
  // ale město by zůstalo bez značení.
  [TextureLayer.Road]: '/textures/road/Road008B_1K-JPG_Color.jpg',
  // Volně dlaždicovaná, takže potřebuje bezšvý vzorek bez jakéhokoli značení.
  // Ukazuje se jen na okrajích města a v ulicích na okraji mapy.
  // [TextureLayer.Asphalt]: '/textures/asphalt.png',
  // [TextureLayer.Sidewalk]: '/textures/pavement.png',
  // [TextureLayer.Cobble]: '/textures/cobblestone.png',
  // [TextureLayer.Brick]: '/textures/brick.png',
  // [TextureLayer.Plaster]: '/textures/plaster.png',
  // [TextureLayer.Roof]: '/textures/roof.png',
  // Trávníky v parcích, volně dlaždicované; např. vzorek ambientCG "Grass".
  [TextureLayer.Grass]: '/textures/park/grass.png',
};

/**
 * Normal mapy v tangent space, s klíči stejnými jako `SURFACE_TEXTURES`.
 *
 * Použijte konvenci **OpenGL**, kde zelená míří nahoru (+Y). Balíčky, které
 * dodávají obě varianty, je označují `NormalGL` a `NormalDX`; varianta DirectX má
 * invertovaný zelený kanál a osvětlila by každý hrbol z opačné strany.
 *
 * Vrstvy bez záznamu dostanou plochou normálu a stínují se přesně jako dřív.
 */
export const SURFACE_NORMAL_MAPS: Partial<Record<TextureLayer, string>> = {
  [TextureLayer.Road]: '/textures/road/Road008B_1K-JPG_NormalGL.jpg',
};

/**
 * Globální násobitel síly normal mapy. 1 je mapa tak, jak byla vytvořena, 0 se
 * vrací k plochým geometrickým normálám. Mapy asfaltu bývají agresivní a vozovka
 * je vidět pod šikmými úhly, kde silné normály působí jako šum.
 */
export const NORMAL_STRENGTH = 0.6;

/**
 * Zda kreslit procedurální okno přes načtené textury fasád.
 *
 * Nechte zapnuté, pokud vaše grafika fasád už okna neobsahuje: mesh mapuje
 * jednu dlaždici na jedno podlaží a jednu okenní osu, takže prostá fotka zdi
 * by se jinak opakovala do prázdné stěny.
 */
export const OVERLAY_WINDOWS_ON_FACADES = true;

/**
 * Vlastní fasády pro jednotlivé budovy nebo jejich skupiny.
 *
 * Každý záznam dostane vlastní vrstvu textury a použije se na budovy, které
 * vyberou jeho cíle; vše ostatní si ponechá vestavěnou cihlu a štuk. Fasády
 * přidáte přidáním záznamů — na nic dalšího sahat netřeba. Pole popisuje
 * `CustomFacade` v `city/facades.ts`, přípravu obrázků README.
 */
export const CUSTOM_FACADES: readonly CustomFacade[] = [
  {
    // Blok obložený žulou, oříznutý přesně na 9 x 7 okenních os, aby se dlaždicoval.
    // Zdrojová fotka je v assets-src/textures/facades/.
    name: 'granite-grid',
    url: '/textures/facades/granite-grid.jpg',
    span: { bays: 9, storeys: 7 },
    targets: [
      // Nárožní blok vpředu a vpravo od místa spawnu.
      { at: { x: 328, z: 327 } },
    ],
  },
  {
    // Blok obložený žulou, oříznutý přesně na 9 x 7 okenních os, aby se dlaždicoval.
    // Zdrojová fotka je v assets-src/textures/facades/.
    name: 'granite-grid',
    url: '/textures/facades/granite-grid.jpg',
    span: { bays: 9, storeys: 7 },
    targets: [
      // Nárožní blok vpředu a vpravo od místa spawnu.
      { at: { x: 248, z: 325 } },
    ],
  },
];

/**
 * Řiditelné auto.
 *
 * Binární glTF (.glb) natočený k +Z, s osou Y nahoru. Textury, na které odkazuje
 * relativní cestou, se hledají vůči souboru modelu, takže zachovejte strukturu
 * složek, se kterou model přišel: Kenneyho kit očekává `Textures/colormap.png`
 * vedle .glb. Rozměry, rozvor a poloměr kol se měří z modelu; `scale` převádí
 * jeho jednotky na metry. Jak se hledají kola, popisuje `VehicleModelConfig`.
 */
export const VEHICLE: VehicleModelConfig = {
  // Kenney "Car Kit" (CC0). Licence a náhled v assets-src/models/.
  url: '/models/ambulance.glb',
  scale: 1.4,
  spinPrefix: 'wheel-',
  steerPrefix: 'wheel-front',
};

/** Auto v městském provozu, z Kenney "Car Kit" v public/models-car/. */
export interface TrafficCarModel {
  url: string;
  /** Relativní šance, že auto bude tímto modelem. */
  weight: number;
  /** Jeho barva na minimapě. */
  mapColor: string;
}

const CAR_KIT = { scale: 1.4, spinPrefix: 'wheel-', steerPrefix: 'wheel-front' };

/** Převede model z provozu na konfiguraci, kterou berou `fitVehicle` a `vehiclePose`. */
export const trafficVehicleConfig = (model: TrafficCarModel): VehicleModelConfig => ({
  url: model.url,
  ...CAR_KIT,
});

/**
 * Běžný pouliční provoz. Motokáry, závodní auta a traktory zůstávají v kitu; stejně
 * tak SUV, jehož rezervní kolo na zadních dveřích by se točilo s ostatními.
 */
export const TRAFFIC_CARS: readonly TrafficCarModel[] = [
  { url: '/models-car/sedan.glb', weight: 6, mapColor: '#d6d2c8' },
  { url: '/models-car/sedan-sports.glb', weight: 2, mapColor: '#d6d2c8' },
  { url: '/models-car/hatchback-sports.glb', weight: 2, mapColor: '#d6d2c8' },
  { url: '/models-car/suv-luxury.glb', weight: 2, mapColor: '#d6d2c8' },
  { url: '/models-car/taxi.glb', weight: 4, mapColor: '#e8c64a' },
  { url: '/models-car/van.glb', weight: 2, mapColor: '#bfb8a8' },
  { url: '/models-car/delivery.glb', weight: 1.5, mapColor: '#bfb8a8' },
  { url: '/models-car/delivery-flat.glb', weight: 1, mapColor: '#bfb8a8' },
  { url: '/models-car/truck.glb', weight: 1, mapColor: '#a9a294' },
  { url: '/models-car/truck-flat.glb', weight: 1, mapColor: '#a9a294' },
  { url: '/models-car/garbage-truck.glb', weight: 0.5, mapColor: '#8f9a6e' },
  { url: '/models-car/police.glb', weight: 1, mapColor: '#3f7bff' },
  { url: '/models-car/ambulance.glb', weight: 0.4, mapColor: '#f2f2f2' },
  { url: '/models-car/firetruck.glb', weight: 0.3, mapColor: '#d8483a' },
];

/** Auta jezdící po městě najednou. */
export const TRAFFIC_COUNT = 100;

/** Soupeřící gang: Kenney "Blocky Characters" (CC0), pro každého gangstera jeden náhodně. */
export const GANGSTER_MODELS: readonly string[] = 'abcdefghijklmnopqr'
  .split('')
  .map((letter) => `/models-people/character-${letter}.glb`);

/** Pistole pro všechny: Kenney "Blaster Kit" (CC0). */
export const PISTOL_MODEL = {
  url: '/models-weapons/blaster-b.glb',
  /** Převod jednotek modelu na metry. */
  scale: 0.5,
  /** +1, pokud hlaveň míří po +Z modelu, -1 pro -Z. */
  forward: -1,
};

/**
 * Druhy stromů: model a výška, kterou má strom mít, v metrech. Šířka plyne
 * z proporcí modelu.
 *
 * Kenney "Nature Kit" (CC0). Každý strom tvoří dva barevné materiály, koruna
 * a kmen, bez textury.
 */
export const TREE_MODELS = {
  oak: { url: '/models/tree_oak.glb', height: 8 },
  pine: { url: '/models/tree_pineDefaultA.glb', height: 10 },
  smallPine: { url: '/models/tree_pineSmallA.glb', height: 5 },
} satisfies Record<string, { url: string; height: number }>;

export type TreeSpecies = keyof typeof TREE_MODELS;

/** Chodníky a náměstí. Jeden druh na každou stranu ulice, vybraný odsud. */
export const STREET_TREES: readonly TreeSpecies[] = ['oak'];
/** Parky, smíšené strom po stromu; zopakováním záznamu bude druh častější. */
export const PARK_TREES: readonly TreeSpecies[] = ['oak', 'oak', 'pine', 'smallPine'];

/**
 * Zvířata v parcích: Kenney "Cube Pets" (CC0), vysoká `height` metrů.
 * Létající krouží nad parkem; všechna ostatní se toulají po trávníku.
 * Ryba v kitu také je, ale je vynechaná: jen by se plácala sem a tam.
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

/** Kolik zvířat dostane každý park, včetně mezí. */
export const ANIMALS_PER_PARK = { min: 3, max: 7 };

/** Model, nebo null, pokud se nepodaří načíst: město funguje i bez něj. */
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
  /** Šest stěn krychle v pořadí GL: +X, -X, +Y, -Y, +Z, -Z. */
  | { kind: 'faces'; urls: readonly string[]; sunDirection: Vec3; horizonColor: RGB }
  /** Jediné ekvirektangulární panorama, při načtení převzorkované do stěn krychle. */
  | { kind: 'panorama'; url: string; sunDirection: Vec3; horizonColor: RGB };

export type RGB = readonly [number, number, number];

/**
 * Obloha a osvětlení, které s ní musí souhlasit.
 *
 * `sunDirection` a `horizonColor` jsou s oblohou svázány záměrně: stínování města
 * a jeho vzdálenostní mlha se od nich odvíjejí, takže fotografická obloha se
 * sluncem jinde bude vypadat špatně, dokud jí tyto hodnoty neodpovídají. Nasměrujte
 * `sunDirection` od země ke slunci a `horizonColor` odečtěte přímo z obrázku
 * ve výšce očí.
 */
export const SKY: SkySource = { kind: 'procedural' };

// Příklad s panoramatem z Poly Haven uloženým jako public/sky/afternoon.jpg:
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
  /** Jeden canvas na TextureLayer, pak jeden na vlastní fasádu, vše čtverce TEXTURE_SIZE. */
  surfaces: HTMLCanvasElement[];
  /** Odpovídající normal mapy, ploché tam, kde vrstva žádnou nemá. */
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
 * Záznamy manifestu s klíči převedenými zpět na čísla.
 *
 * Klíče objektu se převádějí na řetězce, takže záznam, který není skutečnou
 * vrstvou, by jinak skončil na NaN a tiše by nedělal nic.
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
  // Vezme se dřív, než se uplatní jakékoli přepsání, jako náhrada pro vlastní fasády.
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
  // Jeden plochý canvas sdílený všemi vrstvami bez vlastní mapy: upload ho
  // čte pro každou vrstvu zvlášť, takže není potřeba šest kopií.
  const flat = createFlatNormalMap();
  // Včetně vlastních fasád, aby obě pole měla stejnou hloubku.
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
