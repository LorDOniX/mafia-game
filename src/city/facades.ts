import {
  BUILTIN_LAYER_COUNT,
  rectContains,
  type Building,
  type CityLayout,
  type FacadeSpan,
  type SurfaceLayer,
} from './layout';

/** Na které budovy se vlastní fasáda použije. */
export type FacadeTarget =
  /**
   * Budova stojící na tomto bodu terénu. Dojděte k té, kterou chcete,
   * a odčtěte `x` / `z` z HUD.
   */
  | { at: { x: number; z: number } }
  /**
   * Každá budova, kterou predikát přijme. `index` je pozice budovy
   * v `layout.buildings`, která je pro daný seed stabilní.
   */
  | { where: (building: Building, index: number) => boolean };

/**
 * Vlastní textura fasády pro vybrané budovy.
 *
 * Na rozdíl od vestavěných fasád, které mají jednu okenní osu na dlaždici, může
 * být vlastní fasáda celá vyfocená stěna: `span` udává, kolik os a podlaží
 * obrázek pokrývá, a stěny se mapují tak, aby každá osa obrázku padla na jednu
 * osu budovy. Ořízněte obrázek přesně na tuto mřížku, jinak opakování nebudou
 * lícovat.
 */
export interface CustomFacade {
  /** Používá se jen ve varováních. */
  name: string;
  /** Barevná mapa, servírovaná z `public/`. */
  url: string;
  /** Volitelná normal mapa v tangent space, konvence OpenGL. Když chybí, je plochá. */
  normalUrl?: string;
  /**
   * Volitelná noční fotka téže stěny, oříznutá stejně jako `url`. Po setmění
   * svítí sama, takže rozsvícená okna v ní zůstanou rozsvícená.
   */
  nightUrl?: string;
  span: FacadeSpan;
  /**
   * Násobí texturu. Výchozí je bílá: fotografie mají vlastní barvu, na rozdíl
   * od procedurálních fasád, které spoléhají na tónování jednotlivých budov.
   */
  tint?: readonly [number, number, number];
  targets: readonly FacadeTarget[];
}

/** Vrstva texture array pro `index`-tou vlastní fasádu. */
export const customFacadeLayer = (index: number): SurfaceLayer => BUILTIN_LAYER_COUNT + index;

/** Noční vrstvy leží za všemi vlastními fasádami, jen pro ty, které mají `nightUrl`. */
export function customFacadeNightLayers(
  facades: readonly CustomFacade[],
): Array<SurfaceLayer | undefined> {
  let next = customFacadeLayer(facades.length);
  return facades.map((facade) => (facade.nightUrl ? next++ : undefined));
}

/**
 * Umístí vlastní fasády na budovy vybrané jejich cíli, na místě.
 *
 * Fasády se aplikují popořadě, takže když dvě cílí na stejnou budovu, vyhraje
 * ta pozdější. Cíl, který nic neodpovídá, vypíše varování místo výjimky: nejspíš
 * to znamená, že se pod ním změnilo rozvržení města.
 */
export function applyCustomFacades(layout: CityLayout, facades: readonly CustomFacade[]): void {
  const nightLayers = customFacadeNightLayers(facades);
  facades.forEach((facade, index) => {
    const layer = customFacadeLayer(index);
    const night = nightLayers[index];

    for (const target of facade.targets) {
      const matched = selectBuildings(layout.buildings, target);

      if (matched.length === 0) {
        console.warn(`Custom facade "${facade.name}": no building matches`, target);
      }

      for (const building of matched) {
        building.facade = layer;
        building.facadeSpan = facade.span;
        building.tint = [...(facade.tint ?? [1, 1, 1])];
        if (night === undefined) delete building.nightFacade;
        else building.nightFacade = night;
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
