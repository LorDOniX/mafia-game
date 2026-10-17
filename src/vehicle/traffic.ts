import type { CityLayout } from '@/city/layout';
import type { Rng } from '@/core/rng';
import { Vehicle, type VehicleBody, type VehicleWorld } from './vehicle';

export interface Point {
  x: number;
  z: number;
}

interface RoutePoint extends Point {
  /** Direction of travel here, in the vehicle's heading convention. */
  heading: number;
}

/** A closed path, sampled densely enough to drive along exactly. */
export interface Route {
  points: RoutePoint[];
  /** Distance along the route to each point, plus the full length at the end. */
  distances: number[];
  length: number;
  /** Where each turn starts and ends, as distances along the route. */
  turns: Array<{ start: number; end: number }>;
}

/** m/s on the straights, and through a turn. */
const CRUISE_SPEED = 11;
const TURN_SPEED = 5;
/** m/s^2 */
const ACCELERATION = 3;
const BRAKING = 4;
/** Radius of the lane centre through a left turn; fits the 8 m carriageway. */
const TURN_RADIUS = 7;
/** Straight-line samples per quarter turn. */
const TURN_STEPS = 16;

/**
 * A random rectangular loop around one or more blocks, in the right-hand lane.
 *
 * Corners sit on interior crossroads only: the map-edge streets are half width.
 * The loop always runs anticlockwise, so every turn is a wide left across the
 * crossroads; a right turn from a 4 m lane is tighter than the car can steer.
 */
export function randomLoop(layout: CityLayout, rng: Rng): Route {
  const { gridSize } = layout.config;
  const { pitch } = layout;
  const i0 = rng.int(1, gridSize - 2);
  const i1 = rng.int(i0 + 1, gridSize - 1);
  const j0 = rng.int(1, gridSize - 2);
  const j1 = rng.int(j0 + 1, gridSize - 1);

  const crossroads: Point[] = [
    { x: i1 * pitch, z: j1 * pitch },
    { x: i1 * pitch, z: j0 * pitch },
    { x: i0 * pitch, z: j0 * pitch },
    { x: i0 * pitch, z: j1 * pitch },
  ];

  const lane = laneOffset(layout);
  const points: RoutePoint[] = [];
  const turnPoints: Array<{ start: number; end: number }> = [];

  crossroads.forEach((corner, k) => {
    const prev = at(crossroads, k - 1);
    const next = at(crossroads, k + 1);
    const dIn = direction(prev, corner);
    const dOut = direction(corner, next);
    // Where the two lane centrelines cross: right of both the leg in and the leg out.
    const c = {
      x: corner.x + (rightOf(dIn).x + rightOf(dOut).x) * lane,
      z: corner.z + (rightOf(dIn).z + rightOf(dOut).z) * lane,
    };

    // Quarter circle tangent to both lanes; dOut is left of dIn on a left turn.
    const r = TURN_RADIUS;
    const start = { x: c.x - dIn.x * r, z: c.z - dIn.z * r };
    const centre = { x: start.x + dOut.x * r, z: start.z + dOut.z * r };
    const u = { x: start.x - centre.x, z: start.z - centre.z };
    const v = { x: dIn.x * r, z: dIn.z * r };

    const first = points.length;
    for (let s = 0; s <= TURN_STEPS; s++) {
      const phi = (s / TURN_STEPS) * (Math.PI / 2);
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      points.push({
        x: centre.x + u.x * cos + v.x * sin,
        z: centre.z + u.z * cos + v.z * sin,
        heading: headingTo(v.x * cos - u.x * sin, v.z * cos - u.z * sin),
      });
    }
    turnPoints.push({ start: first, end: points.length - 1 });
  });

  const distances = [0];
  for (let i = 0; i < points.length; i++) {
    const a = at(points, i);
    const b = at(points, i + 1);
    distances.push((distances[i] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }

  return {
    points,
    distances,
    length: distances[points.length] ?? 0,
    turns: turnPoints.map(({ start, end }) => ({
      start: distances[start] ?? 0,
      end: distances[end] ?? 0,
    })),
  };
}

/** Drives a vehicle round a closed route forever, exactly on its line. */
export class RouteDriver {
  private distance: number;
  private segment = 0;

  constructor(
    readonly vehicle: Vehicle,
    readonly route: Route,
    distance = 0,
  ) {
    this.distance = mod(distance, route.length);
    this.place();
  }

  /** A vehicle placed somewhere random along the route, already facing down it. */
  static spawn(body: VehicleBody, route: Route, rng: Rng): RouteDriver {
    return new RouteDriver(new Vehicle(body, 0, 0, 0), route, rng.range(0, route.length));
  }

  update(dt: number, world: VehicleWorld): void {
    const { vehicle } = this;
    const target = this.targetSpeed();
    const rate = target < vehicle.speed ? BRAKING : ACCELERATION;
    vehicle.speed = approach(vehicle.speed, target, rate * dt);

    const step = vehicle.speed * dt;
    this.distance = mod(this.distance + step, this.route.length);
    vehicle.wheelSpin += step / vehicle.body.wheelRadius;
    this.place();

    // Wheels follow the curvature of the line, eased so they do not snap.
    const { points, distances } = this.route;
    const a = at(points, this.segment);
    const b = at(points, this.segment + 1);
    const span = (distances[this.segment + 1] ?? 0) - (distances[this.segment] ?? 0);
    const curvature = span > 0 ? wrapAngle(b.heading - a.heading) / span : 0;
    const steer = Math.atan(vehicle.body.wheelbase * curvature);
    vehicle.steer = approach(vehicle.steer, steer, vehicle.handling.steerRate * dt);

    vehicle.y = world.groundHeightAt(vehicle.x, vehicle.z);
  }

  /** Cruise, braking in time to take the next turn at turn speed. */
  private targetSpeed(): number {
    const { turns, length } = this.route;
    let gap = Infinity;
    for (const { start, end } of turns) {
      if (mod(this.distance - start, length) <= end - start) return TURN_SPEED;
      gap = Math.min(gap, mod(start - this.distance, length));
    }
    return Math.min(CRUISE_SPEED, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * BRAKING * gap));
  }

  private place(): void {
    const { points, distances } = this.route;
    // Mostly the same segment as last frame, or the next one.
    let i = this.segment;
    for (let guard = 0; guard <= points.length; guard++) {
      const from = distances[i] ?? 0;
      const to = distances[i + 1] ?? 0;
      if (this.distance >= from && this.distance < to) break;
      i = (i + 1) % points.length;
    }
    this.segment = i;

    const a = at(points, i);
    const b = at(points, i + 1);
    const from = distances[i] ?? 0;
    const to = distances[i + 1] ?? 0;
    const t = to > from ? (this.distance - from) / (to - from) : 0;
    this.vehicle.x = a.x + (b.x - a.x) * t;
    this.vehicle.z = a.z + (b.z - a.z) * t;
    this.vehicle.heading = a.heading + wrapAngle(b.heading - a.heading) * t;
  }
}

/** Street centreline to the middle of the right-hand lane; streetWidth includes both sidewalks. */
export function laneOffset(layout: CityLayout): number {
  const { streetWidth, sidewalkWidth } = layout.config;
  return (streetWidth / 2 - sidewalkWidth) / 2;
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[mod(index, items.length)];
  if (item === undefined) throw new Error('Index into an empty list');
  return item;
}

function direction(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  return { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
}

/** Right of a travel direction, in the vehicle's heading convention. */
const rightOf = (d: Point): Point => ({ x: -d.z, z: d.x });

/** Heading that faces along (dx, dz): 0 is -Z, pi/2 is +X. */
const headingTo = (dx: number, dz: number): number => Math.atan2(dx, -dz);

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

const mod = (value: number, n: number): number => ((value % n) + n) % n;

/** Moves `value` toward `target` by at most `step`. */
const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(value + step, target) : Math.max(value - step, target);
