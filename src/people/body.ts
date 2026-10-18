import { verticalExtent, type ModelData } from '@/gfx/gltf';
import { multiply, rotationX, rotationY, scaling, translate, type Mat4 } from '@/math/mat4';
import type { Vec3 } from '@/math/vec3';

/** Takovou výšku má každý, metry. */
export const CHARACTER_HEIGHT = 1.8;
/** Kde lze tělo zasáhnout: koule pro hlavu, svislý válec pro zbytek. */
export const HEAD_HEIGHT = 1.55;
export const HEAD_RADIUS = 0.27;
export const BODY_RADIUS = 0.33;
export const BODY_TOP = 1.3;
/** Výška očí, pro přímé viditelnosti. */
export const EYE_HEIGHT = 1.6;

const LEG_SWING = 0.7;
const ARM_SWING = 0.55;
/** Sekundy, za které se mrtvý skácí. */
const FALL_TIME = 0.6;

/** Jak se model Kenney "Blocky Characters" zmenší/zvětší a postaví na zem. */
export interface BodyFit {
  scale: number;
  lift: number;
}

export function fitBody(model: ModelData): BodyFit {
  const { minY, maxY } = verticalExtent(model);
  return { scale: CHARACTER_HEIGHT / Math.max(maxY - minY, 1e-6), lift: -minY };
}

export interface RayHit {
  distance: number;
  head: boolean;
}

/**
 * Poloha a póza postavy: chůze kývá nohama a rukama, míření zvedne pravou ruku
 * přímo vpřed a smrt postavu převrátí na záda.
 *
 * `heading` se řídí podle `rotationY`: +Z modelu míří na (sin, cos) této hodnoty.
 */
export class Body {
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  walking = false;
  /** 0 ruka dole, 1 ruka zvednutá na cíl. */
  aim = 0;
  /** Sekundy od smrti; za života záporné. */
  deadFor = -1;
  private stride = 0;

  get alive(): boolean {
    return this.deadFor < 0;
  }

  /** Směr vpřed po zemi, jednotková délka. */
  forward(): { x: number; z: number } {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  animate(dt: number, speed: number): void {
    if (!this.alive) {
      this.deadFor += dt;
      return;
    }
    if (this.walking) this.stride += dt * speed * 3.2;
  }

  die(): void {
    if (this.alive) this.deadFor = 0;
  }

  transform(fit: BodyFit): Mat4 {
    const fall = this.alive ? 0 : Math.min(this.deadFor / FALL_TIME, 1);
    const placed = multiply(translate(this.x, this.y, this.z), rotationY(this.heading));
    const toppled = multiply(placed, rotationX(-fall * fall * (Math.PI / 2)));
    return multiply(multiply(toppled, scaling(fit.scale)), translate(0, fit.lift, 0));
  }

  /** Póza po částech, ve vlastním prostoru každé části: boky a ramena jsou počátky uzlů. */
  pose(): (part: string) => Mat4 | null {
    const swing = this.walking && this.alive ? Math.sin(this.stride) : 0;
    const aim = this.aim;
    return (part) => {
      switch (part) {
        case 'leg-left':
          return rotationX(swing * LEG_SWING);
        case 'leg-right':
          return rotationX(-swing * LEG_SWING);
        case 'arm-left':
          return rotationX(-swing * ARM_SWING);
        case 'arm-right':
          return rotationX(-swing * ARM_SWING * (1 - aim) - (Math.PI / 2) * aim);
        default:
          return null;
      }
    };
  }

  /**
   * Kde paprsek poprvé narazí na toto tělo, pokud k tomu dojde do `maxDistance`.
   * `direction` musí mít jednotkovou délku.
   */
  hitBy(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    if (!this.alive) return null;
    let best: RayHit | null = null;

    const head = raySphere(
      origin,
      direction,
      { x: this.x, y: this.y + HEAD_HEIGHT, z: this.z },
      HEAD_RADIUS,
    );
    if (head !== null && head <= maxDistance) best = { distance: head, head: true };

    const body = rayCylinder(origin, direction, this.x, this.z, BODY_RADIUS);
    if (body !== null && body <= maxDistance && (!best || body < best.distance)) {
      const y = origin.y + direction.y * body;
      if (y >= this.y && y <= this.y + BODY_TOP) best = { distance: body, head: false };
    }
    return best;
  }
}

/** Nejbližší kladná vzdálenost podél paprsku ke kouli, nebo null. */
function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

/** Nejbližší kladná vzdálenost podél paprsku k nekonečnému svislému válci, nebo null. */
function rayCylinder(o: Vec3, d: Vec3, cx: number, cz: number, r: number): number | null {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = ox * d.x + oz * d.z;
  const disc = b * b - a * (ox * ox + oz * oz - r * r);
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t > 0 ? t : null;
}

/**
 * Kde leží zbraň v pravé ruce postavy: za koncem paže, hlaveň podél paže,
 * takže zvednutí paže namíří zbraň. `armMatrix` je klidová matice části paže,
 * `armPose` její póza v tomto snímku.
 */
export function handTransform(body: Mat4, armMatrix: Mat4, armPose: Mat4 | null, grip: Mat4): Mat4 {
  const arm = multiply(body, armMatrix);
  const posed = armPose ? multiply(arm, armPose) : arm;
  return multiply(posed, grip);
}
