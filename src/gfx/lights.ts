import type { Vec3 } from '@/math/vec3';
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
