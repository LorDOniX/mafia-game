import { describe, expect, it } from 'vitest';
import { buildCityMesh, FLOATS_PER_VERTEX } from '@/city/mesh';
import {
  DEFAULT_CITY_CONFIG,
  generateCity,
  TextureLayer,
  type Building,
  type CityLayout,
} from '@/city/layout';

interface Vertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  tx: number;
  ty: number;
  tz: number;
  handedness: number;
  u: number;
  v: number;
  layer: number;
}

function readVertex(vertices: Float32Array, index: number): Vertex {
  const o = index * FLOATS_PER_VERTEX;
  return {
    x: vertices[o] ?? NaN,
    y: vertices[o + 1] ?? NaN,
    z: vertices[o + 2] ?? NaN,
    nx: vertices[o + 3] ?? NaN,
    ny: vertices[o + 4] ?? NaN,
    nz: vertices[o + 5] ?? NaN,
    tx: vertices[o + 6] ?? NaN,
    ty: vertices[o + 7] ?? NaN,
    tz: vertices[o + 8] ?? NaN,
    handedness: vertices[o + 9] ?? NaN,
    u: vertices[o + 10] ?? NaN,
    v: vertices[o + 11] ?? NaN,
    layer: vertices[o + 12] ?? NaN,
  };
}

const dot = (a: Vertex, b: [number, number, number]): number =>
  a.nx * b[0] + a.ny * b[1] + a.nz * b[2];

const cross = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * True, pokud krok mezi dvěma rohy, které se liší jen v `axis`, vede ve world space
 * ve směru `expected`. Každý quad, který builder vytvoří, se mapuje na osově
 * zarovnaný obdélník v UV prostoru, takže taková dvojice vždy existuje.
 */
function alignedWith(
  corners: Vertex[],
  axis: 'u' | 'v',
  expected: [number, number, number],
): boolean {
  const other = axis === 'u' ? 'v' : 'u';

  for (const from of corners) {
    for (const to of corners) {
      if (Math.abs(from[other] - to[other]) > 1e-6) continue;
      if (to[axis] - from[axis] <= 1e-6) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;

      // Jednotkový posun musí přesně odpovídat očekávané ose, nejen se naklánět
      // stejným směrem, aby otočený frame stále selhal.
      const alignment =
        (dx / len) * expected[0] + (dy / len) * expected[1] + (dz / len) * expected[2];
      return Math.abs(alignment - 1) < 1e-3;
    }
  }

  return false;
}

describe('buildCityMesh', () => {
  const layout = generateCity({ seed: 5 });
  const mesh = buildCityMesh(layout);
  const vertexCount = mesh.vertices.length / FLOATS_PER_VERTEX;

  it('emits a well-formed indexed triangle list', () => {
    expect(mesh.vertices.length % FLOATS_PER_VERTEX).toBe(0);
    expect(mesh.indices.length % 3).toBe(0);

    for (const index of mesh.indices) {
      expect(index).toBeLessThan(vertexCount);
    }
  });

  it('uses only layers that exist in the texture array', () => {
    const layers = Object.values(TextureLayer);

    for (let i = 0; i < vertexCount; i++) {
      expect(layers).toContain(readVertex(mesh.vertices, i).layer);
    }
  });

  it('stores unit-length normals', () => {
    for (let i = 0; i < vertexCount; i++) {
      const v = readVertex(mesh.vertices, i);
      expect(Math.hypot(v.nx, v.ny, v.nz)).toBeCloseTo(1, 4);
    }
  });

  /**
   * Backface culling je zapnutý, takže trojúhelník, jehož winding nesouhlasí
   * s uloženou normálou, by byl neviditelný ze strany, ke které má směřovat.
   */
  it('winds every triangle to agree with its stored normal', () => {
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = readVertex(mesh.vertices, mesh.indices[i] ?? 0);
      const b = readVertex(mesh.vertices, mesh.indices[i + 1] ?? 0);
      const c = readVertex(mesh.vertices, mesh.indices[i + 2] ?? 0);

      const geometric = cross([b.x - a.x, b.y - a.y, b.z - a.z], [c.x - a.x, c.y - a.y, c.z - a.z]);
      const len = Math.hypot(...geometric);

      expect(len).toBeGreaterThan(0);
      // Stejný směr jako normála, se kterou bude shader osvětlovat.
      const alignment =
        (geometric[0] / len) * a.nx + (geometric[1] / len) * a.ny + (geometric[2] / len) * a.nz;
      expect(alignment).toBeCloseTo(1, 3);
    }
  });

  it('stores an orthonormal tangent frame', () => {
    for (let i = 0; i < vertexCount; i++) {
      const v = readVertex(mesh.vertices, i);

      expect(Math.hypot(v.tx, v.ty, v.tz)).toBeCloseTo(1, 4);
      // Tangenta mimo rovinu povrchu by zkreslila celou TBN bázi.
      expect(dot(v, [v.tx, v.ty, v.tz])).toBeCloseTo(0, 4);
      expect(Math.abs(v.handedness)).toBe(1);
    }
  });

  /**
   * Tangent frame musí popisovat, kam ve world space míří osy textury.
   * Kontrola vůči vlastním UV quadu zachytí frame, který je otočený nebo
   * zrcadlený, což by osvětlilo normal-mapované detaily ze špatné strany.
   * Ověřuje se jako vlastnost, ne opětovným odvozením řešení.
   */
  it('aligns the tangent frame with the direction the UVs increase', () => {
    // Quady se vytvářejí jako čtyři po sobě jdoucí vrcholy.
    for (let base = 0; base < vertexCount; base += 4) {
      const corners = [0, 1, 2, 3].map((i) => readVertex(mesh.vertices, base + i));
      const c0 = corners[0];
      if (!c0) throw new Error('expected four corners');

      const tangent: [number, number, number] = [c0.tx, c0.ty, c0.tz];
      const bitangent = cross([c0.nx, c0.ny, c0.nz], tangent).map((n) => n * c0.handedness) as [
        number,
        number,
        number,
      ];

      expect(alignedWith(corners, 'u', tangent)).toBe(true);
      expect(alignedWith(corners, 'v', bitangent)).toBe(true);
    }
  });
});

describe('building walls', () => {
  /** Jedna samostatná budova, takže každá stěna má na vnější straně volný prostor. */
  const building: Building = {
    footprint: { minX: 100, maxX: 112, minZ: 200, maxZ: 214 },
    height: 18,
    facade: TextureLayer.Brick,
    tint: [1, 1, 1],
  };

  const plot = { minX: 90, maxX: 130, minZ: 190, maxZ: 230 };
  const layout: CityLayout = {
    config: { ...DEFAULT_CITY_CONFIG, gridSize: 1 },
    blocks: [
      {
        plot,
        sidewalk: { minX: 86, maxX: 134, minZ: 186, maxZ: 234 },
        buildings: [building],
        isPlaza: false,
        isPark: false,
      },
    ],
    buildings: [building],
    trees: [],
    lamps: [],
    bounds: { minX: 0, minZ: 0, maxX: 240, maxZ: 240 },
    pitch: DEFAULT_CITY_CONFIG.blockSize + DEFAULT_CITY_CONFIG.streetWidth,
  };

  const mesh = buildCityMesh(layout);

  it('points all four facades away from the building', () => {
    const { footprint } = building;
    const centreX = (footprint.minX + footprint.maxX) / 2;
    const centreZ = (footprint.minZ + footprint.maxZ) / 2;
    const seen = new Set<string>();

    for (let i = 0; i < mesh.vertices.length / FLOATS_PER_VERTEX; i++) {
      const v = readVertex(mesh.vertices, i);

      // Rohy fasády jsou jediné vrcholy ve výšce střechy s normálou do strany;
      // quady obrubníku a země leží hluboko pod nimi.
      if (Math.abs(v.ny) > 0.01 || v.y < building.height - 0.01) continue;

      // Ven znamená, že normála má kladnou složku ve směru vektoru
      // od středu budovy k tomuto rohu.
      const away = v.nx * (v.x - centreX) + v.nz * (v.z - centreZ);
      expect(away).toBeGreaterThan(0);

      seen.add(`${v.nx.toFixed(2)},${v.nz.toFixed(2)}`);
    }

    expect(seen.size).toBe(4);
  });

  it('caps the building with an up-facing roof at its full height', () => {
    const roof: Vertex[] = [];

    for (let i = 0; i < mesh.vertices.length / FLOATS_PER_VERTEX; i++) {
      const v = readVertex(mesh.vertices, i);
      if (v.layer === TextureLayer.Roof) roof.push(v);
    }

    expect(roof).toHaveLength(4);
    for (const v of roof) {
      expect(v.y).toBeCloseTo(building.height);
      expect(v.ny).toBeCloseTo(1);
    }
  });
});
