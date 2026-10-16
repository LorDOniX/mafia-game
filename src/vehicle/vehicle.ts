/**
 * Arcade car handling: a kinematic bicycle model, no physics engine.
 *
 * The car moves along its heading at `speed`, and turns at a rate set by the
 * steering angle and the wheelbase, so it cannot pivot on the spot and swings
 * wide at speed the way a real car does. Collision is a row of circles down
 * the car's long axis, tested against the city's building grid.
 *
 * Heading uses the camera's yaw convention: 0 faces -Z and positive turns
 * clockwise seen from above, so positive steering turns right.
 */

/** Physical dimensions, in metres. */
export interface VehicleBody {
  length: number;
  width: number;
  /** Distance between the front and rear axles; sets the turning circle. */
  wheelbase: number;
  wheelRadius: number;
}

export interface VehicleHandling {
  /** m/s */
  maxSpeed: number;
  maxReverseSpeed: number;
  /** m/s^2 */
  acceleration: number;
  braking: number;
  /** Deceleration when coasting. */
  rolling: number;
  handbrake: number;
  /** Front-wheel angle at a standstill, in radians. */
  maxSteer: number;
  /** How fast the wheels turn toward the requested angle, rad/s. */
  steerRate: number;
  /**
   * Speed at which the steering lock halves. Keeps the car drivable at speed,
   * where full lock would spin it round.
   */
  steerFalloff: number;
}

export const DEFAULT_HANDLING: VehicleHandling = {
  maxSpeed: 25,
  maxReverseSpeed: 7,
  acceleration: 7,
  braking: 16,
  rolling: 2.5,
  handbrake: 12,
  maxSteer: 0.6,
  steerRate: 2.5,
  steerFalloff: 15,
};

export interface VehicleControls {
  /** 1 accelerates forward, -1 brakes and then reverses. */
  throttle: number;
  /** 1 steers right, -1 left. */
  steer: number;
  handbrake: boolean;
}

/** An empty car: no input, handbrake on, so it rolls to a stop. */
export const PARKED: VehicleControls = { throttle: 0, steer: 0, handbrake: true };

export interface VehicleWorld {
  /** True if a circle at (x, z) would overlap something solid. */
  blocked(x: number, z: number, radius: number): boolean;
  groundHeightAt(x: number, z: number): number;
}

/** Fraction of speed kept per second while scraping along a wall. */
const SCRAPE_RETAIN = 0.15;
/** Fraction of speed bounced back off a head-on hit. */
const BOUNCE = 0.25;
/** Higher settles onto kerbs faster. */
const SUSPENSION = 12;

export class Vehicle {
  y = 0;
  /** m/s along the heading; negative is reversing. */
  speed = 0;
  /** Current front-wheel angle, radians. */
  steer = 0;
  /** Accumulated wheel rotation, radians, for drawing. */
  wheelSpin = 0;

  constructor(
    readonly body: VehicleBody,
    public x: number,
    public z: number,
    public heading: number,
    readonly handling: VehicleHandling = DEFAULT_HANDLING,
  ) {}

  forward(): { x: number; z: number } {
    return { x: Math.sin(this.heading), z: -Math.cos(this.heading) };
  }

  right(): { x: number; z: number } {
    return { x: Math.cos(this.heading), z: Math.sin(this.heading) };
  }

  update(dt: number, controls: VehicleControls, world: VehicleWorld): void {
    this.updateSpeed(dt, controls);

    const h = this.handling;
    const lock = h.maxSteer / (1 + Math.abs(this.speed) / h.steerFalloff);
    this.steer = approach(this.steer, clamp(controls.steer, -1, 1) * lock, h.steerRate * dt);

    this.move(dt, world);

    const ground = world.groundHeightAt(this.x, this.z);
    this.y += (ground - this.y) * (1 - Math.exp(-SUSPENSION * dt));
  }

  private updateSpeed(dt: number, controls: VehicleControls): void {
    const h = this.handling;
    const throttle = clamp(controls.throttle, -1, 1);
    let target = 0;
    let rate = h.rolling;

    if (throttle > 0) {
      // Pressing forward while rolling backward brakes first.
      if (this.speed < 0) rate = h.braking;
      else [target, rate] = [h.maxSpeed * throttle, h.acceleration];
    } else if (throttle < 0) {
      if (this.speed > 0) rate = h.braking;
      else [target, rate] = [h.maxReverseSpeed * throttle, h.acceleration];
    }

    if (controls.handbrake) {
      target = 0;
      rate = Math.max(rate, h.handbrake);
    }

    this.speed = approach(this.speed, target, rate * dt);
  }

  private move(dt: number, world: VehicleWorld): void {
    const distance = this.speed * dt;
    const heading = this.heading + (distance * Math.tan(this.steer)) / this.body.wheelbase;
    const nextX = this.x + Math.sin(heading) * distance;
    const nextZ = this.z - Math.cos(heading) * distance;

    if (this.fits(nextX, nextZ, heading, world)) {
      this.place(nextX, nextZ, heading, distance);
      return;
    }

    // Glancing blow: slide along whichever axis is free, losing speed.
    const scrape = Math.pow(SCRAPE_RETAIN, dt);
    if (this.fits(nextX, this.z, heading, world)) {
      this.place(nextX, this.z, heading, distance);
      this.speed *= scrape;
    } else if (this.fits(this.x, nextZ, heading, world)) {
      this.place(this.x, nextZ, heading, distance);
      this.speed *= scrape;
    } else {
      // Head-on: stay put and bounce back a little.
      this.speed *= -BOUNCE;
    }
  }

  private place(x: number, z: number, heading: number, distance: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.wheelSpin += distance / this.body.wheelRadius;
  }

  /** Circles of the car's half-width, spaced to cover its length. */
  private fits(x: number, z: number, heading: number, world: VehicleWorld): boolean {
    const { length, width } = this.body;
    const radius = width / 2;
    const count = Math.max(1, Math.ceil(length / width));
    const reach = Math.max(0, length / 2 - radius);
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);

    for (let i = 0; i < count; i++) {
      const along = count === 1 ? 0 : -reach + (2 * reach * i) / (count - 1);
      if (world.blocked(x + fx * along, z + fz * along, radius)) return false;
    }
    return true;
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Moves `value` toward `target` by at most `step`. */
const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(value + step, target) : Math.max(value - step, target);
