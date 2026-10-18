import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateCity } from '@/city/layout';
import { CityCollision, type Obstacle } from '@/city/collision';
import { TRAFFIC_CARS, trafficVehicleConfig } from '@/city/assets';
import { createRng } from '@/core/rng';
import { parseGlb } from '@/gfx/gltf';
import { fitVehicle } from '@/vehicle/model';
import type { Vehicle, VehicleBody } from '@/vehicle/vehicle';
import { buildRoadNetwork, Traffic, type Path } from '@/vehicle/traffic';

const layout = generateCity();
const collision = new CityCollision(layout);
const network = buildRoadNetwork(layout);

function bodyOf(url: string): VehicleBody {
  const glb = readFileSync(fileURLToPath(new URL(`../public${url}`, import.meta.url)));
  const model = parseGlb(
    glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer,
  );
  const entry = TRAFFIC_CARS.find((c) => c.url === url);
  if (!entry) throw new Error(`${url} is not a traffic car`);
  return fitVehicle(model, trafficVehicleConfig(entry)).body;
}

const sedan = bodyOf('/models-car/sedan.glb');
const firetruck = bodyOf('/models-car/firetruck.glb');

/** Rohy půdorysu v konvenci natočení vozidla. */
function corners(o: Obstacle): Array<{ x: number; z: number }> {
  const f = { x: Math.sin(o.heading), z: -Math.cos(o.heading) };
  const r = { x: Math.cos(o.heading), z: Math.sin(o.heading) };
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a = 0, c = 0]) => ({
    x: o.x + f.x * a * o.halfLength + r.x * c * o.halfWidth,
    z: o.z + f.z * a * o.halfLength + r.z * c * o.halfWidth,
  }));
}

/** Test oddělujících os pro dva půdorysy. */
function overlap(a: Obstacle, b: Obstacle): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const h of [a.heading, b.heading]) {
    for (const axis of [
      { x: Math.sin(h), z: -Math.cos(h) },
      { x: Math.cos(h), z: Math.sin(h) },
    ]) {
      const pa = ca.map((p) => p.x * axis.x + p.z * axis.z);
      const pb = cb.map((p) => p.x * axis.x + p.z * axis.z);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

function footprint(vehicle: Vehicle): Obstacle {
  return {
    x: vehicle.x,
    z: vehicle.z,
    heading: vehicle.heading,
    halfLength: vehicle.body.length / 2,
    halfWidth: vehicle.body.width / 2,
  };
}

/** Body vzorkované každého půl metru podél trasy, včetně natočení. */
function along(path: Path): Obstacle[] {
  const out: Obstacle[] = [];
  for (let i = 0; i + 1 < path.points.length; i++) {
    const a = path.points[i];
    const b = path.points[i + 1];
    if (!a || !b) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading:
          a.heading +
          Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)) * t,
        halfLength: firetruck.length / 2,
        halfWidth: firetruck.width / 2,
      });
    }
  }
  return out;
}

describe('buildRoadNetwork', () => {
  it('connects every interior crossroads both ways', () => {
    const n = layout.config.gridSize - 1;
    expect(network.junctions).toHaveLength(n * n);
    expect(network.lanes).toHaveLength(2 * 2 * n * (n - 1));
  });

  it('runs every lane down the middle of the right-hand side', () => {
    for (const lane of network.lanes) {
      for (const p of lane.path.points) {
        const offX = Math.abs(p.x - Math.round(p.x / layout.pitch) * layout.pitch);
        const offZ = Math.abs(p.z - Math.round(p.z / layout.pitch) * layout.pitch);
        expect(Math.min(offX, offZ)).toBeCloseTo(2);
      }
    }
  });

  it('keeps even a fire truck on the carriageway through every turn', () => {
    for (const junction of network.junctions) {
      for (const way of junction.ways.values()) {
        for (const spot of along(way)) {
          for (const c of corners(spot)) {
            expect(collision.groundHeightAt(c.x, c.z)).toBe(0);
          }
        }
      }
    }
  });

  it('leaves every arriving car at least one way on', () => {
    for (const lane of network.lanes) {
      const ways = [...lane.to.ways.keys()].filter((k) => k.startsWith(`${lane.direction}:`));
      expect(ways.length).toBeGreaterThan(0);
    }
  });
});

describe('Traffic', () => {
  function town(count: number, seed: number): Traffic {
    const traffic = new Traffic(buildRoadNetwork(layout));
    const rng = createRng(seed);
    for (let i = 0; i < count; i++) traffic.spawn(i % 7 === 0 ? firetruck : sedan, rng);
    return traffic;
  }

  it('fits a hundred cars in town without any touching', () => {
    const traffic = town(100, 1);
    expect(traffic.cars).toHaveLength(100);
    const boxes = traffic.cars.map((c) => footprint(c.vehicle));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b) expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('keeps a hundred cars moving for minutes without a crash or a jam', () => {
    const traffic = town(100, 2);
    const rng = createRng(3);
    const dt = 1 / 20;
    let crashes = 0;
    const moved = new Map(traffic.cars.map((c) => [c, 0]));

    for (let t = 0; t < 240; t += dt) {
      traffic.update(dt, [], rng);
      for (const car of traffic.cars) {
        if (t > 200) moved.set(car, (moved.get(car) ?? 0) + car.vehicle.speed * dt);
      }
      if (Math.round(t / dt) % 10 !== 0) continue;
      const boxes = traffic.cars.map((c) => footprint(c.vehicle));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a && b && Math.hypot(a.x - b.x, a.z - b.z) < 12 && overlap(a, b)) crashes++;
        }
      }
    }

    expect(crashes).toBe(0);
    // Za posledních 40 sekund se skoro každé auto někam dostalo.
    const stuck = [...moved.values()].filter((d) => d < 5).length;
    expect(stuck).toBeLessThan(10);
  });

  it('stops short of someone standing in the road', () => {
    const traffic = town(1, 4);
    const car = traffic.cars[0];
    if (!car) throw new Error('no car');
    const f = car.vehicle.forward();
    const person: Obstacle = {
      x: car.vehicle.x + f.x * 15,
      z: car.vehicle.z + f.z * 15,
      heading: 0,
      halfLength: 0.4,
      halfWidth: 0.4,
    };
    const rng = createRng(5);
    for (let t = 0; t < 10; t += 1 / 30) traffic.update(1 / 30, [person], rng);

    expect(car.vehicle.speed).toBeCloseTo(0);
    expect(overlap(footprint(car.vehicle), person)).toBe(false);
  });

  it('lets a car be taken out of traffic, freeing any crossroads it claimed', () => {
    const traffic = town(20, 7);
    const rng = createRng(8);
    // Běží, dokud si některé auto nezabere křižovatku.
    let claimer = traffic.cars.find((c) => c.cleared);
    for (let t = 0; t < 30 && !claimer; t += 1 / 20) {
      traffic.update(1 / 20, [], rng);
      claimer = traffic.cars.find((c) => c.cleared);
    }
    if (!claimer) throw new Error('no car reached a crossroads');

    traffic.remove(claimer);
    expect(traffic.cars).not.toContain(claimer);
    expect(traffic.network.junctions.some((j) => j.occupants.has(claimer))).toBe(false);
    expect(traffic.obstacles().some((o) => o.owner === claimer)).toBe(false);
  });

  it('makes cars solid for the player', () => {
    const traffic = town(1, 6);
    const car = traffic.cars[0];
    if (!car) throw new Error('no car');
    const world = new CityCollision(layout);
    world.setObstacles(traffic.obstacles());

    expect(world.blocked(car.vehicle.x, car.vehicle.z, 0.3)).toBe(true);
    expect(world.blocked(car.vehicle.x, car.vehicle.z, 0.3, car)).toBe(false);
  });
});
