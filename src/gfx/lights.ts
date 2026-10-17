import type { Vec3 } from '@/math/vec3';
import lightsSource from '@/shaders/lights.glsl?raw';

/** Must match MAX_LIGHTS in lights.glsl. */
export const MAX_LIGHTS = 32;

export type RGB = readonly [number, number, number];

/** A cone of light: street lamps pointing down, headlights pointing ahead. */
export interface SpotLight {
  position: Vec3;
  /** Unit vector along the middle of the cone. */
  direction: Vec3;
  /** Colour times intensity; brightness falls off with the square of distance. */
  color: RGB;
  /** Beyond this, metres, the light reaches nothing at all. */
  range: number;
  /** Half-angles, radians: full strength inside `inner`, fading to zero at `outer`. */
  inner: number;
  outer: number;
}

/** Splices the shared spot-light code into a fragment shader at its include line. */
export function withLights(source: string): string {
  const marker = '#include "lights.glsl"';
  if (!source.includes(marker)) throw new Error('Shader has no lights include');
  return source.replace(marker, lightsSource);
}

/**
 * The `max` lights nearest `from`, dimmed toward the edge of the chosen set.
 *
 * Only so many lights fit in a shader, so which ones are on changes as the
 * camera moves; fading the farthest ones out first means a light swapped in or
 * out is already dark at that moment, rather than popping.
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

/** Packs lights into the three vec4 arrays lights.glsl reads. */
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
