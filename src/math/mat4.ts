import { cross, dot, normalize, sub, type Vec3 } from './vec3';

/** Column-major 4x4 matrix, layout matches what WebGL expects. */
export type Mat4 = Float32Array;

export function identity(out: Mat4 = new Float32Array(16)): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
  out: Mat4 = new Float32Array(16),
): Mat4 {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

export function perspective(
  fovYRadians: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4 = new Float32Array(16),
): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Right-handed view matrix looking from `eye` toward `center`. */
export function lookAt(eye: Vec3, center: Vec3, up: Vec3, out: Mat4 = new Float32Array(16)): Mat4 {
  const z = normalize(sub(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  out[0] = x.x;
  out[1] = y.x;
  out[2] = z.x;
  out[3] = 0;
  out[4] = x.y;
  out[5] = y.y;
  out[6] = z.y;
  out[7] = 0;
  out[8] = x.z;
  out[9] = y.z;
  out[10] = z.z;
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

/** Copies `src` into `out` but zeroes the translation column. Used by the skybox. */
export function stripTranslation(src: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  out.set(src);
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

export function translate(x: number, y: number, z: number, out: Mat4 = identity()): Mat4 {
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

/** out = a * b */
export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function scaling(s: number, out: Mat4 = identity()): Mat4 {
  identity(out);
  out[0] = s;
  out[5] = s;
  out[10] = s;
  return out;
}

/** Rotation about +X. Positive angles turn +Y toward +Z. */
export function rotationX(angle: number, out: Mat4 = identity()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

/** Rotation about +Y. Positive angles turn +Z toward +X. */
export function rotationY(angle: number, out: Mat4 = identity()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

/** Rotation about +Z. Positive angles turn +X toward +Y. */
export function rotationZ(angle: number, out: Mat4 = identity()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identity(out);
  out[0] = c;
  out[1] = s;
  out[4] = -s;
  out[5] = c;
  return out;
}

/**
 * Translation * rotation * scale, the order glTF composes a node's TRS in.
 * `rotation` is a unit quaternion as [x, y, z, w].
 */
export function fromTRS(
  translation: readonly number[],
  rotation: readonly number[],
  scale: readonly number[],
  out: Mat4 = new Float32Array(16),
): Mat4 {
  const [x = 0, y = 0, z = 0, w = 1] = rotation;
  const [sx = 1, sy = 1, sz = 1] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = translation[0] ?? 0;
  out[13] = translation[1] ?? 0;
  out[14] = translation[2] ?? 0;
  out[15] = 1;
  return out;
}

/** Applies `m` to a point (w = 1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const at = (i: number): number => m[i] ?? 0;
  return {
    x: at(0) * p.x + at(4) * p.y + at(8) * p.z + at(12),
    y: at(1) * p.x + at(5) * p.y + at(9) * p.z + at(13),
    z: at(2) * p.x + at(6) * p.y + at(10) * p.z + at(14),
  };
}
