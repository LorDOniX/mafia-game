import type { CityLayout, Rect } from '@/city/layout';
import type { Obstacle } from '@/city/collision';
import { circleHitsObstacle } from '@/city/collision';
import type { Rng } from '@/core/rng';
import type { Vec3 } from '@/math/vec3';
import { Gangster, type EnemyShot, type GangsterWorld, type Target } from '@/people/gangster';

/** Čtverec bloků, který může gang držet. */
export interface District {
  bounds: Rect;
  gangsters: Gangster[];
  /** Na začátku ho drží gang. */
  contested: boolean;
  captured: boolean;
}

export interface GangWarOptions {
  /** Počet bloků podél každé strany čtvrti. */
  districtSize: number;
  /** Čtvrti, které gang na začátku drží. */
  held: number;
  gangstersPerDistrict: { min: number; max: number };
  /** Tady není žádná čtvrť gangu, aby hráč nezačínal pod palbou. */
  safe: { x: number; z: number };
}

export const DEFAULT_GANG_WAR: Omit<GangWarOptions, 'safe'> = {
  districtSize: 2,
  held: 6,
  gangstersPerDistrict: { min: 4, max: 6 },
};

export const POINTS = { kill: 100, headshot: 50, district: 500, death: -250 };
export const PLAYER_HEALTH = 100;
/** Sekundy bez zásahu, než se začne obnovovat zdraví, a jak rychle. */
const REGEN_DELAY = 5;
const REGEN_RATE = 6;
const PISTOL_DAMAGE = 40;
const RANGE = 150;
/** Auto takto rychlé přejede kohokoli, koho srazí, m/s. */
const RUN_OVER_SPEED = 4;
/** Jak dlouho trvá záblesk z hlavně, sekundy. */
const FLASH_TIME = 0.07;

export interface GangWarEvent {
  text: string;
  points: number;
}

export interface ShotResult {
  distance: number;
  /** Kdo byl zasažen, pokud vůbec někdo. */
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
 * Hra: konkurenční gang drží čtvrti města; vyčisti čtvrť od všech gangsterů,
 * abys ji získal, získej všechny a vyhraješ. Sleduje skóre a zdraví hráče
 * a to, co se v tomto snímku stalo, pro HUD.
 */
export class GangWar {
  readonly districts: District[];
  score = 0;
  health = PLAYER_HEALTH;
  /** Zobrazí se hráči a pak je vyprázdní ten, kdo je zobrazuje. */
  readonly events: GangWarEvent[] = [];
  readonly flashes: Flash[] = [];
  /** Nastaví se na jeden snímek, když hráč dostane zásah, pro záblesk poškození. */
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

  /** Hráč střílí ve směru `direction` (jednotková délka); svět zastaví střelu ve `wall`. */
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

  /** Rychlé auto pokosí každého gangstera, který mu stojí v cestě. */
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

  /** Zpátky na plné zdraví; všichni gangsteři ztratí hráče z očí. */
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

/** Rozdělí město na čtverce `size` krát `size` bloků, včetně ulic mezi nimi. */
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
