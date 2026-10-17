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
 * How a glTF model becomes a drivable car.
 *
 * The model is expected to face +Z with +Y up, the glTF convention, and to
 * name its wheels so they can be found: every part whose name starts with
 * `spinPrefix` rolls, and those also starting with `steerPrefix` steer.
 * Kenney's car kit names them `wheel-front-left`, `wheel-back-right` and so on.
 */
export interface VehicleModelConfig {
  url: string;
  /** Uniform scale from model units to metres. */
  scale: number;
  spinPrefix: string;
  steerPrefix: string;
}

export interface VehicleFit {
  body: VehicleBody;
  /** Model-space point that sits on the vehicle's position: footprint centre, at ground level. */
  origin: Vec3;
  scale: number;
}

/** Wheel radius and wheelbase to fall back on when a model has no named wheels. */
const FALLBACK_WHEEL_RADIUS = 0.35;
const FALLBACK_WHEELBASE_RATIO = 0.6;

/**
 * Measures the car off its model: size from the bounds of every part, wheel
 * radius from the wheel geometry, and wheelbase from where the axles sit.
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

  // Node translation is the axle, since that is what the wheel spins around.
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
 * Model-to-world transform for a vehicle.
 *
 * Rotating by pi - heading turns the model's +Z nose onto the heading's
 * forward vector (sin h, 0, -cos h).
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

/** Per-part pose for the wheels: roll with distance travelled, steer at the front. */
export function vehiclePose(
  vehicle: Vehicle,
  config: VehicleModelConfig,
): (part: string) => Mat4 | null {
  return (part) => {
    if (!part.startsWith(config.spinPrefix)) return null;

    const roll = rotationX(vehicle.wheelSpin);
    if (!part.startsWith(config.steerPrefix)) return roll;

    // The model's right is -X, so steering right turns the wheel's +Z nose
    // toward -X: a negative angle about +Y.
    return multiply(rotationY(-vehicle.steer), roll);
  };
}

const HEADLIGHT_HEIGHT = 0.7;
/** Beams dip slightly so they light the road rather than the cars ahead. */
const HEADLIGHT_DIP = 0.05;
const HEADLIGHT_COLOR: readonly [number, number, number] = [1.0, 0.94, 0.82];
export const HEADLIGHT_INTENSITY = 220;
export const HEADLIGHT_RANGE = 80;
/** Half-angles, radians: a tight core that throws far, with a softer spill. */
const HEADLIGHT_INNER = 0.15;
const HEADLIGHT_OUTER = 0.4;

/**
 * Both headlamps as one beam from the middle of the bonnet: half the cost in
 * the shader, and at a car's width apart the two would light the same patch.
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
