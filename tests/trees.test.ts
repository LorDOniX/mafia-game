import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateCity, rectContains } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import { PARK_TREES, STREET_TREES, TREE_MODELS } from '@/city/assets';
import { speciesAt, treeTransform } from '@/city/trees';
import { bakeInstances } from '@/gfx/batch';
import { FLOATS_PER_MODEL_VERTEX, parseGlb } from '@/gfx/gltf';
import { transformPoint } from '@/math/mat4';

const city = generateCity();

describe('tree planting', () => {
  it('lines the streets and plants the parks', () => {
    expect(city.trees.filter((t) => t.kind === 'street').length).toBeGreaterThan(500);
    expect(city.blocks.some((b) => b.isPark)).toBe(true);
    for (const block of city.blocks.filter((b) => b.isPark)) {
      expect(block.buildings).toHaveLength(0);
      expect(city.trees.some((t) => t.kind === 'park' && rectContains(block.plot, t.x, t.z))).toBe(
        true,
      );
    }
  });

  it('keeps every tree off the roadway and out of every building', () => {
    for (const tree of city.trees) {
      const block = city.blocks.find((b) => rectContains(b.sidewalk, tree.x, tree.z));
      expect(block).toBeDefined();
      for (const building of block?.buildings ?? []) {
        expect(rectContains(building.footprint, tree.x, tree.z)).toBe(false);
      }
    }
  });

  it('leaves the buildings exactly where they were before parks existed', () => {
    const withoutParks = generateCity({ parkChance: 0 });
    const parks = city.blocks.filter((b) => b.isPark);
    const kept = withoutParks.buildings.filter(
      (b) => !parks.some((park) => rectContains(park.plot, b.footprint.minX, b.footprint.minZ)),
    );
    expect(city.buildings.map((b) => b.footprint)).toEqual(kept.map((b) => b.footprint));
  });

  it('gives trunks collision', () => {
    const collision = new CityCollision(city);
    const tree = city.trees[0];
    if (!tree) throw new Error('no trees');
    expect(collision.overlaps(tree.x, tree.z, 0.1)).toBe(true);
  });

  it('picks every species from the configured lists', () => {
    for (const tree of city.trees) {
      expect([...STREET_TREES, ...PARK_TREES]).toContain(speciesAt(tree, STREET_TREES, PARK_TREES));
    }
  });
});

describe('baked trees', () => {
  const glb = readFileSync(
    fileURLToPath(new URL('../public/models/tree_oak.glb', import.meta.url)),
  );
  const oak = parseGlb(
    glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer,
  );
  const spots = city.trees.slice(0, 3);
  const transforms = spots.map((spot) => treeTransform(spot, oak, TREE_MODELS.oak.height, 0.15));

  it('stands each tree on the ground at its spot, at its height', () => {
    transforms.forEach((transform, i) => {
      const spot = spots[i];
      if (!spot) return;
      const top = Math.max(
        ...oak.parts.map((p) => transformPoint(transform, transformPoint(p.matrix, p.max)).y),
      );
      const bottom = Math.min(
        ...oak.parts.map((p) => transformPoint(transform, transformPoint(p.matrix, p.min)).y),
      );
      expect(bottom).toBeCloseTo(0.15);
      expect(top - bottom).toBeCloseTo(TREE_MODELS.oak.height * spot.size, 1);
    });
  });

  it('merges every placement into one part per material', () => {
    const baked = bakeInstances(oak, transforms);
    expect(baked.parts).toHaveLength(oak.parts.length);

    baked.parts.forEach((part, p) => {
      const source = oak.parts[p];
      if (!source) return;
      const vertexCount = part.vertices.length / FLOATS_PER_MODEL_VERTEX;
      expect(vertexCount).toBe((source.vertices.length / FLOATS_PER_MODEL_VERTEX) * spots.length);
      expect(part.indices.length).toBe(source.indices.length * spots.length);
      expect(Math.max(...part.indices)).toBe(vertexCount - 1);
      expect(part.baseColor).toEqual(source.baseColor);

      for (let o = 0; o < part.vertices.length; o += FLOATS_PER_MODEL_VERTEX) {
        const [nx = 0, ny = 0, nz = 0] = part.vertices.subarray(o + 3, o + 6);
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 4);
      }
    });
  });
});
