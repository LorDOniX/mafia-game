import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import { POLICE } from '@/city/assets';
import { createRng } from '@/core/rng';
import { parseGlb } from '@/gfx/gltf';
import { fitVehicle } from '@/vehicle/model';
import type { Vehicle } from '@/vehicle/vehicle';
import { laneOffset, randomLoop, RouteDriver } from '@/vehicle/traffic';

const layout = generateCity();
const collision = new CityCollision(layout);
const glb = readFileSync(fileURLToPath(new URL('../public/models/police.glb', import.meta.url)));
const { body } = fitVehicle(
  parseGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer),
  POLICE,
);

/** Points round the edge of the car's footprint. */
function outline(vehicle: Vehicle): Array<{ x: number; z: number }> {
  const f = vehicle.forward();
  const r = vehicle.right();
  const points = [];
  for (const along of [-0.5, -0.25, 0, 0.25, 0.5]) {
    for (const across of [-0.5, 0.5]) {
      const a = along * body.length;
      const c = across * body.width;
      points.push({ x: vehicle.x + f.x * a + r.x * c, z: vehicle.z + f.z * a + r.z * c });
    }
  }
  return points;
}

describe('randomLoop', () => {
  it('runs the straights down the middle of the right-hand lane', () => {
    const rng = createRng(7);
    const lane = laneOffset(layout);
    expect(lane).toBe(2);
    const offCentre = (c: number): number =>
      Math.abs(c - Math.round(c / layout.pitch) * layout.pitch);

    for (let n = 0; n < 20; n++) {
      const { points } = randomLoop(layout, rng);
      points.forEach((p, i) => {
        const q = points[(i + 1) % points.length] ?? p;
        // A straight is a long axis-aligned step between two turns.
        if (Math.hypot(q.x - p.x, q.z - p.z) < 10) return;
        if (Math.abs(p.x - q.x) < 1e-6) expect(offCentre(p.x)).toBeCloseTo(lane);
        else expect(offCentre(p.z)).toBeCloseTo(lane);
      });
    }
  });
});

describe('RouteDriver', () => {
  it('laps its loop on the carriageway, never touching a sidewalk', () => {
    const rng = createRng(42);
    for (let n = 0; n < 10; n++) {
      const route = randomLoop(layout, rng);
      const driver = RouteDriver.spawn(body, route, rng);
      const { vehicle } = driver;

      let travelled = 0;
      let onSidewalk = 0;
      for (let t = 0; travelled < route.length * 1.5 && t < 600; t += 1 / 60) {
        driver.update(1 / 60, collision);
        travelled += vehicle.speed / 60;
        if (outline(vehicle).some((p) => collision.groundHeightAt(p.x, p.z) > 0)) onSidewalk++;
      }

      expect(travelled).toBeGreaterThanOrEqual(route.length * 1.5);
      expect(onSidewalk).toBe(0);
    }
  });
});
