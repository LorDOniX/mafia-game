import type { Vec3 } from '@/math/vec3';
import type { Mat4 } from '@/math/mat4';
import lightsSource from '@/shaders/lights.glsl?raw';

/** Nejvíc světel ve scéně; pixel ale počítá jen ta ze svého clusteru. */
export const MAX_LIGHTS = 256;

/** Dlaždice obrazovky na šířku a výšku a hloubkové řezy záběru. */
export const CLUSTERS = { x: 16, y: 9, z: 24 } as const;
const CLUSTER_COUNT = CLUSTERS.x * CLUSTERS.y * CLUSTERS.z;
/** Řezy rostou exponenciálně od `NEAR` do `FAR` metrů; dál už žádné světlo nesvítí. */
const CLUSTER_NEAR = 1;
const CLUSTER_FAR = 400;
const SLICE_SCALE = CLUSTERS.z / Math.log(CLUSTER_FAR / CLUSTER_NEAR);
const SLICE_BIAS = -Math.log(CLUSTER_NEAR) * SLICE_SCALE;
/** Seznam indexů světel všech clusterů; co se nevejde, se zahodí. */
const INDEX_WIDTH = 1024;
const INDEX_ROWS = 128;
const MAX_INDICES = INDEX_WIDTH * INDEX_ROWS;
/** Texturové jednotky vyhrazené pro světla, mimo ty, které používají materiály. */
const DATA_UNIT = 4;
const CLUSTERS_UNIT = 5;
const INDICES_UNIT = 6;

export type RGB = readonly [number, number, number];

/** Kužel světla: pouliční lampy míří dolů, světlomety dopředu. */
export interface SpotLight {
  position: Vec3;
  /** Jednotkový vektor podél středu kužele. */
  direction: Vec3;
  /** Barva krát intenzita; jas klesá se čtvercem vzdálenosti. */
  color: RGB;
  /** Za touto vzdáleností, v metrech, už světlo nedosáhne vůbec nic. */
  range: number;
  /** Poloviční úhly, radiány: plná síla uvnitř `inner`, slábne až k nule u `outer`. */
  inner: number;
  outer: number;
}

/** Vloží sdílený kód bodových světel do fragment shaderu na místo řádku s include. */
export function withLights(source: string): string {
  const marker = '#include "lights.glsl"';
  if (!source.includes(marker)) throw new Error('Shader has no lights include');
  const defines = [
    `#define CLUSTERS_X ${CLUSTERS.x}`,
    `#define CLUSTERS_Y ${CLUSTERS.y}`,
    `#define CLUSTERS_Z ${CLUSTERS.z}`,
    `#define INDEX_WIDTH ${INDEX_WIDTH}`,
  ].join('\n');
  return source.replace(marker, `${defines}\n${lightsSource}`);
}

/**
 * `max` světel nejbližších k `from`, ztlumených směrem k okraji vybrané sady.
 *
 * Do shaderu se vejde jen omezený počet světel, takže se s pohybem kamery mění,
 * která jsou zapnutá; postupné ztlumení těch nejvzdálenějších znamená, že světlo,
 * které se přidá nebo odebere, je v tu chvíli už tmavé, místo aby náhle bliklo.
 */
export function nearestLights(
  lights: readonly SpotLight[],
  from: Vec3,
  max: number,
): SpotLight[] {
  if (max <= 0) return [];

  const ranked = lights
    .map((light) => ({ light, distance: Math.hypot(light.position.x - from.x, light.position.z - from.z) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length <= max) return ranked.map(({ light }) => light);

  const edge = ranked[max]?.distance ?? Infinity;
  const fadeFrom = edge * 0.75;
  return ranked.slice(0, max).map(({ light, distance }) => {
    const fade = Math.min(Math.max((edge - distance) / (edge - fadeFrom || 1), 0), 1);
    return fade >= 1
      ? light
      : { ...light, color: [light.color[0] * fade, light.color[1] * fade, light.color[2] * fade] };
  });
}

/**
 * Světla, jejichž koule dosahu zasahuje do záběru kamery a neleží dál než
 * `maxDistance` od `eye`. Ostatní nemohou osvětlit žádný viditelný pixel, takže
 * by ve shaderu jen zabírala sloty. `viewProjection` je column-major jako ve WebGL.
 */
export function visibleLights(
  lights: readonly SpotLight[],
  viewProjection: Mat4,
  eye: Vec3,
  maxDistance = Infinity,
): SpotLight[] {
  const m = viewProjection;
  const row = (i: number): number[] => [0, 4, 8, 12].map((k) => m[k + i] ?? 0);
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
  // Levá, pravá, dolní, horní, blízká a vzdálená rovina (Gribb–Hartmann).
  const planes = [r0, r0, r1, r1, r2, r2].map((r, i) => {
    const sign = i % 2 === 0 ? 1 : -1;
    const p = r3.map((w, k) => w + sign * (r[k] ?? 0));
    const length = Math.hypot(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0) || 1;
    return p.map((v) => v / length);
  });

  return lights.filter(
    ({ position: { x, y, z }, range }) =>
      Math.hypot(x - eye.x, y - eye.y, z - eye.z) - range < maxDistance &&
      planes.every(([a = 0, b = 0, c = 0, d = 0]) => a * x + b * y + c * z + d > -range),
  );
}

/** Co clustery potřebují vědět o kameře; `view` už musí být aktuální. */
export interface ClusterCamera {
  view: Mat4;
  /** Svislé zorné pole, radiány. */
  fov: number;
  aspect: number;
}

/** Index řezu pro hloubku v metrech, stejně jako v lights.glsl. */
export const sliceOf = (depth: number): number =>
  depth <= 0
    ? 0
    : Math.min(Math.max(Math.floor(Math.log(depth) * SLICE_SCALE + SLICE_BIAS), 0), CLUSTERS.z - 1);

/** Kde řez začíná, metry; první sahá až ke kameře. */
const sliceStart = (slice: number): number =>
  slice <= 0 ? 0 : Math.exp((slice - SLICE_BIAS) / SLICE_SCALE);

/** Dlaždice, do které padne souřadnice v NDC, oříznutá na mřížku. */
const tileOf = (ndc: number, tiles: number): number =>
  Math.min(Math.max(Math.floor(((ndc + 1) / 2) * tiles), 0), tiles - 1);

/**
 * Clustered lighting: záběr se rozdělí na dlaždice obrazovky krát hloubkové řezy
 * a CPU ke každému clusteru zapíše jen světla, jejichž koule dosahu do něj
 * zasahuje. Pixel pak prochází pár světel svého clusteru místo všech ve scéně.
 * Data jdou do shaderu ve float texturách, které čte lights.glsl.
 */
export class LightBuffer {
  /** Tři řádky po MAX_LIGHTS texelech RGBA: pozice+dosah, osa+cos vnějšího, barva+cos vnitřního. */
  readonly data = new Float32Array(MAX_LIGHTS * 3 * 4);
  /** Pro každý cluster začátek a počet jeho světel v `indices`. */
  readonly clusters = new Float32Array(CLUSTER_COUNT * 2);
  readonly indices = new Float32Array(MAX_INDICES);
  count = 0;
  indexCount = 0;

  private readonly lists: number[][] = Array.from({ length: CLUSTER_COUNT }, () => []);
  private readonly depthRow = new Float32Array([0, 0, -1, 0]);
  private width = 1;
  private height = 1;
  private textures: { data: WebGLTexture; clusters: WebGLTexture; indices: WebGLTexture } | null =
    null;
  private dirty = true;

  /** Zabalí světla a roztřídí je do clusterů pro kameru a viewport `width` x `height`. */
  set(lights: readonly SpotLight[], camera: ClusterCamera, width = 1, height = 1): void {
    const v = camera.view;
    this.width = width;
    this.height = height;
    this.depthRow.set([v[2] ?? 0, v[6] ?? 0, v[10] ?? 0, v[14] ?? 0]);
    for (const list of this.lists) list.length = 0;

    const tanY = Math.tan(camera.fov / 2);
    const tanX = tanY * camera.aspect;
    const row = MAX_LIGHTS * 4;
    this.count = Math.min(lights.length, MAX_LIGHTS);

    for (let i = 0; i < this.count; i++) {
      const light = lights[i];
      if (!light) continue;
      const { position: p, direction: d, color: c, range } = light;
      const o = i * 4;
      this.data.set([p.x, p.y, p.z, range], o);
      this.data.set([d.x, d.y, d.z, Math.cos(light.outer)], row + o);
      this.data.set([c[0], c[1], c[2], Math.cos(light.inner)], 2 * row + o);

      const x = (v[0] ?? 0) * p.x + (v[4] ?? 0) * p.y + (v[8] ?? 0) * p.z + (v[12] ?? 0);
      const y = (v[1] ?? 0) * p.x + (v[5] ?? 0) * p.y + (v[9] ?? 0) * p.z + (v[13] ?? 0);
      const depth = -((v[2] ?? 0) * p.x + (v[6] ?? 0) * p.y + (v[10] ?? 0) * p.z + (v[14] ?? 0));
      this.bin(i, x, y, depth, range, tanX, tanY);
    }

    let offset = 0;
    this.lists.forEach((list, cluster) => {
      const n = Math.min(list.length, MAX_INDICES - offset);
      this.clusters[cluster * 2] = offset;
      this.clusters[cluster * 2 + 1] = n;
      for (let k = 0; k < n; k++) this.indices[offset + k] = list[k] ?? 0;
      offset += n;
    });
    this.indexCount = offset;
    this.dirty = true;
  }

  /** Světla, která CPU přiřadilo clusteru; pro testy a ladění. */
  lightsIn(tileX: number, tileY: number, slice: number): number[] {
    const cluster = (slice * CLUSTERS.y + tileY) * CLUSTERS.x + tileX;
    const offset = this.clusters[cluster * 2] ?? 0;
    const count = this.clusters[cluster * 2 + 1] ?? 0;
    return Array.from(this.indices.subarray(offset, offset + count));
  }

  /**
   * Zapíše světlo do každého clusteru, který jeho koule může zasáhnout. V každém
   * řezu stačí průřez koule tím řezem a jeho průmět na obrazovku je extrémní
   * na bližší nebo vzdálenější stěně řezu, takže se testují jen ty dvě.
   */
  private bin(
    light: number,
    x: number,
    y: number,
    depth: number,
    range: number,
    tanX: number,
    tanY: number,
  ): void {
    const near = Math.max(depth - range, 0);
    const far = Math.min(depth + range, CLUSTER_FAR);
    if (far <= 0 || near >= CLUSTER_FAR) return;

    for (let slice = sliceOf(near); slice <= sliceOf(far); slice++) {
      // Pixely těsně před kamerou by dělení hloubkou vyhnaly do nekonečna.
      const lo = Math.max(sliceStart(slice), near, 0.05);
      const hi = Math.min(sliceStart(slice + 1), far);
      if (hi <= lo) continue;

      const gap = depth < lo ? lo - depth : depth > hi ? depth - hi : 0;
      const r = Math.sqrt(Math.max(range * range - gap * gap, 0));
      const minX = Math.min((x - r) / (lo * tanX), (x - r) / (hi * tanX));
      const maxX = Math.max((x + r) / (lo * tanX), (x + r) / (hi * tanX));
      const minY = Math.min((y - r) / (lo * tanY), (y - r) / (hi * tanY));
      const maxY = Math.max((y + r) / (lo * tanY), (y + r) / (hi * tanY));
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) continue;

      const x1 = tileOf(maxX, CLUSTERS.x);
      const y1 = tileOf(maxY, CLUSTERS.y);
      for (let ty = tileOf(minY, CLUSTERS.y); ty <= y1; ty++) {
        const base = (slice * CLUSTERS.y + ty) * CLUSTERS.x;
        for (let tx = tileOf(minX, CLUSTERS.x); tx <= x1; tx++) this.lists[base + tx]?.push(light);
      }
    }
  }

  /** Nahraje data (jednou za snímek) a naváže je k uniformům právě používaného programu. */
  upload(gl: WebGL2RenderingContext, uniforms: Record<string, WebGLUniformLocation>): void {
    const textures = (this.textures ??= {
      data: createFloatTexture(gl, gl.RGBA32F, MAX_LIGHTS, 3),
      clusters: createFloatTexture(gl, gl.RG32F, CLUSTERS.x * CLUSTERS.y, CLUSTERS.z),
      indices: createFloatTexture(gl, gl.R32F, INDEX_WIDTH, INDEX_ROWS),
    });

    gl.activeTexture(gl.TEXTURE0 + DATA_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, textures.data);
    if (this.dirty) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_LIGHTS, 3, gl.RGBA, gl.FLOAT, this.data);
    }
    gl.activeTexture(gl.TEXTURE0 + CLUSTERS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, textures.clusters);
    if (this.dirty) {
      const w = CLUSTERS.x * CLUSTERS.y;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, CLUSTERS.z, gl.RG, gl.FLOAT, this.clusters);
    }
    gl.activeTexture(gl.TEXTURE0 + INDICES_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, textures.indices);
    const rows = Math.ceil(this.indexCount / INDEX_WIDTH);
    if (this.dirty && rows > 0) {
      const used = this.indices.subarray(0, rows * INDEX_WIDTH);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, INDEX_WIDTH, rows, gl.RED, gl.FLOAT, used);
    }
    gl.activeTexture(gl.TEXTURE0);
    this.dirty = false;

    if (uniforms['u_lightData']) gl.uniform1i(uniforms['u_lightData'], DATA_UNIT);
    if (uniforms['u_lightClusters']) gl.uniform1i(uniforms['u_lightClusters'], CLUSTERS_UNIT);
    if (uniforms['u_lightIndices']) gl.uniform1i(uniforms['u_lightIndices'], INDICES_UNIT);
    if (uniforms['u_clusterDepth']) gl.uniform4fv(uniforms['u_clusterDepth'], this.depthRow);
    if (uniforms['u_clusterParams']) {
      gl.uniform4f(
        uniforms['u_clusterParams'],
        1 / this.width,
        1 / this.height,
        SLICE_SCALE,
        SLICE_BIAS,
      );
    }
  }
}

/** Float textura čená jen přes texelFetch, takže bez filtrování a mipmap. */
function createFloatTexture(
  gl: WebGL2RenderingContext,
  format: number,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create light texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
