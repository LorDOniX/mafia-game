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
