import {
  BUILTIN_LAYER_COUNT,
  rectContains,
  type Building,
  type CityLayout,
  type FacadeSpan,
  type SurfaceLayer,
} from './layout';

/** Which buildings a custom facade goes on. */
export type FacadeTarget =
  /**
   * The building standing on this ground point. Walk up to the one you want
   * and read `x` / `z` off the HUD.
   */
  | { at: { x: number; z: number } }
  /**
   * Every building the predicate accepts. `index` is the building's position
   * in `layout.buildings`, which is stable for a given seed.
   */
  | { where: (building: Building, index: number) => boolean };

/**
 * A facade texture of your own, for picked buildings.
 *
 * Unlike the built-in facades, which are one window bay per tile, a custom
 * facade can be a whole photographed wall: `span` says how many bays and
 * storeys the image covers, and the walls are mapped so each bay of the image
 * lands on one bay of the building. Crop the image to exactly that grid, or the
 * repeats will not line up.
 */
export interface CustomFacade {
  /** Used in warnings only. */
  name: string;
  /** Colour map, served from `public/`. */
  url: string;
  /** Optional tangent-space normal map, OpenGL convention. Flat if omitted. */
  normalUrl?: string;
  span: FacadeSpan;
  /**
   * Multiplied over the texture. Defaults to white: photographs carry their
   * own colour, unlike the procedural facades that rely on per-building tints.
   */
  tint?: readonly [number, number, number];
  targets: readonly FacadeTarget[];
}

/** Texture-array layer of the `index`-th custom facade. */
export const customFacadeLayer = (index: number): SurfaceLayer => BUILTIN_LAYER_COUNT + index;

/**
 * Puts custom facades on the buildings their targets pick, in place.
 *
 * Facades apply in order, so when two target the same building the later one
 * wins. A target that matches nothing warns rather than throws: it most likely
 * means the city layout changed under it.
 */
export function applyCustomFacades(layout: CityLayout, facades: readonly CustomFacade[]): void {
  facades.forEach((facade, index) => {
    const layer = customFacadeLayer(index);

    for (const target of facade.targets) {
      const matched = selectBuildings(layout.buildings, target);

      if (matched.length === 0) {
        console.warn(`Custom facade "${facade.name}": no building matches`, target);
      }

      for (const building of matched) {
        building.facade = layer;
        building.facadeSpan = facade.span;
        building.tint = [...(facade.tint ?? [1, 1, 1])];
      }
    }
  });
}

function selectBuildings(buildings: Building[], target: FacadeTarget): Building[] {
  if ('at' in target) {
    const { x, z } = target.at;
    const hit = buildings.find((building) => rectContains(building.footprint, x, z));
    return hit ? [hit] : [];
  }

  return buildings.filter(target.where);
}
