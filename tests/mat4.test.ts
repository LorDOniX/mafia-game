import { describe, expect, it } from 'vitest';
import {
  fromTRS,
  identity,
  multiply,
  ortho,
  rotationX,
  rotationY,
  transformPoint,
} from '@/math/mat4';

describe('mat4', () => {
  it('multiplying by identity is a no-op', () => {
    const m = ortho(-2, 2, -1, 1, -1, 1);
    const result = multiply(m, identity());
    // Elementwise: ortho emits -0 for zeroed translation terms, and toEqual
    // treats -0 and 0 as distinct.
    result.forEach((value, i) => expect(value).toBeCloseTo(m[i] ?? NaN));
  });

  it('ortho maps the right edge to +1 in clip space', () => {
    const m = ortho(-2, 2, -1, 1, -1, 1);
    expect(m[0]).toBeCloseTo(0.5);
    expect(m[5]).toBeCloseTo(1);
  });

  it('rotationY turns +Z toward +X, rotationX turns +Y toward +Z', () => {
    const z = transformPoint(rotationY(Math.PI / 2), { x: 0, y: 0, z: 1 });
    expect(z.x).toBeCloseTo(1);
    expect(z.z).toBeCloseTo(0);

    const y = transformPoint(rotationX(Math.PI / 2), { x: 0, y: 1, z: 0 });
    expect(y.y).toBeCloseTo(0);
    expect(y.z).toBeCloseTo(1);
  });

  it('fromTRS applies scale, then rotation, then translation', () => {
    // A quarter turn about Y as a quaternion.
    const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const m = fromTRS([10, 0, 0], q, [2, 2, 2]);
    const p = transformPoint(m, { x: 0, y: 0, z: 1 });

    expect(p.x).toBeCloseTo(12);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
    // Upper 3x3 is the rotation scaled by 2.
    const rotation = rotationY(Math.PI / 2);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
      expect(m[i] ?? NaN).toBeCloseTo(2 * (rotation[i] ?? NaN));
    }
  });
});
