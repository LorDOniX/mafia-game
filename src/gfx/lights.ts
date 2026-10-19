import type { Vec3 } from '@/math/vec3';
import type { Mat4 } from '@/math/mat4';
import lightsSource from '@/shaders/lights.glsl?raw';

/** Musí odpovídat MAX_LIGHTS v lights.glsl. */
export const MAX_LIGHTS = 32;

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
  return source.replace(marker, lightsSource);
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

/** Zabalí světla do tří polí vec4, která čte lights.glsl. */
export class LightBuffer {
  readonly position = new Float32Array(MAX_LIGHTS * 4);
  readonly direction = new Float32Array(MAX_LIGHTS * 4);
  readonly color = new Float32Array(MAX_LIGHTS * 4);
  count = 0;

  set(lights: readonly SpotLight[]): void {
    this.count = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < this.count; i++) {
      const light = lights[i];
      if (!light) continue;
      const o = i * 4;
      this.position.set([light.position.x, light.position.y, light.position.z, light.range], o);
      this.direction.set(
        [light.direction.x, light.direction.y, light.direction.z, Math.cos(light.outer)],
        o,
      );
      this.color.set([light.color[0], light.color[1], light.color[2], Math.cos(light.inner)], o);
    }
  }

  upload(gl: WebGL2RenderingContext, uniforms: Record<string, WebGLUniformLocation>): void {
    const count = uniforms['u_lightCount'];
    if (count) gl.uniform1i(count, this.count);
    if (this.count === 0) return;

    const position = uniforms['u_lightPos[0]'];
    const direction = uniforms['u_lightDir[0]'];
    const color = uniforms['u_lightColor[0]'];
    if (position) gl.uniform4fv(position, this.position);
    if (direction) gl.uniform4fv(direction, this.direction);
    if (color) gl.uniform4fv(color, this.color);
  }
}
