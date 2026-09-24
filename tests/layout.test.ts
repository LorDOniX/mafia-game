import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY_CONFIG, generateCity, TextureLayer, type Rect } from '@/city/layout';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX - 1e-6 &&
  inner.maxX <= outer.maxX + 1e-6 &&
  inner.minZ >= outer.minZ - 1e-6 &&
  inner.maxZ <= outer.maxZ + 1e-6;

describe('generateCity', () => {
  it('is fully determined by its seed', () => {
    const a = generateCity({ seed: 7 });
    const b = generateCity({ seed: 7 });

    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings.map((x) => x.footprint)).toEqual(b.buildings.map((x) => x.footprint));
  });

  it('produces a different city for a different seed', () => {
    const a = generateCity({ seed: 7 });
    const b = generateCity({ seed: 8 });
    expect(a.buildings.map((x) => x.footprint)).not.toEqual(b.buildings.map((x) => x.footprint));
  });

  it('lays out a full grid of blocks with street gaps between them', () => {
    const city = generateCity({ gridSize: 3 });
    expect(city.blocks).toHaveLength(9);

    const first = city.blocks[0]?.plot;
    const second = city.blocks[1]?.plot;
    if (!first || !second) throw new Error('expected two blocks');

    expect(second.minX - first.maxX).toBeCloseTo(DEFAULT_CITY_CONFIG.streetWidth);
  });

  it('keeps every building inside its own block', () => {
    const city = generateCity();

    for (const block of city.blocks) {
      for (const building of block.buildings) {
        expect(contains(block.plot, building.footprint)).toBe(true);
      }
    }
  });

  it('never overlaps two buildings in the same block', () => {
    const city = generateCity();

    for (const block of city.blocks) {
      for (let i = 0; i < block.buildings.length; i++) {
        for (let j = i + 1; j < block.buildings.length; j++) {
          const a = block.buildings[i];
          const b = block.buildings[j];
          if (!a || !b) continue;
          expect(overlaps(a.footprint, b.footprint)).toBe(false);
        }
      }
    }
  });

  it('leaves plaza blocks empty', () => {
    const city = generateCity();
    const plazas = city.blocks.filter((block) => block.isPlaza);

    expect(plazas.length).toBeGreaterThan(0);
    for (const plaza of plazas) expect(plaza.buildings).toHaveLength(0);
  });

  it('only assigns facade textures to buildings', () => {
    const city = generateCity();
    for (const building of city.buildings) {
      expect([TextureLayer.Brick, TextureLayer.Plaster]).toContain(building.facade);
      expect(building.height).toBeGreaterThan(0);
    }
  });

  it('builds taller downtown than at the edges', () => {
    const city = generateCity({ gridSize: 7 });
    const mean = (rect: Rect): number => {
      const inside = city.buildings.filter(
        (b) => b.footprint.minX >= rect.minX && b.footprint.minX <= rect.maxX,
      );
      return inside.reduce((sum, b) => sum + b.height, 0) / Math.max(inside.length, 1);
    };

    const middle = mean({ minX: 3 * city.pitch, maxX: 4 * city.pitch, minZ: 0, maxZ: 0 });
    const edge = mean({ minX: 0, maxX: city.pitch, minZ: 0, maxZ: 0 });

    expect(middle).toBeGreaterThan(edge);
  });
});
