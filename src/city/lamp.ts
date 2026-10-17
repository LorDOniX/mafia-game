import { FLOATS_PER_MODEL_VERTEX, type ModelData, type ModelPart, type RGB, type RGBA } from '@/gfx/gltf';
import type { SpotLight } from '@/gfx/lights';
import { identity, multiply, rotationY, translate, type Mat4 } from '@/math/mat4';
import type { LampSpot } from './layout';

/**
 * A 1930s street lamp, built from boxes so it needs no art: a cast-iron post
 * with an arm reaching out over the road (model +Z) and a lantern hanging
 * from it. Swap in a glTF model later by building `ModelData` from that instead.
 */

const IRON: RGBA = [0.11, 0.11, 0.12, 1];
const GLASS: RGBA = [1.0, 0.93, 0.78, 1];
const GLOW: RGB = [1.0, 0.8, 0.5];

/** Where the bulb sits in model space: how far out along the arm, how high. */
const BULB_REACH = 1.25;
const BULB_HEIGHT = 4.6;

const LIGHT_COLOR: RGB = [1.0, 0.78, 0.45];
const LIGHT_INTENSITY = 100;
const LIGHT_RANGE = 34;
const LIGHT_INNER = (35 * Math.PI) / 180;
const LIGHT_OUTER = (70 * Math.PI) / 180;

type V3 = [number, number, number];

/** Outward normal axis and sign, then two tangent axes whose cross product is that normal. */
const FACES: ReadonlyArray<[number, number, number, number]> = [
  [0, 1, 1, 2],
  [0, -1, 2, 1],
  [1, 1, 2, 0],
  [1, -1, 0, 2],
  [2, 1, 0, 1],
  [2, -1, 1, 0],
];

export function createLampModel(): ModelData {
  const iron = part('iron', IRON, [0, 0, 0], [
    [[-0.2, 0, -0.2], [0.2, 0.5, 0.2]],
    [[-0.07, 0.5, -0.07], [0.07, 5.3, 0.07]],
    [[-0.04, 5.12, 0], [0.04, 5.22, BULB_REACH]],
    [[-0.3, 4.95, BULB_REACH - 0.3], [0.3, 5.12, BULB_REACH + 0.3]],
  ]);
  const glass = part('glass', GLASS, GLOW, [
    [[-0.2, 4.65, BULB_REACH - 0.2], [0.2, 4.95, BULB_REACH + 0.2]],
  ]);
  return { parts: [iron, glass], image: null, doubleSided: false };
}

/** Model-to-world for a lamp standing on the sidewalk. */
export function lampTransform(spot: LampSpot, groundY: number): Mat4 {
  return multiply(translate(spot.x, groundY, spot.z), rotationY(spot.rotation));
}

/** The pool of light a lamp casts, straight down from its lantern. */
export function lampLight(spot: LampSpot, groundY: number): SpotLight {
  return {
    position: {
      x: spot.x + Math.sin(spot.rotation) * BULB_REACH,
      y: groundY + BULB_HEIGHT,
      z: spot.z + Math.cos(spot.rotation) * BULB_REACH,
    },
    direction: { x: 0, y: -1, z: 0 },
    color: [
      LIGHT_COLOR[0] * LIGHT_INTENSITY,
      LIGHT_COLOR[1] * LIGHT_INTENSITY,
      LIGHT_COLOR[2] * LIGHT_INTENSITY,
    ],
    range: LIGHT_RANGE,
    inner: LIGHT_INNER,
    outer: LIGHT_OUTER,
  };
}

function part(name: string, baseColor: RGBA, emissive: RGB, boxes: Array<[V3, V3]>): ModelPart {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const [min, max] of boxes) {
    const centre: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const half: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];

    for (const [axis, sign, u, v] of FACES) {
      const base = vertices.length / FLOATS_PER_MODEL_VERTEX;
      const normal: V3 = [0, 0, 0];
      normal[axis] = sign;

      // Counter-clockwise seen from outside, since u x v points along the normal.
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p: V3 = [...centre];
        const offset = (k: number, by: number): void => {
          p[k] = (p[k] ?? 0) + by * (half[k] ?? 0);
        };
        offset(axis, sign);
        offset(u, su);
        offset(v, sv);
        vertices.push(...p, ...normal, 0, 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const xs = boxes.flatMap(([a, b]) => [a, b]);
  const bound = (k: 0 | 1 | 2, pick: (...n: number[]) => number): number => pick(...xs.map((p) => p[k]));
  return {
    name,
    matrix: identity(),
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    min: { x: bound(0, Math.min), y: bound(1, Math.min), z: bound(2, Math.min) },
    max: { x: bound(0, Math.max), y: bound(1, Math.max), z: bound(2, Math.max) },
    baseColor,
    emissive,
  };
}
