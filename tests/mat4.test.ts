import { describe, expect, it } from 'vitest';
import { identity, multiply, ortho } from '@/math/mat4';

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
});
