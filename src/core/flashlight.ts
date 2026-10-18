import type { Camera } from './camera';
import type { SpotLight } from '@/gfx/lights';
import { HEADLIGHT_INTENSITY, HEADLIGHT_RANGE } from '@/vehicle/model';

/** Držena kousek pod úrovní očí, aby kužel nebyl plochý kotouč přesně uprostřed. */
const HAND_DROP = 0.3;
const COLOR: readonly [number, number, number] = [1.0, 0.97, 0.9];
const INNER = 0.12;
const OUTER = 0.35;

/** Baterka mířící tam, kam se dívá kamera, stejně silná a dalekosáhlá jako světlomet. */
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
