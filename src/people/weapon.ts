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
  /** Jednotky modelu na metry. */
  scale: number;
  /** +1, pokud hlaveň míří podél +Z modelu, -1 pro -Z. */
  forward: number;
}

/** Otočí model tak, aby hlaveň mířila podél +Z. */
const barrelForward = (weapon: WeaponModel): Mat4 =>
  weapon.forward < 0 ? rotationY(Math.PI) : identity();

/** Kde je pistole v záběru: nízko a vpravo, odhozená dozadu a nahoru podle `kick`. */
const HOLD = { right: 0.16, down: 0.16, ahead: 0.4 };

/**
 * Pistole z pohledu první osoby, pevně spojená s kamerou. Rotace o pi - yaw
 * natočí +Z do směru vpřed kamery a +X modelu pak leží nalevo od ní.
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
 * Pistole v pravé pěsti postavy, ve vlastním prostoru paže: na konci paže,
 * hlaveň vede podél ní, takže zvednutí paže ji namíří.
 * `bodyScale` je vlastní měřítko modelu postavy, které už paže nese.
 */
export function gripTransform(weapon: WeaponModel, bodyScale: number): Mat4 {
  // Kenneyho kostičkové paže visí jednotku modelu pod ramenem, pěst na konci.
  const fist = translate(-0.2, -0.95, 0);
  const alongArm = rotationX(Math.PI / 2);
  return multiply(
    multiply(multiply(fist, alongArm), scaling(weapon.scale / bodyScale)),
    barrelForward(weapon),
  );
}
