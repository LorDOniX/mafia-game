import type { Camera } from './camera';
import type { SpotLight } from '@/gfx/lights';
import { HEADLIGHT_INTENSITY, HEADLIGHT_RANGE } from '@/vehicle/model';

/** Held a little below eye level, so the beam is not a flat disc dead centre. */
const HAND_DROP = 0.3;
const COLOR: readonly [number, number, number] = [1.0, 0.97, 0.9];
const INNER = 0.12;
const OUTER = 0.35;

/** A torch pointing wherever the camera looks, as strong and far-reaching as a headlight. */
export function flashlight(camera: Camera): SpotLight {
  const { x, y, z } = camera.position;
  return {
    position: { x, y: y - HAND_DROP, z },
    direction: camera.forward(),
    color: [
      COLOR[0] * HEADLIGHT_INTENSITY,
      COLOR[1] * HEADLIGHT_INTENSITY,
      COLOR[2] * HEADLIGHT_INTENSITY,
    ],
    range: HEADLIGHT_RANGE,
    inner: INNER,
    outer: OUTER,
  };
}
