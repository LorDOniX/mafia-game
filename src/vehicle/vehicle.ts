/**
 * Arkádové ovládání auta: kinematický model kola (bicycle model), bez fyzikálního enginu.
 *
 * Auto se pohybuje ve směru headingu rychlostí `speed` a zatáčí rychlostí danou
 * úhlem natočení kol a rozvorem, takže se nemůže otočit na místě a ve vysoké
 * rychlosti vynáší do šířky jako skutečné auto. Kolize řeší řada kruhů podél
 * podélné osy auta, testovaná proti mřížce budov ve městě.
 *
 * Heading používá konvenci yaw kamery: 0 míří na -Z a kladné hodnoty otáčejí
 * po směru hodinových ručiček při pohledu shora, takže kladné řízení zatáčí vpravo.
 */

/** Fyzické rozměry, v metrech. */
export interface VehicleBody {
  length: number;
  width: number;
  /** Vzdálenost mezi přední a zadní nápravou; určuje poloměr otáčení. */
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
  /** Zpomalení při jízdě setrvačností. */
  rolling: number;
  handbrake: number;
  /** Úhel předních kol při stání, v radiánech. */
  maxSteer: number;
  /** Jak rychle se kola natáčejí k požadovanému úhlu, rad/s. */
  steerRate: number;
  /**
   * Rychlost, při které se maximální natočení kol sníží na polovinu. Udržuje auto
   * ovladatelné ve vysoké rychlosti, kde by ho plný rejd roztočil.
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
  /** 1 zrychluje vpřed, -1 brzdí a pak couvá. */
  throttle: number;
  /** 1 zatáčí vpravo, -1 vlevo. */
  steer: number;
  handbrake: boolean;
}

/** Prázdné auto: žádný vstup, zatažená ruční brzda, takže dojede do zastavení. */
export const PARKED: VehicleControls = { throttle: 0, steer: 0, handbrake: true };

export interface VehicleWorld {
  /** True, pokud by se kruh v (x, z) překrýval s něčím pevným. */
  blocked(x: number, z: number, radius: number): boolean;
  groundHeightAt(x: number, z: number): number;
}

/** Podíl rychlosti zachovaný za sekundu při odírání o zeď. */
const SCRAPE_RETAIN = 0.15;
/** Podíl rychlosti odražený zpět při čelním nárazu. */
const BOUNCE = 0.25;
/** Vyšší hodnota rychleji usadí auto na obrubník. */
const SUSPENSION = 12;

export class Vehicle {
  y = 0;
  /** m/s ve směru headingu; záporná hodnota je couvání. */
  speed = 0;
  /** Aktuální úhel předních kol, radiány. */
  steer = 0;
  /** Nasčítané otočení kol, radiány, pro vykreslení. */
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
      // Plyn vpřed při couvání nejdřív brzdí.
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

    // Šikmý náraz: klouzat po ose, která je volná, a ztrácet rychlost.
    const scrape = Math.pow(SCRAPE_RETAIN, dt);
    if (this.fits(nextX, this.z, heading, world)) {
      this.place(nextX, this.z, heading, distance);
      this.speed *= scrape;
    } else if (this.fits(this.x, nextZ, heading, world)) {
      this.place(this.x, nextZ, heading, distance);
      this.speed *= scrape;
    } else {
      // Čelní náraz: zůstat na místě a trochu se odrazit zpět.
      this.speed *= -BOUNCE;
    }
  }

  private place(x: number, z: number, heading: number, distance: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.wheelSpin += distance / this.body.wheelRadius;
  }

  /** Kruhy o poloměru poloviny šířky auta, rozmístěné tak, aby pokryly jeho délku. */
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

/** Posune `value` k `target` nejvýše o `step`. */
const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(value + step, target) : Math.max(value - step, target);
