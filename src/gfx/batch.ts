import { FLOATS_PER_MODEL_VERTEX, type ModelData } from './gltf';
import { identity, multiply, type Mat4 } from '@/math/mat4';

/**
 * Merges many placements of one model into a single static model, so a
 * thousand trees cost one draw per part instead of one per tree.
 *
 * Normals go through the same matrix, so transforms must be rotations,
 * translations and uniform scales only.
 */
export function bakeInstances(data: ModelData, transforms: readonly Mat4[]): ModelData {
  const F = FLOATS_PER_MODEL_VERTEX;

  const parts = data.parts.map((part) => {
    const count = part.vertices.length / F;
    const vertices = new Float32Array(part.vertices.length * transforms.length);
    const indices = new Uint32Array(part.indices.length * transforms.length);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    transforms.forEach((transform, k) => {
      const m = multiply(transform, part.matrix);
      const at = (i: number): number => m[i] ?? 0;
      const [m0, m1, m2, m4, m5, m6, m8, m9, m10, m12, m13, m14] = [
        at(0),
        at(1),
        at(2),
        at(4),
        at(5),
        at(6),
        at(8),
        at(9),
        at(10),
        at(12),
        at(13),
        at(14),
      ];
      const out = k * part.vertices.length;

      for (let i = 0; i < count; i++) {
        const src = i * F;
        const dst = out + src;
        const x = part.vertices[src] ?? 0;
        const y = part.vertices[src + 1] ?? 0;
        const z = part.vertices[src + 2] ?? 0;
        const nx = part.vertices[src + 3] ?? 0;
        const ny = part.vertices[src + 4] ?? 0;
        const nz = part.vertices[src + 5] ?? 0;

        const px = m0 * x + m4 * y + m8 * z + m12;
        const py = m1 * x + m5 * y + m9 * z + m13;
        const pz = m2 * x + m6 * y + m10 * z + m14;
        const tx = m0 * nx + m4 * ny + m8 * nz;
        const ty = m1 * nx + m5 * ny + m9 * nz;
        const tz = m2 * nx + m6 * ny + m10 * nz;
        const length = Math.hypot(tx, ty, tz) || 1;

        vertices[dst] = px;
        vertices[dst + 1] = py;
        vertices[dst + 2] = pz;
        vertices[dst + 3] = tx / length;
        vertices[dst + 4] = ty / length;
        vertices[dst + 5] = tz / length;
        vertices[dst + 6] = part.vertices[src + 6] ?? 0;
        vertices[dst + 7] = part.vertices[src + 7] ?? 0;

        min.x = Math.min(min.x, px);
        min.y = Math.min(min.y, py);
        min.z = Math.min(min.z, pz);
        max.x = Math.max(max.x, px);
        max.y = Math.max(max.y, py);
        max.z = Math.max(max.z, pz);
      }

      const base = k * count;
      const first = k * part.indices.length;
      for (let i = 0; i < part.indices.length; i++) {
        indices[first + i] = (part.indices[i] ?? 0) + base;
      }
    });

    return { ...part, matrix: identity(), vertices, indices, min, max };
  });

  return { ...data, parts };
}
