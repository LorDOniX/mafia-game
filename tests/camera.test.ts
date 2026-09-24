import { describe, expect, it } from 'vitest';
import { Camera } from '@/core/camera';
import { dot, length } from '@/math/vec3';

describe('Camera basis', () => {
  it('looks down -Z at yaw 0', () => {
    const camera = new Camera();
    const forward = camera.forward();

    expect(forward.x).toBeCloseTo(0);
    expect(forward.y).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(-1);
  });

  it('turns toward +X as yaw grows', () => {
    const camera = new Camera();
    camera.yaw = Math.PI / 2;

    const forward = camera.forward();
    expect(forward.x).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);
  });

  it('keeps forward and right unit length and perpendicular', () => {
    const camera = new Camera();
    camera.yaw = 0.7;
    camera.pitch = 0.3;

    expect(length(camera.forward())).toBeCloseTo(1);
    expect(length(camera.groundRight())).toBeCloseTo(1);
    expect(dot(camera.groundForward(), camera.groundRight())).toBeCloseTo(0);
  });

  it('flattens ground movement even when looking up or down', () => {
    const camera = new Camera();
    camera.pitch = -1.2;

    expect(camera.groundForward().y).toBe(0);
    expect(length(camera.groundForward())).toBeCloseTo(1);
  });

  it('clamps pitch short of straight up and down', () => {
    const camera = new Camera();

    camera.addLook(0, 99);
    expect(camera.pitch).toBeLessThan(Math.PI / 2);

    camera.addLook(0, -99);
    expect(camera.pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it('projects a point in front of the camera into clip space', () => {
    const camera = new Camera();
    camera.aspect = 1;
    camera.position = { x: 0, y: 0, z: 0 };
    camera.update();

    const m = camera.viewProjection;
    const target = [0, 0, -10, 1];
    const clip = [0, 1, 2, 3].map((row) =>
      [0, 1, 2, 3].reduce((sum, col) => sum + (m[col * 4 + row] ?? 0) * (target[col] ?? 0), 0),
    );

    const w = clip[3] ?? 0;
    expect(w).toBeGreaterThan(0);
    // A point straight ahead lands at the centre of the screen.
    expect((clip[0] ?? 0) / w).toBeCloseTo(0);
    expect((clip[1] ?? 0) / w).toBeCloseTo(0);
  });
});
