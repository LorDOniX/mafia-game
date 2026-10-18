import type { Camera } from '@/core/camera';
import {
  identity,
  multiply,
  rotationX,
  rotationY,
  scaling,
  translate,
  type Mat4,
} from '@/math/mat4';

export interface WeaponModel {
  /** Model units to metres. */
  scale: number;
  /** +1 if the barrel points down the model's +Z, -1 for -Z. */
  forward: number;
}

/** Turns the model so its barrel points down +Z. */
const barrelForward = (weapon: WeaponModel): Mat4 =>
  weapon.forward < 0 ? rotationY(Math.PI) : identity();

/** Where the pistol sits in view: low and to the right, kicked back and up by `kick`. */
const HOLD = { right: 0.16, down: 0.16, ahead: 0.4 };

/**
 * The first-person pistol, fixed to the camera. Rotating by pi - yaw turns
 * +Z onto the camera's forward, and the model's +X then lies to its left.
 */
export function viewmodelTransform(camera: Camera, weapon: WeaponModel, kick: number): Mat4 {
  const { x, y, z } = camera.position;
  const view = multiply(
    multiply(translate(x, y, z), rotationY(Math.PI - camera.yaw)),
    rotationX(-camera.pitch),
  );
  const held = multiply(
    translate(-HOLD.right, -HOLD.down + kick * 0.02, HOLD.ahead - kick * 0.06),
    rotationX(-kick * 0.25),
  );
  return multiply(multiply(multiply(view, held), scaling(weapon.scale)), barrelForward(weapon));
}

/**
 * The pistol in a character's right fist, in the arm's own space: at the end
 * of the arm, barrel running along it, so raising the arm aims it.
 * `bodyScale` is the character model's own scale, which the arm already carries.
 */
export function gripTransform(weapon: WeaponModel, bodyScale: number): Mat4 {
  // Kenney's blocky arms hang a model unit down from the shoulder, fist at the end.
  const fist = translate(-0.2, -0.95, 0);
  const alongArm = rotationX(Math.PI / 2);
  return multiply(
    multiply(multiply(fist, alongArm), scaling(weapon.scale / bodyScale)),
    barrelForward(weapon),
  );
}
