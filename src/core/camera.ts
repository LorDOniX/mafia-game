import { lookAt, perspective, type Mat4 } from '@/math/mat4';
import { multiply } from '@/math/mat4';
import { add, vec3, type Vec3 } from '@/math/vec3';

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * Yaw/pitch camera. Yaw is measured from -Z and grows clockwise seen from
 * above, so yaw 0 / pitch 0 looks straight down -Z with +X to the right.
 */
export class Camera {
  position: Vec3 = vec3();
  yaw = 0;
  pitch = 0;

  fov = (65 * Math.PI) / 180;
  near = 0.1;
  far = 2000;
  aspect = 1;

  readonly view: Mat4 = new Float32Array(16);
  readonly projection: Mat4 = new Float32Array(16);
  readonly viewProjection: Mat4 = new Float32Array(16);

  /** Unit vector the camera is looking along. */
  forward(): Vec3 {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  /** Forward flattened onto the ground plane — what walking should follow. */
  groundForward(): Vec3 {
    return { x: Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) };
  }

  groundRight(): Vec3 {
    return { x: Math.cos(this.yaw), y: 0, z: Math.sin(this.yaw) };
  }

  /** Field of view across the screen width; `fov` is the vertical one. */
  horizontalFov(): number {
    return 2 * Math.atan(Math.tan(this.fov / 2) * this.aspect);
  }

  addLook(deltaYaw: number, deltaPitch: number): void {
    this.yaw = (this.yaw + deltaYaw) % (Math.PI * 2);
    this.pitch = Math.min(Math.max(this.pitch + deltaPitch, -MAX_PITCH), MAX_PITCH);
  }

  /** Recomputes view/projection. Call once per frame after moving. */
  update(): void {
    perspective(this.fov, this.aspect, this.near, this.far, this.projection);
    lookAt(this.position, add(this.position, this.forward()), UP, this.view);
    multiply(this.projection, this.view, this.viewProjection);
  }
}
