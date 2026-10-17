import { describe, expect, it } from 'vitest';
import { Camera } from '@/core/camera';
import { FirstPersonController } from '@/core/controller';
import type { Input } from '@/core/input';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';

/** Just enough of `Input` for the controller, with Space pressed on demand. */
function fakeInput(): { input: Input; press: (code: string) => void; endFrame: () => void } {
  const pressed = new Set<string>();
  const input = {
    pointerLocked: false,
    lookDelta: { x: 0, y: 0 },
    isDown: () => false,
    axis: () => 0,
    wasPressed: (code: string) => pressed.has(code),
  } as unknown as Input;
  return { input, press: (code) => pressed.add(code), endFrame: () => pressed.clear() };
}

describe('FirstPersonController jump', () => {
  const layout = generateCity();
  const collision = new CityCollision(layout);
  const spawn = Math.floor(layout.config.gridSize / 2) * layout.pitch;

  it('leaves the ground on Space and lands back at eye height', () => {
    const camera = new Camera();
    const { input, press, endFrame } = fakeInput();
    const controller = new FirstPersonController(camera, input, collision);
    controller.teleport(spawn, spawn);
    const eye = camera.position.y;

    press('Space');
    let peak = eye;
    for (let t = 0; t < 2; t += 1 / 60) {
      controller.update(1 / 60);
      endFrame();
      peak = Math.max(peak, camera.position.y);
    }

    expect(peak - eye).toBeGreaterThan(0.8);
    expect(peak - eye).toBeLessThan(1.3);
    expect(camera.position.y).toBeCloseTo(eye);
  });
});
