import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Animal, fitAnimal, type AnimalWorld } from '@/animals/animal';
import { ANIMALS } from '@/city/assets';
import { createRng } from '@/core/rng';
import { parseGlb, verticalExtent } from '@/gfx/gltf';
import { transformPoint } from '@/math/mat4';

const park = { minX: 100, maxX: 162, minZ: 200, maxZ: 262 };
const open: AnimalWorld = { overlaps: () => false };
const dog = { url: '', height: 0.8 };
const parrot = { url: '', height: 0.7, flies: true };

function run(animal: Animal, seconds: number, world = open, seed = 1): void {
  const rng = createRng(seed);
  for (let t = 0; t < seconds; t += 1 / 30) animal.update(1 / 30, rng, world);
}

describe('Animal', () => {
  it('wanders about but never leaves its park', () => {
    for (const species of [dog, parrot]) {
      const animal = new Animal(species, park, 0.15, createRng(3), open);
      const rng = createRng(4);
      const start = { x: animal.x, z: animal.z };
      let travelled = 0;
      for (let t = 0; t < 120; t += 1 / 30) {
        const { x, z } = animal;
        animal.update(1 / 30, rng, open);
        travelled += Math.hypot(animal.x - x, animal.z - z);
        expect(animal.x).toBeGreaterThan(park.minX);
        expect(animal.x).toBeLessThan(park.maxX);
        expect(animal.z).toBeGreaterThan(park.minZ);
        expect(animal.z).toBeLessThan(park.maxZ);
      }
      expect(travelled).toBeGreaterThan(20);
      expect(Math.hypot(animal.x - start.x, animal.z - start.z)).toBeGreaterThan(0);
    }
  });

  it('keeps walkers on the ground and flyers in the air', () => {
    const walker = new Animal(dog, park, 0.15, createRng(5), open);
    const flyer = new Animal(parrot, park, 0.15, createRng(5), open);
    run(walker, 30);
    run(flyer, 30);
    expect(walker.y).toBe(0.15);
    expect(flyer.y).toBeGreaterThan(2);
  });

  it('will not walk into a trunk', () => {
    // A wall of trunks down the middle of the park.
    const wall: AnimalWorld = { overlaps: (x, _z, r) => Math.abs(x - 131) < r + 0.3 };
    const animal = new Animal(dog, park, 0, createRng(6), wall);
    const side = Math.sign(animal.x - 131);
    run(animal, 60, wall);
    expect(Math.sign(animal.x - 131)).toBe(side);
  });

  it('swings its legs only while walking, and flaps only when it flies', () => {
    const walker = new Animal(dog, park, 0, createRng(7), open);
    expect(walker.pose()('leg-front-left')).toBeNull();
    const rng = createRng(8);
    for (let i = 0; i < 3000 && !walker.moving; i++) walker.update(1 / 30, rng, open);
    expect(walker.moving).toBe(true);
    expect(walker.pose()('leg-front-left')).not.toBeNull();
    expect(walker.pose()('wing-left')).toBeNull();

    const flyer = new Animal(parrot, park, 0, createRng(7), open);
    run(flyer, 1);
    expect(flyer.pose()('wing-left')).not.toBeNull();
    expect(flyer.pose()('leg-front-left')).toBeNull();
  });
});

describe('fitAnimal', () => {
  it('stands every animal in the kit on the ground at its height', () => {
    for (const species of ANIMALS) {
      const file = fileURLToPath(new URL(`../public${species.url}`, import.meta.url));
      const glb = readFileSync(file);
      const model = parseGlb(
        glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer,
      );
      const fit = fitAnimal(model, species.height);
      const animal = new Animal({ ...species, flies: false }, park, 0, createRng(1), open);
      const transform = animal.transform(fit);
      const { minY, maxY } = verticalExtent(model);

      expect(transformPoint(transform, { x: 0, y: minY, z: 0 }).y).toBeCloseTo(0);
      expect(transformPoint(transform, { x: 0, y: maxY, z: 0 }).y).toBeCloseTo(species.height);
    }
  });
});
