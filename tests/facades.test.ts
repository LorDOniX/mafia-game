import { describe, expect, it, vi } from 'vitest';
import {
  applyCustomFacades,
  customFacadeLayer,
  customFacadeNightLayers,
  type CustomFacade,
} from '@/city/facades';
import { CUSTOM_FACADES } from '@/city/assets';
import { buildCityMesh, FLOATS_PER_VERTEX } from '@/city/mesh';
import {
  BUILTIN_LAYER_COUNT,
  DEFAULT_CITY_CONFIG,
  generateCity,
  TextureLayer,
  type Building,
  type CityLayout,
} from '@/city/layout';

const facade = (overrides: Partial<CustomFacade> = {}): CustomFacade => ({
  name: 'test',
  url: '/textures/test.jpg',
  span: { bays: 9, storeys: 7 },
  targets: [],
  ...overrides,
});

const centreOf = (building: Building): { x: number; z: number } => ({
  x: (building.footprint.minX + building.footprint.maxX) / 2,
  z: (building.footprint.minZ + building.footprint.maxZ) / 2,
});

describe('applyCustomFacades', () => {
  it('appends custom layers after the built-in ones', () => {
    expect(BUILTIN_LAYER_COUNT).toBe(Object.keys(TextureLayer).length);
    expect(Math.max(...Object.values(TextureLayer))).toBe(BUILTIN_LAYER_COUNT - 1);
    expect(customFacadeLayer(0)).toBe(BUILTIN_LAYER_COUNT);
  });

  it('puts night layers after all custom facades, only for those that have one', () => {
    const list = [facade({ nightUrl: '/a.jpg' }), facade(), facade({ nightUrl: '/b.jpg' })];
    expect(customFacadeNightLayers(list)).toEqual([
      customFacadeLayer(3),
      undefined,
      customFacadeLayer(4),
    ]);
  });

  it('retextures only the building standing on the target point', () => {
    const layout = generateCity({ seed: 5 });
    const target = layout.buildings[10];
    if (!target) throw new Error('expected a building');
    const before = layout.buildings.map((b) => ({ facade: b.facade, tint: [...b.tint] }));

    applyCustomFacades(layout, [facade({ targets: [{ at: centreOf(target) }] })]);

    layout.buildings.forEach((building, i) => {
      if (building === target) {
        expect(building.facade).toBe(customFacadeLayer(0));
        expect(building.facadeSpan).toEqual({ bays: 9, storeys: 7 });
        expect(building.tint).toEqual([1, 1, 1]);
      } else {
        expect(building.facade).toBe(before[i]?.facade);
        expect(building.tint).toEqual(before[i]?.tint);
        expect(building.facadeSpan).toBeUndefined();
      }
    });
  });

  it('warns and changes nothing when a point misses every building', () => {
    const layout = generateCity({ seed: 5 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Osy ulic leží na celých násobcích rozteče.
    applyCustomFacades(layout, [facade({ targets: [{ at: { x: layout.pitch, z: 40 } }] })]);

    expect(warn).toHaveBeenCalledOnce();
    expect(layout.buildings.every((b) => b.facade < BUILTIN_LAYER_COUNT)).toBe(true);
    warn.mockRestore();
  });

  it('lets a later facade override an earlier one', () => {
    const layout = generateCity({ seed: 5 });
    const everything = { where: () => true };

    applyCustomFacades(layout, [
      facade({ targets: [everything] }),
      facade({ targets: [{ where: (_b, i) => i % 2 === 0 }] }),
    ]);

    layout.buildings.forEach((building, i) => {
      expect(building.facade).toBe(customFacadeLayer(i % 2 === 0 ? 1 : 0));
    });
  });

  it('keeps every shipped target on a building in the default city', () => {
    const layout = generateCity();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    applyCustomFacades(layout, CUSTOM_FACADES);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('custom facade walls', () => {
  // 12 m na šířku jsou 3 pole; 18 m při 3.6 m na podlaží je 5 podlaží.
  const building: Building = {
    footprint: { minX: 100, maxX: 112, minZ: 200, maxZ: 212 },
    height: 18,
    facade: customFacadeLayer(0),
    facadeSpan: { bays: 9, storeys: 7 },
    tint: [1, 1, 1],
  };

  const layout: CityLayout = {
    config: { ...DEFAULT_CITY_CONFIG, gridSize: 1 },
    blocks: [
      {
        plot: { minX: 90, maxX: 130, minZ: 190, maxZ: 230 },
        sidewalk: { minX: 86, maxX: 134, minZ: 186, maxZ: 234 },
        buildings: [building],
        isPlaza: false,
        isPark: false,
      },
    ],
    buildings: [building],
    trees: [],
    lamps: [],
    bounds: { minX: 0, minZ: 0, maxX: 240, maxZ: 240 },
    pitch: DEFAULT_CITY_CONFIG.blockSize + DEFAULT_CITY_CONFIG.streetWidth,
  };

  it('maps one bay and one storey of the image onto each of the building', () => {
    const mesh = buildCityMesh(layout);
    let walls = 0;

    for (let base = 0; base < mesh.vertices.length / FLOATS_PER_VERTEX; base += 4) {
      if (mesh.vertices[base * FLOATS_PER_VERTEX + 12] !== building.facade) continue;
      walls++;

      const us: number[] = [];
      const vs: number[] = [];
      for (let i = 0; i < 4; i++) {
        const o = (base + i) * FLOATS_PER_VERTEX;
        us.push(mesh.vertices[o + 10] ?? NaN);
        vs.push(mesh.vertices[o + 11] ?? NaN);
      }

      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3 / 9);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(5 / 7);
    }

    expect(walls).toBe(4);
  });
});
