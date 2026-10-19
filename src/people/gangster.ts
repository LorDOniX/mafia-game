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
/** Jak dlouho postává na místě, než se zase vydá jít, sekundy. */
const IDLE_TIME = { min: 2, max: 7 };
/** Jak moc se při postávání odvrací od kolmého pohledu do ulice, radiány. */
const IDLE_GLANCE = 0.6;
/** Jak blízko musí dojít k bodu trasy, metry. */
const WAYPOINT_REACH = 0.5;

type State = 'patrol' | 'combat' | 'dead';

/**
 * Člen konkurenčního gangu: prochází se po chodníku kolem svého bloku a postává
 * s pohledem do ulice, dokud nezahlédne hráče, pak se otočí, zvedne pistoli,
 * přiblíží se a střílí, dokud jeden z nich nepadne nebo dokud hráče dostatečně
 * dlouho neztratí z očí.
 */
export class Gangster {
  readonly body = new Body();
  health = GANGSTER_HEALTH;
  state: State = 'patrol';

  /** Zbylé body cesty po chodníku; poslední je cíl, kde bude postávat. */
  private route: Array<{ x: number; z: number }> = [];
  private idle = 0;
  private idleHeading = 0;
  private cooldown = DRAW_TIME;
  private lookTimer = 0;
  private sinceSeen = Infinity;
  private seesTarget = false;
  private lastSeen = { x: 0, z: 0 };
  private stuck = 0;
  /** Střední čára chodníku kolem bloku, po které vede každá trasa. */
  private readonly ring: Rect;

  constructor(
    /** Chodník jeho bloku; hlíduje v prstenci mezi ním a pozemkem. */
    readonly sidewalk: Rect,
    readonly plot: Rect,
    rng: Rng,
    world: GangsterWorld,
  ) {
    this.ring = {
      minX: (sidewalk.minX + plot.minX) / 2,
      minZ: (sidewalk.minZ + plot.minZ) / 2,
      maxX: (sidewalk.maxX + plot.maxX) / 2,
      maxZ: (sidewalk.maxZ + plot.maxZ) / 2,
    };
    const spot = this.randomSidewalkPoint(rng);
    this.body.x = spot.x;
    this.body.z = spot.z;
    this.body.y = world.groundHeightAt(spot.x, spot.z);
    // Nevyrazí všichni najednou.
    this.standAround(rng, rng.range(0, IDLE_TIME.max));
    this.body.heading = this.idleHeading;
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
      this.planRoute(rng);
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
      this.patrol(dt, world, rng);
    }
    return shot;
  }

  private patrol(dt: number, world: GangsterWorld, rng: Rng): void {
    if (this.idle > 0) {
      this.idle -= dt;
      this.turnToward(this.idleHeading, dt);
      this.walk(0, dt, world);
      if (this.idle <= 0) this.planRoute(rng);
      return;
    }

    const next = this.route[0];
    if (!next || this.stuck > 1) {
      // Zaseknutý o strom nebo lampu to zkusí jinam.
      if (next) this.planRoute(rng);
      else this.standAround(rng);
      this.stuck = 0;
      return;
    }
    const dx = next.x - this.body.x;
    const dz = next.z - this.body.z;
    if (Math.hypot(dx, dz) < WAYPOINT_REACH) {
      this.route.shift();
      if (this.route.length === 0) this.standAround(rng);
      return;
    }
    const error = this.turnToward(Math.atan2(dx, dz), dt);
    this.walk(Math.abs(error) < 0.6 ? WALK_SPEED : 0, dt, world);
  }

  /** Zastaví se a dívá se do ulice před nejbližší stranou bloku. */
  private standAround(rng: Rng, time = rng.range(IDLE_TIME.min, IDLE_TIME.max)): void {
    const { normal } = this.onRing(this.body.x, this.body.z);
    this.idle = time;
    this.idleHeading = Math.atan2(normal.x, normal.z) + rng.range(-IDLE_GLANCE, IDLE_GLANCE);
    this.route = [];
  }

  /**
   * Trasa k náhodnému místu na chodníku kratší cestou kolem bloku, přes rohy,
   * aby nikdy nevedla napříč budovou a nekončila čelem ke zdi.
   */
  private planRoute(rng: Rng): void {
    const { minX, minZ, maxX, maxZ } = this.ring;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const length = 2 * (w + h);
    const from = this.onRing(this.body.x, this.body.z);
    const to = rng.range(0, length);
    const forward = (((to - from.t) % length) + length) % length;
    const span = forward <= length / 2 ? forward : forward - length;

    // Vzdálenost každého rohu od začátku ve směru chůze.
    const corners = [0, w, w + h, 2 * w + h]
      .map((t) => ({
        t,
        along: span >= 0 ? (t - from.t + length) % length : (from.t - t + length) % length,
      }))
      .filter(({ along }) => along > 0 && along < Math.abs(span))
      .sort((a, b) => a.along - b.along);

    const start = this.ringPoint(from.t);
    const end = this.ringPoint(to);
    const across = this.onRing(end.x, end.z).normal;
    // Bok chodníku, aby nestáli všichni přesně na jeho středu.
    const band = Math.max(0, (this.plot.minX - this.sidewalk.minX) / 2 - 0.6);
    const offset = rng.range(-band, band);

    this.route = [
      ...(Math.hypot(start.x - this.body.x, start.z - this.body.z) > 1.5 ? [start] : []),
      ...corners.map(({ t }) => this.ringPoint(t)),
      { x: end.x + across.x * offset, z: end.z + across.z * offset },
    ];
    this.idle = 0;
  }

  /** Bod na střední čáře chodníku ve vzdálenosti `t` od rohu (minX, minZ), po směru +X. */
  private ringPoint(t: number): { x: number; z: number } {
    const { minX, minZ, maxX, maxZ } = this.ring;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const s = ((t % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
    if (s < w) return { x: minX + s, z: minZ };
    if (s < w + h) return { x: maxX, z: minZ + (s - w) };
    if (s < 2 * w + h) return { x: maxX - (s - w - h), z: maxZ };
    return { x: minX, z: maxZ - (s - 2 * w - h) };
  }

  /** Nejbližší místo na střední čáře chodníku a normála té strany ven do ulice. */
  private onRing(x: number, z: number): { t: number; normal: { x: number; z: number } } {
    const { minX, minZ, maxX, maxZ } = this.ring;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const cx = clamp(x, minX, maxX);
    const cz = clamp(z, minZ, maxZ);
    const sides = [
      { gap: Math.hypot(x - cx, z - minZ), t: cx - minX, normal: { x: 0, z: -1 } },
      { gap: Math.hypot(x - maxX, z - cz), t: w + (cz - minZ), normal: { x: 1, z: 0 } },
      { gap: Math.hypot(x - cx, z - maxZ), t: w + h + (maxX - cx), normal: { x: 0, z: 1 } },
      { gap: Math.hypot(x - minX, z - cz), t: 2 * w + h + (maxZ - cz), normal: { x: -1, z: 0 } },
    ];
    return sides.reduce((best, side) => (side.gap < best.gap ? side : best));
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
