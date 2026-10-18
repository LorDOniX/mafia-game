import type { CityLayout, Rect } from '@/city/layout';
import type { Obstacle } from '@/city/collision';
import { circleHitsObstacle } from '@/city/collision';
import type { Rng } from '@/core/rng';
import type { Vec3 } from '@/math/vec3';
import { Gangster, type EnemyShot, type GangsterWorld, type Target } from '@/people/gangster';

/** A square of blocks the gang can hold. */
export interface District {
  bounds: Rect;
  gangsters: Gangster[];
  /** Held by the gang at the start. */
  contested: boolean;
  captured: boolean;
}

export interface GangWarOptions {
  /** Blocks along each side of a district. */
  districtSize: number;
  /** Districts the gang holds at the start. */
  held: number;
  gangstersPerDistrict: { min: number; max: number };
  /** No gang district here, so the player does not start under fire. */
  safe: { x: number; z: number };
}

export const DEFAULT_GANG_WAR: Omit<GangWarOptions, 'safe'> = {
  districtSize: 2,
  held: 6,
  gangstersPerDistrict: { min: 4, max: 6 },
};

export const POINTS = { kill: 100, headshot: 50, district: 500, death: -250 };
export const PLAYER_HEALTH = 100;
/** Seconds without being hit before health starts coming back, and how fast. */
const REGEN_DELAY = 5;
const REGEN_RATE = 6;
const PISTOL_DAMAGE = 40;
const RANGE = 150;
/** A car this fast flattens whoever it hits, m/s. */
const RUN_OVER_SPEED = 4;
/** How long a muzzle flash lasts, seconds. */
const FLASH_TIME = 0.07;

export interface GangWarEvent {
  text: string;
  points: number;
}

export interface ShotResult {
  distance: number;
  /** Who was hit, if anyone. */
  gangster: Gangster | null;
  head: boolean;
  killed: boolean;
}

export interface Flash {
  position: Vec3;
  direction: Vec3;
  age: number;
}

/**
 * The game: a rival gang holds districts of the city; clear every gangster
 * from a district to take it, take them all to win. Tracks the score and the
 * player's health, and what happened this frame for the HUD.
 */
export class GangWar {
  readonly districts: District[];
  score = 0;
  health = PLAYER_HEALTH;
  /** Shown to the player and then cleared by whoever displays them. */
  readonly events: GangWarEvent[] = [];
  readonly flashes: Flash[] = [];
  /** Set for a frame when the player takes a hit, for the damage flash. */
  hurt = 0;
  private sinceHurt = Infinity;

  constructor(layout: CityLayout, options: GangWarOptions, world: GangsterWorld, rng: Rng) {
    this.districts = makeDistricts(layout, options.districtSize);
    const candidates = this.districts.filter(
      (d) =>
        !(
          options.safe.x >= d.bounds.minX - layout.pitch / 2 &&
          options.safe.x <= d.bounds.maxX + layout.pitch / 2 &&
          options.safe.z >= d.bounds.minZ - layout.pitch / 2 &&
          options.safe.z <= d.bounds.maxZ + layout.pitch / 2
        ),
    );

    for (let n = 0; n < options.held && candidates.length; n++) {
      const district = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
      if (!district) break;
      district.contested = true;
      const blocks = layout.blocks.filter(
        (b) =>
          b.plot.minX >= district.bounds.minX &&
          b.plot.maxX <= district.bounds.maxX &&
          b.plot.minZ >= district.bounds.minZ &&
          b.plot.maxZ <= district.bounds.maxZ,
      );
      const count = rng.int(options.gangstersPerDistrict.min, options.gangstersPerDistrict.max);
      for (let g = 0; g < count && blocks.length; g++) {
        const block = rng.pick(blocks);
        district.gangsters.push(new Gangster(block.sidewalk, block.plot, rng, world));
      }
    }
  }

  get gangsters(): Gangster[] {
    return this.districts.flatMap((d) => d.gangsters);
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get remaining(): number {
    return this.districts.filter((d) => d.contested && !d.captured).length;
  }

  get contested(): number {
    return this.districts.filter((d) => d.contested).length;
  }

  update(dt: number, player: Target, world: GangsterWorld, rng: Rng): void {
    this.hurt = Math.max(0, this.hurt - dt * 2);
    for (const flash of this.flashes) flash.age += dt;
    this.flashes.splice(0, this.flashes.length, ...this.flashes.filter((f) => f.age < FLASH_TIME));

    for (const gangster of this.gangsters) {
      const shot = gangster.update(dt, player, world, rng);
      if (shot) this.takeFire(shot);
    }

    this.sinceHurt += dt;
    if (this.alive && this.sinceHurt > REGEN_DELAY) {
      this.health = Math.min(PLAYER_HEALTH, this.health + REGEN_RATE * dt);
    }
  }

  /** The player fires along `direction` (unit length); the world stops the bullet at `wall`. */
  shoot(origin: Vec3, direction: Vec3, wall: (maxDistance: number) => number): ShotResult {
    this.flashes.push({ position: origin, direction, age: 0 });
    let best: ShotResult = { distance: RANGE, gangster: null, head: false, killed: false };
    for (const gangster of this.gangsters) {
      const hit = gangster.body.hitBy(origin, direction, best.distance);
      if (hit) best = { distance: hit.distance, gangster, head: hit.head, killed: false };
    }
    if (!best.gangster) return { ...best, distance: wall(RANGE) };
    if (wall(best.distance) < best.distance)
      return { ...best, gangster: null, distance: wall(RANGE) };

    best.killed = best.gangster.damage(best.head ? PISTOL_DAMAGE * 3 : PISTOL_DAMAGE);
    if (best.killed)
      this.credit(
        best.head ? 'Headshot' : 'Gangster down',
        POINTS.kill + (best.head ? POINTS.headshot : 0),
      );
    this.checkDistricts();
    return best;
  }

  /** A fast car mows down any gangster in its way. */
  runOver(car: Obstacle, speed: number): void {
    if (Math.abs(speed) < RUN_OVER_SPEED) return;
    for (const gangster of this.gangsters) {
      const { x, z } = gangster.body;
      if (gangster.alive && circleHitsObstacle(x, z, 0.35, car) && gangster.damage(Infinity)) {
        this.credit('Run over', POINTS.kill);
      }
    }
    this.checkDistricts();
  }

  /** Back to full health; every gangster loses track of the player. */
  respawn(): void {
    this.health = PLAYER_HEALTH;
    this.sinceHurt = Infinity;
    for (const gangster of this.gangsters) gangster.standDown();
  }

  private takeFire(shot: EnemyShot): void {
    this.flashes.push({ position: shot.from, direction: shot.direction, age: 0 });
    if (!shot.hit || !this.alive) return;
    this.health = Math.max(0, this.health - shot.damage);
    this.sinceHurt = 0;
    this.hurt = 1;
    if (!this.alive) this.credit('You were killed', POINTS.death);
  }

  private checkDistricts(): void {
    for (const district of this.districts) {
      if (!district.contested || district.captured) continue;
      if (district.gangsters.some((g) => g.alive)) continue;
      district.captured = true;
      this.credit(this.remaining === 0 ? 'The city is yours!' : 'District taken', POINTS.district);
    }
  }

  private credit(text: string, points: number): void {
    this.score = Math.max(0, this.score + points);
    this.events.push({ text, points });
  }
}

/** Splits the city into squares of `size` by `size` blocks, streets between them included. */
export function makeDistricts(layout: CityLayout, size: number): District[] {
  const { gridSize } = layout.config;
  const { pitch } = layout;
  const districts: District[] = [];
  for (let j = 0; j < gridSize; j += size) {
    for (let i = 0; i < gridSize; i += size) {
      districts.push({
        bounds: {
          minX: i * pitch,
          minZ: j * pitch,
          maxX: Math.min(i + size, gridSize) * pitch,
          maxZ: Math.min(j + size, gridSize) * pitch,
        },
        gangsters: [],
        contested: false,
        captured: false,
      });
    }
  }
  return districts;
}
