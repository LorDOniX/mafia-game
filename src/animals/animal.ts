import type { Rect } from '@/city/layout';
import type { Rng } from '@/core/rng';
import { verticalExtent, type ModelData } from '@/gfx/gltf';
import {
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  translate,
  type Mat4,
} from '@/math/mat4';

export interface AnimalSpecies {
  url: string;
  /** Standing height, metres. */
  height: number;
  flies?: boolean;
}

/** What an animal needs from the world: whether a spot is blocked by a trunk or post. */
export interface AnimalWorld {
  overlaps(x: number, z: number, radius: number): boolean;
}

/** How a species' model is sized and stood on the ground; shared by every animal of it. */
export interface AnimalFit {
  scale: number;
  /** Model-space height of the feet, lifted to zero. */
  lift: number;
}

/** Walking pace grows with size, so an elephant out-strides a bunny. */
const WALK_SPEED_BASE = 0.5;
const WALK_SPEED_PER_METRE = 0.6;
const FLY_SPEED = 3;
/** Radians per second. */
const TURN_RATE = 3;
/** Kept between an animal and the edge of its park, metres. */
const EDGE_MARGIN = 2;
const FLY_ALTITUDE = { min: 2.5, max: 8 };
const IDLE_SECONDS = { min: 1, max: 5 };
const LEG_SWING = 0.6;
const WING_FLAP = 0.7;
/** Wing beats per second, in radians of phase. */
const FLAP_RATE = 18;

export function fitAnimal(model: ModelData, height: number): AnimalFit {
  const { minY, maxY } = verticalExtent(model);
  return { scale: height / Math.max(maxY - minY, 1e-6), lift: -minY };
}

/**
 * An animal wandering a park: it picks a spot, turns and walks (or flies) to
 * it, pauses, and picks another. Every target lies inside its park, and every
 * step is clamped to it too, so nothing ever strays into the street.
 */
export class Animal {
  x: number;
  z: number;
  y: number;
  /** Model +Z points along (sin, cos) of this, as `rotationY` turns it. */
  heading: number;
  moving = false;

  private target = { x: 0, y: 0, z: 0 };
  private wait = 0;
  private stride = 0;
  private flap = 0;

  constructor(
    readonly species: AnimalSpecies,
    readonly area: Rect,
    private readonly groundY: number,
    rng: Rng,
    world: AnimalWorld,
  ) {
    let spot = this.randomPoint(rng);
    for (let tries = 0; tries < 20 && world.overlaps(spot.x, spot.z, this.radius); tries++) {
      spot = this.randomPoint(rng);
    }
    this.x = spot.x;
    this.z = spot.z;
    this.y = species.flies ? groundY + rng.range(FLY_ALTITUDE.min, FLY_ALTITUDE.max) : groundY;
    this.heading = rng.range(0, Math.PI * 2);
    this.pickTarget(rng);
  }

  get radius(): number {
    return this.species.height * 0.3;
  }

  private get speed(): number {
    return this.species.flies
      ? FLY_SPEED
      : WALK_SPEED_BASE + this.species.height * WALK_SPEED_PER_METRE;
  }

  update(dt: number, rng: Rng, world: AnimalWorld): void {
    const { flies } = this.species;
    this.moving = false;

    if (this.wait > 0) {
      this.wait -= dt;
    } else {
      const dx = this.target.x - this.x;
      const dz = this.target.z - this.z;
      const distance = Math.hypot(dx, dz);

      if (distance < 0.3) {
        this.wait = flies ? 0 : rng.range(IDLE_SECONDS.min, IDLE_SECONDS.max);
        this.pickTarget(rng);
      } else {
        const turn = wrapAngle(Math.atan2(dx, dz) - this.heading);
        this.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn));

        // Walk only once roughly facing the way, so animals turn on the spot.
        const step = Math.min(this.speed * dt, distance) * Math.max(Math.cos(turn), 0);
        const { minX, maxX, minZ, maxZ } = this.inner();
        const nx = clamp(this.x + Math.sin(this.heading) * step, minX, maxX);
        const nz = clamp(this.z + Math.cos(this.heading) * step, minZ, maxZ);

        if (!flies && world.overlaps(nx, nz, this.radius)) {
          this.pickTarget(rng);
        } else {
          this.moving = step > 0;
          this.x = nx;
          this.z = nz;
        }
      }
    }

    if (flies) {
      this.y += (this.target.y - this.y) * Math.min(1, dt * 0.8);
      this.flap += dt * FLAP_RATE;
    }
    if (this.moving) this.stride += (dt * this.speed * 4) / Math.max(this.species.height, 0.2);
  }

  /** Model-to-world, with a gentle bob while flying. */
  transform(fit: AnimalFit): Mat4 {
    const bob = this.species.flies ? Math.sin(this.flap * 0.15) * 0.15 : 0;
    const placed = multiply(translate(this.x, this.y + bob, this.z), rotationY(this.heading));
    return multiply(multiply(placed, scaling(fit.scale)), translate(0, fit.lift, 0));
  }

  /** Legs swing in diagonal pairs while walking; wings beat while flying. */
  pose(): (part: string) => Mat4 | null {
    const walking = this.moving && !this.species.flies;
    const swing = Math.sin(this.stride) * LEG_SWING;
    const beat = Math.sin(this.flap) * WING_FLAP;

    return (part) => {
      if (part.startsWith('leg-')) {
        if (!walking) return null;
        const opposite = part === 'leg-front-right' || part === 'leg-back-left';
        return rotationX(opposite ? -swing : swing);
      }
      if (this.species.flies && part === 'wing-left') return rotationZ(beat);
      if (this.species.flies && part === 'wing-right') return rotationZ(-beat);
      return null;
    };
  }

  private inner(): Rect {
    const m = EDGE_MARGIN + this.radius;
    const { minX, maxX, minZ, maxZ } = this.area;
    return { minX: minX + m, maxX: maxX - m, minZ: minZ + m, maxZ: maxZ - m };
  }

  private randomPoint(rng: Rng): { x: number; z: number } {
    const { minX, maxX, minZ, maxZ } = this.inner();
    return { x: rng.range(minX, maxX), z: rng.range(minZ, maxZ) };
  }

  private pickTarget(rng: Rng): void {
    const { x, z } = this.randomPoint(rng);
    const y = this.species.flies
      ? this.groundY + rng.range(FLY_ALTITUDE.min, FLY_ALTITUDE.max)
      : this.groundY;
    this.target = { x, y, z };
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
