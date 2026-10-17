import { verticalExtent, type ModelData } from '@/gfx/gltf';
import { multiply, rotationY, scaling, translate, type Mat4 } from '@/math/mat4';
import type { TreeSpot } from './layout';

/** Which species stands at a spot, from the street or park list as its kind says. */
export function speciesAt<T>(spot: TreeSpot, street: readonly T[], park: readonly T[]): T {
  const list = spot.kind === 'street' ? street : park;
  const species = list[Math.min(Math.floor(spot.variant * list.length), list.length - 1)];
  if (species === undefined) throw new Error(`No tree species listed for ${spot.kind} trees`);
  return species;
}

/** Model-to-world for a tree: base on the ground, scaled to `height`, turned at random. */
export function treeTransform(
  spot: TreeSpot,
  model: ModelData,
  height: number,
  groundY: number,
): Mat4 {
  const { minY, maxY } = verticalExtent(model);
  const scale = (height * spot.size) / Math.max(maxY - minY, 1e-6);
  const placed = multiply(translate(spot.x, groundY, spot.z), rotationY(spot.rotation));
  return multiply(multiply(placed, scaling(scale)), translate(0, -minY, 0));
}
