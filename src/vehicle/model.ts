import type { ModelData } from '@/gfx/gltf';
import {
  multiply,
  rotationX,
  rotationY,
  scaling,
  transformPoint,
  translate,
  type Mat4,
} from '@/math/mat4';
import type { Vec3 } from '@/math/vec3';
import type { SpotLight } from '@/gfx/lights';
import type { Vehicle, VehicleBody } from './vehicle';

/**
 * Jak se z glTF modelu stane řiditelné auto.
 *
 * Očekává se, že model míří na +Z s +Y nahoru, podle konvence glTF, a že kola
 * pojmenovává tak, aby šla najít: každá část, jejíž název začíná na
 * `spinPrefix`, se točí, a ty, které začínají i na `steerPrefix`, zatáčejí.
 * Kenneyho car kit je pojmenovává `wheel-front-left`, `wheel-back-right` atd.
 */
export interface VehicleModelConfig {
  url: string;
  /** Jednotné měřítko z jednotek modelu na metry. */
  scale: number;
  spinPrefix: string;
  steerPrefix: string;
}

export interface VehicleFit {
  body: VehicleBody;
  /** Bod v prostoru modelu, který leží na pozici vozidla: střed půdorysu, na úrovni země. */
  origin: Vec3;
  scale: number;
}

/** Poloměr kola a rozvor pro případ, že model nemá pojmenovaná kola. */
const FALLBACK_WHEEL_RADIUS = 0.35;
const FALLBACK_WHEELBASE_RATIO = 0.6;

/**
 * Změří auto podle jeho modelu: velikost z obálek všech částí, poloměr kola
 * z geometrie kol a rozvor z polohy náprav.
 */
export function fitVehicle(data: ModelData, config: VehicleModelConfig): VehicleFit {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const part of data.parts) {
    for (const corner of corners(part.min, part.max)) {
      const p = transformPoint(part.matrix, corner);
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }

  if (!Number.isFinite(min.x)) throw new Error('Vehicle model has no geometry');

  const { scale, spinPrefix, steerPrefix } = config;
  const length = (max.z - min.z) * scale;
  const wheels = data.parts.filter((part) => part.name.startsWith(spinPrefix));
  const front = wheels.filter((part) => part.name.startsWith(steerPrefix));
  const rear = wheels.filter((part) => !part.name.startsWith(steerPrefix));

  // Posun uzlu je náprava, protože kolem ní se kolo točí.
  const axleZ = (parts: typeof wheels): number =>
    parts.reduce((sum, part) => sum + (part.matrix[14] ?? 0), 0) / parts.length;

  const wheelRadius = wheels.length
    ? Math.max(...wheels.map((part) => (part.max.y - part.min.y) / 2)) * scale
    : FALLBACK_WHEEL_RADIUS;
  const wheelbase =
    front.length && rear.length
      ? Math.abs(axleZ(front) - axleZ(rear)) * scale
      : length * FALLBACK_WHEELBASE_RATIO;

  return {
    body: { length, width: (max.x - min.x) * scale, wheelbase, wheelRadius },
    origin: { x: (min.x + max.x) / 2, y: min.y, z: (min.z + max.z) / 2 },
    scale,
  };
}

/**
 * Transformace z modelu do světa pro vozidlo.
 *
 * Rotace o pi - heading natočí příď modelu na +Z do dopředného vektoru
 * headingu (sin h, 0, -cos h).
 */
export function vehicleTransform(vehicle: Vehicle, fit: VehicleFit): Mat4 {
  const { origin, scale } = fit;
  const placed = multiply(
    translate(vehicle.x, vehicle.y, vehicle.z),
    rotationY(Math.PI - vehicle.heading),
  );
  const sized = multiply(placed, scaling(scale));
  return multiply(sized, translate(-origin.x, -origin.y, -origin.z));
}

/** Póza kol po částech: točí se podle ujeté vzdálenosti, vpředu zatáčejí. */
export function vehiclePose(
  vehicle: Vehicle,
  config: VehicleModelConfig,
): (part: string) => Mat4 | null {
  return (part) => {
    if (!part.startsWith(config.spinPrefix)) return null;

    const roll = rotationX(vehicle.wheelSpin);
    if (!part.startsWith(config.steerPrefix)) return roll;

    // Pravá strana modelu je -X, takže zatočení vpravo natočí příď kola na +Z
    // k -X: záporný úhel kolem +Y.
    return multiply(rotationY(-vehicle.steer), roll);
  };
}

const HEADLIGHT_HEIGHT = 0.7;
/** Světla jsou mírně sklopená, aby svítila na silnici, ne na auta před sebou. */
const HEADLIGHT_DIP = 0.05;
const HEADLIGHT_COLOR: readonly [number, number, number] = [1.0, 0.94, 0.82];
export const HEADLIGHT_INTENSITY = 220;
export const HEADLIGHT_RANGE = 80;
/** Poloviční úhly, radiány: úzké jádro, které svítí daleko, s měkčím rozptylem. */
const HEADLIGHT_INNER = 0.15;
const HEADLIGHT_OUTER = 0.4;

/**
 * Oba světlomety jako jeden kužel ze středu kapoty: poloviční cena v shaderu,
 * a při vzdálenosti šířky auta by oba stejně osvětlily totéž místo.
 */
export function headlight(vehicle: Vehicle): SpotLight {
  const f = vehicle.forward();
  const ahead = vehicle.body.length / 2 + 0.1;
  const length = Math.hypot(f.x, HEADLIGHT_DIP, f.z);
  return {
    position: {
      x: vehicle.x + f.x * ahead,
      y: vehicle.y + HEADLIGHT_HEIGHT,
      z: vehicle.z + f.z * ahead,
    },
    direction: { x: f.x / length, y: -HEADLIGHT_DIP / length, z: f.z / length },
    color: [
      HEADLIGHT_COLOR[0] * HEADLIGHT_INTENSITY,
      HEADLIGHT_COLOR[1] * HEADLIGHT_INTENSITY,
      HEADLIGHT_COLOR[2] * HEADLIGHT_INTENSITY,
    ],
    range: HEADLIGHT_RANGE,
    inner: HEADLIGHT_INNER,
    outer: HEADLIGHT_OUTER,
  };
}

function corners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) out.push({ x, y, z });
    }
  }
  return out;
}
