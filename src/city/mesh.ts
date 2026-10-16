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

/** Built-in facades are drawn one window bay and one storey per tile. */
const SINGLE_BAY: FacadeSpan = { bays: 1, storeys: 1 };

/** World metres covered by one tile of each freely-tiled texture. */
const ASPHALT_TILE = 6;
const SIDEWALK_TILE = 4;
const COBBLE_TILE = 2.5;
const ROOF_TILE = 6;

/**
 * How far the ground plane extends past the last block, in metres.
 *
 * Without this the ground stops at a hard rectangular edge with skybox below
 * it. Pushing the plane out past the fog's reach hides the boundary instead.
 */
const OUTSKIRTS_MARGIN = 1600;

/**
 * The ground plane sits just below the carriageway.
 *
 * Both are horizontal and would otherwise be coplanar, which z-fights across
 * the entire city. Dropping the plane a few centimetres is cheaper than
 * cutting holes in it for every street.
 */
const GROUND_PLANE_Y = -0.04;

/**
 * A marking-free window on the road texture, used for intersections.
 *
 * Intersections are exactly one tile across and never repeat, so they can
 * sample an arbitrary sub-rectangle without any seam to worry about — which is
 * how they get clean asphalt out of a texture that has lines painted on it.
 *
 * Measured in UV space, where v = 0 is the bottom of the image: this window
 * starts 8% down from the top of Road008B.
 */
const CLEAN_ROAD_UV = { u0: 0.1, v0: 0.58, u1: 0.44, v1: 0.92 };

/** Height over which baked corner shading fades out, in metres. */
const AO_HEIGHT = 7;
const AO_FLOOR = 0.68;

/**
 * Accumulates the whole city into one interleaved buffer.
 *
 * The city is static, so everything collapses into a single VAO and a single
 * draw call rather than one per building.
 */
class MeshBuilder {
  private readonly vertices: number[] = [];
  private readonly indices: number[] = [];
  private vertexCount = 0;

  /**
   * Appends a quad from four corners wound counter-clockwise as seen from the
   * front face, with an explicit UV per corner.
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

      // Baked ambient occlusion: darken geometry near street level, where a
      // real city gets very little sky light.
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
   * Corners of a horizontal quad, in the only order that leaves it facing up.
   * Note that this runs +Z before +X: corner 0 -> 1 steps along Z, and
   * corner 0 -> 3 steps along X.
   */
  private static groundCorners(rect: Rect, y: number): Triple[] {
    return [
      [rect.minX, y, rect.minZ],
      [rect.minX, y, rect.maxZ],
      [rect.maxX, y, rect.maxZ],
      [rect.maxX, y, rect.minZ],
    ];
  }

  /** Up-facing quad with explicit UVs. */
  groundUV(rect: Rect, y: number, layer: TextureLayer, uvs: UV[]): void {
    this.quad(MeshBuilder.groundCorners(rect, y), [0, 1, 0], uvs, layer, WHITE);
  }

  /** Up-facing quad tiled squarely, one repeat per `tileSize` metres. */
  ground(rect: Rect, y: number, layer: TextureLayer, tileSize: number): void {
    // The corner order runs +Z first, so U follows Z and V follows X. Each
    // tile count has to come from its own axis or the texture comes out
    // stretched on any quad that is not square.
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
   * A stretch of carriageway.
   *
   * The road texture is authored as a cross-section — kerb lines along its two
   * edges, centre line down the middle — so U spans the full width exactly
   * once and only V repeats, along the direction of travel.
   */
  roadway(rect: Rect, along: 'x' | 'z', tileLength: number): void {
    const length = along === 'z' ? rect.maxZ - rect.minZ : rect.maxX - rect.minX;
    // Whole repeats only, so the dashes stay evenly spaced within a segment.
    const tiles = Math.max(1, Math.round(length / tileLength));

    const uvs: UV[] =
      along === 'z'
        ? // Long in Z: U has to cross the road, so it follows +X (corner 0 -> 3).
          [
            [0, 0],
            [0, tiles],
            [1, tiles],
            [1, 0],
          ]
        : // Long in X: U crosses the road via +Z (corner 0 -> 1).
          [
            [0, 0],
            [1, 0],
            [1, tiles],
            [0, tiles],
          ];

    this.groundUV(rect, 0, TextureLayer.Road, uvs);
  }

  /** Intersection square, taken from the road texture's clean patch. */
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
   * Vertical quad running from (x0,z0) to (x1,z1) between heights y0 and y1.
   * The outward normal is the travel direction rotated a quarter turn, so the
   * caller controls which way the wall faces by the order of its endpoints.
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
 * Tangent frame for a quad, solved from its corner positions and UVs.
 *
 * Normal mapping needs to know which way the texture's U axis runs in world
 * space. Walls, ground quads and carriageways all wind differently and assign
 * UVs along different axes, so this inverts the UV jacobian rather than trust
 * any per-case convention.
 *
 * Returns the unit U direction plus a handedness sign, letting the shader
 * rebuild the bitangent as `cross(normal, tangent) * handedness` instead of
 * spending three more floats per vertex on it.
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

  // cross(normal, tangent) gives a bitangent candidate; if it opposes the
  // solved +V direction the frame is left-handed and the sign flips.
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

  // Unmarked asphalt under the whole map, extended into the haze. Only the
  // outskirts and the half-width streets at the map edge are ever seen.
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

    // Sidewalk as a ring of four strips, leaving the plot interior free so the
    // cobbles below never z-fight against it.
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

    builder.ground(plot, kerb, TextureLayer.Cobble, COBBLE_TILE);

    // Kerb face, so the step up from the road is visible rather than implied.
    // It starts at the ground plane, not at zero, so no gap shows at the base.
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
 * Carriageways and intersections over the street grid.
 *
 * Segments stop short of each crossing and the intersections are laid in
 * separately, so the two directions never overlap and no segment has kerb
 * markings running across its mouth.
 */
function addRoadNetwork(builder: MeshBuilder, layout: CityLayout): void {
  const { config, pitch } = layout;

  // Sidewalks eat into the street from both sides; what is left is roadway.
  const halfRoad = config.streetWidth / 2 - config.sidewalkWidth;
  // One texture repeat covers a square of roadway, preserving its aspect.
  const tileLength = halfRoad * 2;

  const blockStart = config.streetWidth / 2 - config.sidewalkWidth;
  const blockEnd = config.streetWidth / 2 + config.blockSize + config.sidewalkWidth;

  // Interior streets only. The half-width streets at the map edge would
  // squash the cross-section, so they stay part of the plain ground plane.
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
 * Walls around a rectangle with normals pointing outward.
 *
 * The corner order is the one that makes `MeshBuilder.wall`'s rotated normal
 * face away from the rectangle on all four sides.
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

  // Facades fit a whole number of window bays to each wall, so a texture that
  // spans several bays still starts and ends on a bay boundary; kerbs take an
  // explicit density.
  const bays = (length: number): number => Math.max(1, Math.round(length / 4)) / baysPerTile;
  const tilesX = uvPerMetre !== undefined ? width * uvPerMetre : bays(width);
  const tilesZ = uvPerMetre !== undefined ? depth * uvPerMetre : bays(depth);

  builder.wall(rect.maxX, rect.minZ, rect.minX, rect.minZ, y0, y1, tilesX, uvH, layer, tint);
  builder.wall(rect.minX, rect.minZ, rect.minX, rect.maxZ, y0, y1, tilesZ, uvH, layer, tint);
  builder.wall(rect.minX, rect.maxZ, rect.maxX, rect.maxZ, y0, y1, tilesX, uvH, layer, tint);
  builder.wall(rect.maxX, rect.maxZ, rect.maxX, rect.minZ, y0, y1, tilesZ, uvH, layer, tint);
}
