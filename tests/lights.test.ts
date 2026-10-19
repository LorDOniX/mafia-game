import { describe, expect, it } from 'vitest';
import { generateCity, rectContains } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import { createLampModel, lampLight, lampTransform } from '@/city/lamp';
import { FLOATS_PER_MODEL_VERTEX } from '@/gfx/gltf';
import {
  LightBuffer,
  MAX_LIGHTS,
  nearestLights,
  visibleLights,
  withLights,
  type SpotLight,
} from '@/gfx/lights';
import { AdaptiveResolution } from '@/gfx/resolution';
import { Camera } from '@/core/camera';
import { transformPoint } from '@/math/mat4';

const city = generateCity();

const light = (x: number, z: number): SpotLight => ({
  position: { x, y: 5, z },
  direction: { x: 0, y: -1, z: 0 },
  color: [10, 10, 10],
  range: 20,
  inner: 0.5,
  outer: 1,
});

describe('street lamps', () => {
  it('stand on a sidewalk, off the carriageway, on every block', () => {
    expect(city.lamps.length).toBeGreaterThanOrEqual(city.blocks.length * 4);
    for (const lamp of city.lamps) {
      expect(city.blocks.some((b) => rectContains(b.sidewalk, lamp.x, lamp.z))).toBe(true);
      for (const tree of city.trees.filter((t) => t.kind === 'street')) {
        expect(Math.hypot(tree.x - lamp.x, tree.z - lamp.z)).toBeGreaterThan(3);
      }
    }
  });

  it('hang their light out over the road, outside every plot', () => {
    for (const lamp of city.lamps) {
      const { position } = lampLight(lamp, 0.15);
      expect(city.blocks.some((b) => rectContains(b.plot, position.x, position.z))).toBe(false);
      expect(position.y).toBeGreaterThan(4);
    }
  });

  it('have posts you cannot walk through', () => {
    const collision = new CityCollision(city);
    const lamp = city.lamps[0];
    if (!lamp) throw new Error('no lamps');
    expect(collision.overlaps(lamp.x, lamp.z, 0.05)).toBe(true);
  });

  it('builds glowing glass whose faces point outward', () => {
    const glass = createLampModel().parts.find((p) => p.name === 'glass');
    if (!glass) throw new Error('no glass');
    expect(glass.emissive.some((c) => c > 0)).toBe(true);
    expect(glass.indices.length % 3).toBe(0);

    const centre = {
      x: (glass.min.x + glass.max.x) / 2,
      y: (glass.min.y + glass.max.y) / 2,
      z: (glass.min.z + glass.max.z) / 2,
    };
    for (let o = 0; o < glass.vertices.length; o += FLOATS_PER_MODEL_VERTEX) {
      const [x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0] = glass.vertices.subarray(o, o + 6);
      // Ven: normála se naklání stejným směrem jako odsazení od středu boxu.
      expect((x - centre.x) * nx + (y - centre.y) * ny + (z - centre.z) * nz).toBeGreaterThan(0);
    }

    // Proti směru hodinových ručiček při pohledu zvenku, jinak back-face culling stěny sežere.
    const at = (i: number, k: number): number => glass.vertices[i * FLOATS_PER_MODEL_VERTEX + k] ?? 0;
    for (let t = 0; t < glass.indices.length; t += 3) {
      const [a = 0, b = 0, c = 0] = glass.indices.subarray(t, t + 3);
      const e1 = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)];
      const e2 = [at(c, 0) - at(a, 0), at(c, 1) - at(a, 1), at(c, 2) - at(a, 2)];
      const [e1x = 0, e1y = 0, e1z = 0] = e1;
      const [e2x = 0, e2y = 0, e2z = 0] = e2;
      const cross = [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
      const facing = (cross[0] ?? 0) * at(a, 3) + (cross[1] ?? 0) * at(a, 4) + (cross[2] ?? 0) * at(a, 5);
      expect(facing).toBeGreaterThan(0);
    }
  });

  it('turns the arm toward the road', () => {
    const lamp = city.lamps.find((l) => Math.abs(Math.sin(l.rotation)) < 1e-6);
    if (!lamp) throw new Error('no lamp facing along z');
    const tip = transformPoint(lampTransform(lamp, 0), { x: 0, y: 0, z: 1 });
    expect(tip.z - lamp.z).toBeCloseTo(Math.cos(lamp.rotation));
  });
});

describe('visibleLights', () => {
  const camera = new Camera();
  camera.aspect = 16 / 9;
  camera.update();

  it('keeps lights ahead and drops those well behind or too far', () => {
    const ahead = light(0, -50);
    const behind = light(0, 50);
    const far = light(0, -400);
    const all = [ahead, behind, far];
    expect(visibleLights(all, camera.viewProjection, camera.position, 250)).toEqual([ahead]);
  });

  it('keeps a light behind the camera whose reach spills into view', () => {
    const close = light(0, 10);
    expect(visibleLights([close], camera.viewProjection, camera.position)).toEqual([close]);
  });
});

describe('AdaptiveResolution', () => {
  const run = (res: AdaptiveResolution, fps: number, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / fps) res.update(1 / fps);
  };

  it('drops resolution while slow, then slowly recovers', () => {
    const res = new AdaptiveResolution();
    run(res, 35, 2.5);
    expect(res.scale).toBeCloseTo(0.8);
    run(res, 35, 20);
    expect(res.scale).toBeCloseTo(0.5);
    run(res, 60, 4.5);
    expect(res.scale).toBeCloseTo(0.55);
  });

  it('holds steady inside the comfort band', () => {
    const res = new AdaptiveResolution();
    res.scale = 0.7;
    run(res, 54, 10);
    expect(res.scale).toBeCloseTo(0.7);
  });
});

describe('nearestLights', () => {
  it('keeps all lights when there is room', () => {
    const lights = [light(0, 0), light(10, 0)];
    expect(nearestLights(lights, { x: 0, y: 0, z: 0 }, 4)).toEqual(lights);
  });

  it('keeps the nearest, fading the edge of the set out to nothing', () => {
    const lights = [light(100, 0), light(0, 0), light(39, 0), light(40, 0)];
    const chosen = nearestLights(lights, { x: 0, y: 0, z: 0 }, 3);

    expect(chosen.map((l) => l.position.x)).toEqual([0, 39, 40]);
    expect(chosen[0]?.color[0]).toBe(10);
    // Hranice je na 100, takže 39 a 40 mají stále plnou sílu.
    expect(chosen[2]?.color[0]).toBe(10);

    const tight = nearestLights([light(0, 0), light(95, 0), light(100, 0)], { x: 0, y: 0, z: 0 }, 2);
    // Hranice na 100, útlum od 75: světlo na 95 si ponechá pětinu své síly.
    expect(tight[1]?.color[0]).toBeCloseTo(2);
  });

  it('returns nothing for no slots', () => {
    expect(nearestLights([light(0, 0)], { x: 0, y: 0, z: 0 }, 0)).toEqual([]);
  });
});

describe('LightBuffer', () => {
  it('packs range and cone cosines into the w components', () => {
    const buffer = new LightBuffer();
    buffer.set([light(3, 4)]);

    expect(buffer.count).toBe(1);
    expect(Array.from(buffer.position.subarray(0, 4))).toEqual([3, 5, 4, 20]);
    expect(buffer.direction[3]).toBeCloseTo(Math.cos(1));
    expect(buffer.color[3]).toBeCloseTo(Math.cos(0.5));
  });

  it('caps at the shader limit', () => {
    const buffer = new LightBuffer();
    buffer.set(Array.from({ length: MAX_LIGHTS + 5 }, (_, i) => light(i, 0)));
    expect(buffer.count).toBe(MAX_LIGHTS);
  });
});

describe('withLights', () => {
  it('splices the light code in place of the include', () => {
    const source = withLights('#version 300 es\n#include "lights.glsl"\nvoid main() {}');
    expect(source).toContain('vec3 spotLights(');
    expect(source).toContain(`#define MAX_LIGHTS ${MAX_LIGHTS}`);
    expect(source).not.toContain('#include');
  });
});
