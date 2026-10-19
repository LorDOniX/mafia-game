import { beforeAll, describe, expect, it } from 'vitest';
import { CityCollision } from '@/city/collision';
import { generateCity, type CityLayout } from '@/city/layout';

let city: CityLayout;
let collision: CityCollision;

beforeAll(() => {
  city = generateCity({ seed: 99 });
  collision = new CityCollision(city);
});

const RADIUS = 0.45;

describe('CityCollision.overlaps', () => {
  it('reports a hit at the centre of a building', () => {
    const footprint = city.buildings[0]?.footprint;
    if (!footprint) throw new Error('expected at least one building');

    const x = (footprint.minX + footprint.maxX) / 2;
    const z = (footprint.minZ + footprint.maxZ) / 2;

    expect(collision.overlaps(x, z, RADIUS)).toBe(true);
  });

  it('leaves the middle of the road clear', () => {
    // Celé násobky rozteče leží na osách ulic.
    expect(collision.overlaps(city.pitch, city.pitch * 2, RADIUS)).toBe(false);
  });

  it('accounts for the body radius, not just the centre point', () => {
    const footprint = city.buildings[0]?.footprint;
    if (!footprint) throw new Error('expected at least one building');

    // Těsně za zdí, ale dost blízko na to, aby do ní kruh stále zasahoval.
    const x = footprint.minX - RADIUS / 2;
    const z = (footprint.minZ + footprint.maxZ) / 2;

    expect(collision.overlaps(x, z, RADIUS)).toBe(true);
  });
});

describe('CityCollision.resolve', () => {
  it('refuses to walk through a wall', () => {
    const footprint = city.buildings[0]?.footprint;
    if (!footprint) throw new Error('expected at least one building');

    const z = (footprint.minZ + footprint.maxZ) / 2;
    const fromX = footprint.minX - 3;
    const target = footprint.maxX + 3;

    const result = collision.resolve(fromX, z, target, z, RADIUS);
    expect(result.x).toBeLessThan(footprint.minX);
  });

  it('slides along a wall instead of stopping dead', () => {
    const footprint = city.buildings[0]?.footprint;
    if (!footprint) throw new Error('expected at least one building');

    const startX = footprint.minX - 1;
    const startZ = (footprint.minZ + footprint.maxZ) / 2;

    // Tlačení šikmo do zdi by mělo stále postupovat podél Z.
    const result = collision.resolve(startX, startZ, startX + 2, startZ + 2, RADIUS);

    expect(result.x).toBeLessThan(footprint.minX);
    expect(result.z).toBeGreaterThan(startZ);
  });

  it('keeps the player inside the map bounds', () => {
    const result = collision.resolve(5, 5, -500, -500, RADIUS);
    expect(result.x).toBeGreaterThanOrEqual(city.bounds.minX);
    expect(result.z).toBeGreaterThanOrEqual(city.bounds.minZ);
  });

  it('lets the player walk out of a car that ran into them, but not further in', () => {
    const x = city.pitch;
    const z = city.pitch * 2;
    const world = new CityCollision(city);
    // Auto podél Z, hráč vězí v jeho levém boku.
    world.setObstacles([
      { x: x + 1, z, heading: 0, halfLength: 2.2, halfWidth: 0.9, owner: 'car' },
    ]);

    expect(world.resolve(x, z, x - 0.1, z, RADIUS).x).toBeCloseTo(x - 0.1);
    expect(world.resolve(x, z, x + 0.1, z, RADIUS).x).toBe(x);
  });
});

describe('CityCollision.groundHeightAt', () => {
  it('steps up onto the sidewalk and back down to the road', () => {
    const block = city.blocks[0];
    if (!block) throw new Error('expected at least one block');

    const onSidewalk = collision.groundHeightAt(
      (block.plot.minX + block.sidewalk.minX) / 2,
      (block.plot.minZ + block.plot.maxZ) / 2,
    );
    const onRoad = collision.groundHeightAt(0.5, 0.5);

    expect(onSidewalk).toBeCloseTo(city.config.sidewalkHeight);
    expect(onRoad).toBe(0);
  });

  it('treats everything outside the grid as road level', () => {
    expect(collision.groundHeightAt(-50, -50)).toBe(0);
    expect(collision.groundHeightAt(1e5, 1e5)).toBe(0);
  });
});
