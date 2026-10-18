import {
  TextureLayer,
  type CityLayout,
  type FacadeSpan,
  type Rect,
  type SurfaceLayer,
} from './layout';

/** position(3) + normal(3) + tangent(4) + uv(2) + layer(1) + tint(3) */
export const FLOATS_PER_VERTEX = 16;

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

type Triple = [number, number, number];
type UV = [number, number];
type Tint = readonly [number, number, number];

const WHITE: Tint = [1, 1, 1];

/** Vestavěné fasády se kreslí po jedné okenní ose a jednom podlaží na dlaždici. */
const SINGLE_BAY: FacadeSpan = { bays: 1, storeys: 1 };

/** Metry světa pokryté jednou dlaždicí každé volně dlaždicované textury. */
const ASPHALT_TILE = 6;
const SIDEWALK_TILE = 4;
const COBBLE_TILE = 2.5;
const GRASS_TILE = 5;
const ROOF_TILE = 6;

/**
 * Jak daleko za poslední blok sahá rovina terénu, v metrech.
 *
 * Bez toho by terén končil ostrou obdélníkovou hranou se skyboxem pod ní.
 * Vysunutí roviny za dosah mlhy hranici místo toho skryje.
 */
const OUTSKIRTS_MARGIN = 1600;

/**
 * Rovina terénu leží těsně pod vozovkou.
 *
 * Obě jsou vodorovné a jinak by byly koplanární, což způsobí z-fighting po celém
 * městě. Snížit rovinu o pár centimetrů je levnější než do ní vyřezávat díry
 * pro každou ulici.
 */
const GROUND_PLANE_Y = -0.04;

/**
 * Okno v textuře silnice bez značení, používané pro křižovatky.
 *
 * Křižovatky mají na šířku přesně jednu dlaždici a nikdy se neopakují, takže mohou
 * vzorkovat libovolný podobdélník bez obav ze švů — takto získávají čistý asfalt
 * z textury, na které jsou namalované čáry.
 *
 * Měřeno v prostoru UV, kde v = 0 je spodek obrázku: toto okno začíná 8 % pod
 * horním okrajem Road008B.
 */
const CLEAN_ROAD_UV = { u0: 0.1, v0: 0.58, u1: 0.44, v1: 0.92 };

/** Výška, po kterou zapečené stínování v koutech postupně mizne, v metrech. */
const AO_HEIGHT = 7;
const AO_FLOOR = 0.68;

/**
 * Shromažďuje celé město do jednoho prokládaného bufferu.
 *
 * Město je statické, takže se vše sloučí do jednoho VAO a jednoho draw callu
 * místo jednoho na budovu.
 */
class MeshBuilder {
  private readonly vertices: number[] = [];
  private readonly indices: number[] = [];
  private vertexCount = 0;

  /**
   * Přidá quad ze čtyř rohů otočených proti směru hodinových ručiček při pohledu
   * na přední stěnu, s explicitním UV pro každý roh.
   */
  quad(
    corners: Triple[],
    normal: Triple,
    uvs: UV[],
    layer: SurfaceLayer,
    tint: Tint,
    shade = false,
  ): void {
    const [tangent, handedness] = tangentFrame(corners, uvs, normal);

    for (let i = 0; i < 4; i++) {
      const corner = corners[i];
      const uv = uvs[i];
      if (!corner || !uv) throw new Error('quad() requires four corners and four UVs');

      // Zapečená ambient occlusion: ztmaví geometrii u úrovně ulice, kam ve
      // skutečném městě dopadá jen velmi málo světla z oblohy.
      const ao = shade ? AO_FLOOR + (1 - AO_FLOOR) * Math.min(corner[1] / AO_HEIGHT, 1) : 1;

      this.vertices.push(
        corner[0],
        corner[1],
        corner[2],
        normal[0],
        normal[1],
        normal[2],
        tangent[0],
        tangent[1],
        tangent[2],
        handedness,
        uv[0],
        uv[1],
        layer,
        tint[0] * ao,
        tint[1] * ao,
        tint[2] * ao,
      );
    }

    const base = this.vertexCount;
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vertexCount += 4;
  }

  /**
   * Rohy vodorovného quadu v jediném pořadí, při kterém směřuje nahoru.
   * Pozor, že +Z jde před +X: roh 0 -> 1 postupuje podél Z a
   * roh 0 -> 3 podél X.
   */
  private static groundCorners(rect: Rect, y: number): Triple[] {
    return [
      [rect.minX, y, rect.minZ],
      [rect.minX, y, rect.maxZ],
      [rect.maxX, y, rect.maxZ],
      [rect.maxX, y, rect.minZ],
    ];
  }

  /** Quad směřující nahoru s explicitními UV. */
  groundUV(rect: Rect, y: number, layer: TextureLayer, uvs: UV[]): void {
    this.quad(MeshBuilder.groundCorners(rect, y), [0, 1, 0], uvs, layer, WHITE);
  }

  /** Quad směřující nahoru, čtvercově dlaždicovaný, jedno opakování na `tileSize` metrů. */
  ground(rect: Rect, y: number, layer: TextureLayer, tileSize: number): void {
    // Pořadí rohů jde nejdřív po +Z, takže U sleduje Z a V sleduje X. Každý
    // počet dlaždic musí vycházet z vlastní osy, jinak se textura na každém
    // nečtvercovém quadu roztáhne.
    const alongZ = (rect.maxZ - rect.minZ) / tileSize;
    const alongX = (rect.maxX - rect.minX) / tileSize;

    this.groundUV(rect, y, layer, [
      [0, 0],
      [alongZ, 0],
      [alongZ, alongX],
      [0, alongX],
    ]);
  }

  /**
   * Úsek vozovky.
   *
   * Textura silnice je vytvořená jako příčný řez — okrajové čáry podél obou hran,
   * středová čára uprostřed — takže U pokryje celou šířku přesně jednou a opakuje
   * se jen V, ve směru jízdy.
   */
  roadway(rect: Rect, along: 'x' | 'z', tileLength: number): void {
    const length = along === 'z' ? rect.maxZ - rect.minZ : rect.maxX - rect.minX;
    // Jen celá opakování, aby přerušované čáry zůstaly v úseku rovnoměrně rozmístěné.
    const tiles = Math.max(1, Math.round(length / tileLength));

    const uvs: UV[] =
      along === 'z'
        ? // Dlouhý v Z: U musí křížit silnici, takže sleduje +X (roh 0 -> 3).
          [
            [0, 0],
            [0, tiles],
            [1, tiles],
            [1, 0],
          ]
        : // Dlouhý v X: U kříží silnici přes +Z (roh 0 -> 1).
          [
            [0, 0],
            [1, 0],
            [1, tiles],
            [0, tiles],
          ];

    this.groundUV(rect, 0, TextureLayer.Road, uvs);
  }

  /** Čtverec křižovatky, vzatý z čistého místa textury silnice. */
  intersection(rect: Rect): void {
    const { u0, v0, u1, v1 } = CLEAN_ROAD_UV;

    this.groundUV(rect, 0, TextureLayer.Road, [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]);
  }

  /**
   * Svislý quad z (x0,z0) do (x1,z1) mezi výškami y0 a y1.
   * Vnější normála je směr pohybu otočený o čtvrt obrátky, takže volající
   * určuje, kam stěna hledí, pořadím jejích koncových bodů.
   */
  wall(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    uvW: number,
    uvH: number,
    layer: SurfaceLayer,
    tint: Tint,
  ): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;

    this.quad(
      [
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z0],
      ],
      [-dz / len, 0, dx / len],
      [
        [0, 0],
        [uvW, 0],
        [uvW, uvH],
        [0, uvH],
      ],
      layer,
      tint,
      true,
    );
  }

  build(): MeshData {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
    };
  }
}

/**
 * Tangent frame pro quad, vyřešený z pozic jeho rohů a UV.
 *
 * Normal mapping potřebuje vědět, kudy ve světovém prostoru vede osa U textury.
 * Stěny, quady terénu i vozovky mají různé pořadí vrcholů a přiřazují UV podél
 * různých os, takže se zde invertuje jakobián UV místo spoléhání na konvence
 * pro jednotlivé případy.
 *
 * Vrací jednotkový směr U plus znaménko orientace, takže shader může
 * dopočítat bitangentu jako `cross(normal, tangent) * handedness`, místo aby
 * na ni spotřeboval další tři floaty na vrchol.
 */
function tangentFrame(corners: Triple[], uvs: UV[], normal: Triple): [Triple, number] {
  const p0 = corners[0];
  const p1 = corners[1];
  const p3 = corners[3];
  const uv0 = uvs[0];
  const uv1 = uvs[1];
  const uv3 = uvs[3];

  if (!p0 || !p1 || !p3 || !uv0 || !uv1 || !uv3) {
    throw new Error('quad() requires four corners and four UVs');
  }

  const e1: Triple = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2: Triple = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];

  const du1 = uv1[0] - uv0[0];
  const dv1 = uv1[1] - uv0[1];
  const du2 = uv3[0] - uv0[0];
  const dv2 = uv3[1] - uv0[1];

  const det = du1 * dv2 - du2 * dv1;
  const r = det === 0 ? 0 : 1 / det;

  const tangent: Triple = [
    (e1[0] * dv2 - e2[0] * dv1) * r,
    (e1[1] * dv2 - e2[1] * dv1) * r,
    (e1[2] * dv2 - e2[2] * dv1) * r,
  ];
  const bitangent: Triple = [
    (e2[0] * du1 - e1[0] * du2) * r,
    (e2[1] * du1 - e1[1] * du2) * r,
    (e2[2] * du1 - e1[2] * du2) * r,
  ];

  const len = Math.hypot(tangent[0], tangent[1], tangent[2]) || 1;
  tangent[0] /= len;
  tangent[1] /= len;
  tangent[2] /= len;

  // cross(normal, tangent) dává kandidáta na bitangentu; pokud míří proti
  // vyřešenému směru +V, frame je levotočivý a znaménko se otočí.
  const cx = normal[1] * tangent[2] - normal[2] * tangent[1];
  const cy = normal[2] * tangent[0] - normal[0] * tangent[2];
  const cz = normal[0] * tangent[1] - normal[1] * tangent[0];
  const handedness = cx * bitangent[0] + cy * bitangent[1] + cz * bitangent[2] < 0 ? -1 : 1;

  return [tangent, handedness];
}

export function buildCityMesh(layout: CityLayout): MeshData {
  const builder = new MeshBuilder();
  const { config, bounds } = layout;
  const kerb = config.sidewalkHeight;

  // Asfalt bez značení pod celou mapou, protažený do oparu. Vidět je z něj vůbec
  // jen periferie a ulice poloviční šířky na okraji mapy.
  builder.ground(
    {
      minX: bounds.minX - OUTSKIRTS_MARGIN,
      minZ: bounds.minZ - OUTSKIRTS_MARGIN,
      maxX: bounds.maxX + OUTSKIRTS_MARGIN,
      maxZ: bounds.maxZ + OUTSKIRTS_MARGIN,
    },
    GROUND_PLANE_Y,
    TextureLayer.Asphalt,
    ASPHALT_TILE,
  );

  addRoadNetwork(builder, layout);

  for (const block of layout.blocks) {
    const { plot, sidewalk } = block;

    // Chodník jako prstenec čtyř pruhů; vnitřek pozemku zůstává volný, aby
    // dlažba pod ním s ním nikdy neměla z-fighting.
    builder.ground(
      { minX: sidewalk.minX, maxX: sidewalk.maxX, minZ: sidewalk.minZ, maxZ: plot.minZ },
      kerb,
      TextureLayer.Sidewalk,
      SIDEWALK_TILE,
    );
    builder.ground(
      { minX: sidewalk.minX, maxX: sidewalk.maxX, minZ: plot.maxZ, maxZ: sidewalk.maxZ },
      kerb,
      TextureLayer.Sidewalk,
      SIDEWALK_TILE,
    );
    builder.ground(
      { minX: sidewalk.minX, maxX: plot.minX, minZ: plot.minZ, maxZ: plot.maxZ },
      kerb,
      TextureLayer.Sidewalk,
      SIDEWALK_TILE,
    );
    builder.ground(
      { minX: plot.maxX, maxX: sidewalk.maxX, minZ: plot.minZ, maxZ: plot.maxZ },
      kerb,
      TextureLayer.Sidewalk,
      SIDEWALK_TILE,
    );

    if (block.isPark) builder.ground(plot, kerb, TextureLayer.Grass, GRASS_TILE);
    else builder.ground(plot, kerb, TextureLayer.Cobble, COBBLE_TILE);

    // Čelo obrubníku, aby byl schod ze silnice vidět, a ne jen naznačen.
    // Začíná na rovině terénu, ne na nule, aby u paty nebyla vidět mezera.
    addPerimeterWalls(
      builder,
      sidewalk,
      GROUND_PLANE_Y,
      kerb,
      TextureLayer.Sidewalk,
      WHITE,
      1,
      0.2,
    );

    for (const building of block.buildings) {
      const { footprint, height, facade, tint, facadeSpan = SINGLE_BAY } = building;
      const floors = Math.max(1, Math.round(height / config.floorHeight));

      addPerimeterWalls(
        builder,
        footprint,
        0,
        height,
        facade,
        tint,
        undefined,
        floors / facadeSpan.storeys,
        facadeSpan.bays,
      );
      builder.ground(footprint, height, TextureLayer.Roof, ROOF_TILE);
    }
  }

  return builder.build();
}

/**
 * Vozovky a křižovatky na mřížce ulic.
 *
 * Úseky končí před každou křižovatkou a křižovatky se pokládají zvlášť, takže
 * se oba směry nikdy nepřekrývají a žádný úsek nemá okrajové značení přes své ústí.
 */
function addRoadNetwork(builder: MeshBuilder, layout: CityLayout): void {
  const { config, pitch } = layout;

  // Chodníky zabírají ulici z obou stran; co zbude, je vozovka.
  const halfRoad = config.streetWidth / 2 - config.sidewalkWidth;
  // Jedno opakování textury pokryje čtverec vozovky a zachová její poměr stran.
  const tileLength = halfRoad * 2;

  const blockStart = config.streetWidth / 2 - config.sidewalkWidth;
  const blockEnd = config.streetWidth / 2 + config.blockSize + config.sidewalkWidth;

  // Jen vnitřní ulice. Ulice poloviční šířky na okraji mapy by příčný řez
  // zmáčkly, takže zůstávají součástí obyčejné roviny terénu.
  for (let street = 1; street < config.gridSize; street++) {
    const centre = street * pitch;

    for (let block = 0; block < config.gridSize; block++) {
      const from = block * pitch + blockStart;
      const to = block * pitch + blockEnd;

      builder.roadway(
        { minX: centre - halfRoad, maxX: centre + halfRoad, minZ: from, maxZ: to },
        'z',
        tileLength,
      );
      builder.roadway(
        { minX: from, maxX: to, minZ: centre - halfRoad, maxZ: centre + halfRoad },
        'x',
        tileLength,
      );
    }
  }

  for (let x = 1; x < config.gridSize; x++) {
    for (let z = 1; z < config.gridSize; z++) {
      builder.intersection({
        minX: x * pitch - halfRoad,
        maxX: x * pitch + halfRoad,
        minZ: z * pitch - halfRoad,
        maxZ: z * pitch + halfRoad,
      });
    }
  }
}

/**
 * Stěny kolem obdélníku s normálami mířícími ven.
 *
 * Pořadí rohů je takové, aby otočená normála z `MeshBuilder.wall` směřovala
 * od obdélníku na všech čtyřech stranách.
 */
function addPerimeterWalls(
  builder: MeshBuilder,
  rect: Rect,
  y0: number,
  y1: number,
  layer: SurfaceLayer,
  tint: Tint,
  uvPerMetre: number | undefined,
  uvH: number,
  baysPerTile = 1,
): void {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;

  // Fasády na každou stěnu umístí celý počet okenních os, takže textura přes
  // několik os stále začíná i končí na hranici osy; obrubníky mají
  // explicitní hustotu.
  const bays = (length: number): number => Math.max(1, Math.round(length / 4)) / baysPerTile;
  const tilesX = uvPerMetre !== undefined ? width * uvPerMetre : bays(width);
  const tilesZ = uvPerMetre !== undefined ? depth * uvPerMetre : bays(depth);

  builder.wall(rect.maxX, rect.minZ, rect.minX, rect.minZ, y0, y1, tilesX, uvH, layer, tint);
  builder.wall(rect.minX, rect.minZ, rect.minX, rect.maxZ, y0, y1, tilesZ, uvH, layer, tint);
  builder.wall(rect.minX, rect.maxZ, rect.maxX, rect.maxZ, y0, y1, tilesX, uvH, layer, tint);
  builder.wall(rect.maxX, rect.maxZ, rect.maxX, rect.minZ, y0, y1, tilesZ, uvH, layer, tint);
}
