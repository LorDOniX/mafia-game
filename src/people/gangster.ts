import type { Rect } from '@/city/layout';
import type { Rng } from '@/core/rng';
import type { Vec3 } from '@/math/vec3';
import { Body, EYE_HEIGHT } from './body';

/** Co gangster potřebuje od města: přímé viditelnosti a kudy smí chodit. */
export interface GangsterWorld {
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): number;
  resolve(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): { x: number; z: number };
  groundHeightAt(x: number, z: number): number;
}

export interface Target {
  /** Pozice očí. */
  position: Vec3;
  alive: boolean;
  /** Za sklem a plechem hůř zasažitelný. */
  inCar: boolean;
}

/** Výstřel, který gangster vypálil v tomto snímku. */
export interface EnemyShot {
  from: Vec3;
  direction: Vec3;
  hit: boolean;
  damage: number;
}

export const GANGSTER_HEALTH = 100;
const SIGHT_RANGE = 40;
/** Jak často gangster hledá hráče, sekundy; paprsky nejsou zadarmo. */
const LOOK_INTERVAL = 0.25;
/** Vzdá pronásledování, pokud hráče takto dlouho nevidí. */
const FORGET_AFTER = 6;
const WALK_SPEED = 1.4;
const RUN_SPEED = 3.2;
const TURN_RATE = 4;
/** Bojová vzdálenost: za vzdálenou hranou se přibližuje, uvnitř drží pozici. */
const ENGAGE_DISTANCE = 14;
const RADIUS = 0.35;
/** Odchylka headingu, radiány, v rámci které gangster vystřelí. */
const AIM_TOLERANCE = 0.2;
const FIRE_INTERVAL = { min: 0.9, max: 1.7 };
const DAMAGE = { min: 8, max: 14 };
/** Reakční doba před prvním výstřelem, sekundy. */
const DRAW_TIME = 0.8;

type State = 'patrol' | 'combat' | 'dead';

/**
 * Člen konkurenčního gangu: prochází se po chodníku kolem svého bloku, dokud
 * nezahlédne hráče, pak se otočí, zvedne pistoli, přiblíží se a střílí, dokud
 * jeden z nich nepadne nebo dokud hráče dostatečně dlouho neztratí z očí.
 */
export class Gangster {
  readonly body = new Body();
  health = GANGSTER_HEALTH;
  state: State = 'patrol';

  private target = { x: 0, z: 0 };
  private cooldown = DRAW_TIME;
  private lookTimer = 0;
  private sinceSeen = Infinity;
  private seesTarget = false;
  private lastSeen = { x: 0, z: 0 };
  private stuck = 0;

  constructor(
    /** Chodník jeho bloku; hlíduje v prstenci mezi ním a pozemkem. */
    readonly sidewalk: Rect,
    readonly plot: Rect,
    rng: Rng,
    world: GangsterWorld,
  ) {
    const spot = this.randomSidewalkPoint(rng);
    this.body.x = spot.x;
    this.body.z = spot.z;
    this.body.y = world.groundHeightAt(spot.x, spot.z);
    this.body.heading = rng.range(0, Math.PI * 2);
    this.target = this.randomSidewalkPoint(rng);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** Utrží zásah; vrátí true, pokud byl smrtelný. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.state = 'dead';
      this.body.die();
      this.body.aim = 0;
      return true;
    }
    // Zásah prozradí střelce.
    this.state = 'combat';
    this.sinceSeen = 0;
    return false;
  }

  /** Odvolá hon, např. poté, co hráč zemře a ožije jinde. */
  standDown(): void {
    if (!this.alive) return;
    this.state = 'patrol';
    this.sinceSeen = Infinity;
    this.cooldown = DRAW_TIME;
  }

  update(dt: number, player: Target, world: GangsterWorld, rng: Rng): EnemyShot | null {
    const { body } = this;
    if (!this.alive) {
      body.animate(dt, 0);
      return null;
    }

    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = LOOK_INTERVAL;
      this.seesTarget = player.alive && this.canSee(player.position, world);
      if (this.seesTarget) {
        if (this.state === 'patrol') this.cooldown = DRAW_TIME;
        this.state = 'combat';
        this.sinceSeen = 0;
        this.lastSeen = { x: player.position.x, z: player.position.z };
      }
    }
    if (!this.seesTarget) this.sinceSeen += dt;
    if (this.state === 'combat' && (!player.alive || this.sinceSeen > FORGET_AFTER)) {
      this.standDown();
      this.target = this.randomSidewalkPoint(rng);
    }

    let shot: EnemyShot | null = null;
    if (this.state === 'combat') {
      const goal = this.seesTarget ? player.position : { ...this.lastSeen, y: 0 };
      const dx = goal.x - body.x;
      const dz = goal.z - body.z;
      const distance = Math.hypot(dx, dz);
      const error = this.turnToward(Math.atan2(dx, dz), dt);
      body.aim = Math.min(1, body.aim + dt * 3);

      const close = this.seesTarget && distance < ENGAGE_DISTANCE;
      this.walk(close ? 0 : RUN_SPEED, dt, world);

      this.cooldown -= dt;
      if (this.seesTarget && this.cooldown <= 0 && Math.abs(error) < AIM_TOLERANCE) {
        this.cooldown = rng.range(FIRE_INTERVAL.min, FIRE_INTERVAL.max);
        shot = this.fire(player, distance, rng);
      }
    } else {
      body.aim = Math.max(0, body.aim - dt * 2);
      const dx = this.target.x - body.x;
      const dz = this.target.z - body.z;
      if (Math.hypot(dx, dz) < 0.5 || this.stuck > 1) {
        this.target = this.randomSidewalkPoint(rng);
        this.stuck = 0;
      }
      const error = this.turnToward(Math.atan2(dx, dz), dt);
      this.walk(Math.abs(error) < 0.6 ? WALK_SPEED : 0, dt, world);
    }
    return shot;
  }

  private canSee(eye: Vec3, world: GangsterWorld): boolean {
    const from = this.eye();
    const dx = eye.x - from.x;
    const dy = eye.y - from.y;
    const dz = eye.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > SIGHT_RANGE || distance < 1e-3) return distance < 1e-3;
    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
    return world.raycast(from, direction, distance) >= distance - 0.01;
  }

  private fire(player: Target, distance: number, rng: Rng): EnemyShot {
    const from = this.muzzle();
    const dx = player.position.x - from.x;
    const dy = player.position.y - 0.3 - from.y;
    const dz = player.position.z - from.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    // Dlouhé výstřely a výstřely do auta častěji minou.
    const chance = clamp(0.75 - distance / 45, 0.12, 0.75) * (player.inCar ? 0.6 : 1);
    return {
      from,
      direction: { x: dx / length, y: dy / length, z: dz / length },
      hit: rng.chance(chance),
      damage: rng.range(DAMAGE.min, DAMAGE.max),
    };
  }

  private eye(): Vec3 {
    return { x: this.body.x, y: this.body.y + EYE_HEIGHT, z: this.body.z };
  }

  /** Přibližná poloha ústí hlavně pistole se zvednutou paží. */
  muzzle(): Vec3 {
    const f = this.body.forward();
    return {
      x: this.body.x + f.x * 0.75 - f.z * 0.2,
      y: this.body.y + 1.25,
      z: this.body.z + f.z * 0.75 + f.x * 0.2,
    };
  }

  /** Otočí se k `heading`; vrátí, o kolik se ještě odchyluje. */
  private turnToward(heading: number, dt: number): number {
    const error = wrapAngle(heading - this.body.heading);
    const step = TURN_RATE * dt;
    this.body.heading += clamp(error, -step, step);
    return wrapAngle(heading - this.body.heading);
  }

  private walk(speed: number, dt: number, world: GangsterWorld): void {
    const { body } = this;
    body.walking = speed > 0;
    if (speed > 0) {
      const f = body.forward();
      const next = world.resolve(
        body.x,
        body.z,
        body.x + f.x * speed * dt,
        body.z + f.z * speed * dt,
        RADIUS,
      );
      const moved = Math.hypot(next.x - body.x, next.z - body.z);
      this.stuck = moved < speed * dt * 0.3 ? this.stuck + dt : 0;
      body.x = next.x;
      body.z = next.z;
      body.y = world.groundHeightAt(body.x, body.z);
    }
    body.animate(dt, speed);
  }

  /** Místo na prstenci chodníku kolem bloku, mimo pozemek. */
  private randomSidewalkPoint(rng: Rng): { x: number; z: number } {
    const s = this.sidewalk;
    const p = this.plot;
    const margin = 0.6;
    const x = rng.range(s.minX + margin, s.maxX - margin);
    const z = rng.range(s.minZ + margin, s.maxZ - margin);
    switch (rng.int(0, 3)) {
      case 0:
        return { x, z: rng.range(s.minZ + margin, p.minZ - margin) };
      case 1:
        return { x, z: rng.range(p.maxZ + margin, s.maxZ - margin) };
      case 2:
        return { x: rng.range(s.minX + margin, p.minX - margin), z };
      default:
        return { x: rng.range(p.maxX + margin, s.maxX - margin), z };
    }
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
