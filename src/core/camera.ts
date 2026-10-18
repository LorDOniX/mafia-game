import { lookAt, perspective, type Mat4 } from '@/math/mat4';
import { multiply } from '@/math/mat4';
import { add, vec3, type Vec3 } from '@/math/vec3';

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * Kamera s yaw/pitch. Yaw se měří od -Z a při pohledu shora roste ve směru
 * hodinových ručiček, takže yaw 0 / pitch 0 hledí přímo podél -Z a +X je vpravo.
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

  /** Jednotkový vektor, podél kterého se kamera dívá. */
  forward(): Vec3 {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  /** Směr vpřed zploštěný do roviny země — ten má sledovat chůze. */
  groundForward(): Vec3 {
    return { x: Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) };
  }

  groundRight(): Vec3 {
    return { x: Math.cos(this.yaw), y: 0, z: Math.sin(this.yaw) };
  }

  /** Zorné pole přes šířku obrazovky; `fov` je to svislé. */
  horizontalFov(): number {
    return 2 * Math.atan(Math.tan(this.fov / 2) * this.aspect);
  }

  addLook(deltaYaw: number, deltaPitch: number): void {
    this.yaw = (this.yaw + deltaYaw) % (Math.PI * 2);
    this.pitch = Math.min(Math.max(this.pitch + deltaPitch, -MAX_PITCH), MAX_PITCH);
  }

  /** Přepočítá view/projection. Volat jednou za snímek po pohybu. */
  update(): void {
    perspective(this.fov, this.aspect, this.near, this.far, this.projection);
    lookAt(this.position, add(this.position, this.forward()), UP, this.view);
    multiply(this.projection, this.view, this.viewProjection);
  }
}
