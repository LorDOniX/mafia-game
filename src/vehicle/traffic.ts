import type { CityLayout } from '@/city/layout';
import { circleHitsObstacle, type Obstacle } from '@/city/collision';
import type { Rng } from '@/core/rng';
import { Vehicle, type VehicleBody } from './vehicle';

/**
 * Městská doprava: auta projíždějí uliční síť pruh po pruhu, na každé
 * křižovatce si volí směr, řadí se za tím, co je před nimi, a na křižovatkách
 * se střídají. Auta jedou přesně po svých trasách (bez fyziky), což je drží
 * na vozovce; hráčovo auto řízené fyzikou je potkává jako překážky.
 */

export interface Point {
  x: number;
  z: number;
}

interface PathPoint extends Point {
  /** Směr jízdy v tomto bodě, v konvenci headingu vozidla. */
  heading: number;
}

/** Úsek, po kterém auto jede: pruh mezi křižovatkami, nebo průjezd křižovatkou. */
export interface Path {
  points: PathPoint[];
  /** Vzdálenost podél trasy k jednotlivým bodům. */
  distances: number[];
  length: number;
}

export type Turn = 'straight' | 'right' | 'left';

/** Jeden směr jednoho úseku ulice, od křižovatky ke křižovatce. */
export interface Lane {
  from: Junction;
  to: Junction;
  /** Index do DIRECTIONS. */
  direction: number;
  path: Path;
}

export interface Junction {
  x: number;
  z: number;
  /** Odjezdové pruhy podle směru; chybí tam, kde síť končí. */
  exits: Array<Lane | undefined>;
  /** Průjezdy, s klíčem `${approach direction}:${turn}`. */
  ways: Map<string, Path>;
  /** Auta uvnitř nebo s povolením vjet. */
  occupants: Set<TrafficCar>;
}

export interface RoadNetwork {
  junctions: Junction[];
  lanes: Lane[];
}

/** Směry jízdy: sever (-Z), východ (+X), jih (+Z), západ (-X). Odbočení vpravo přičte jedna. */
const DIRECTIONS: readonly Point[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];
const TURN_OFFSET: Record<Turn, number> = { straight: 0, right: 1, left: 3 };
const TURN_SPEED: Record<Turn, number> = { straight: 9, right: 3, left: 5 };
/** Šance jednotlivých směrů na křižovatce, před vyřazením těch, které neexistují. */
const TURN_WEIGHT: Record<Turn, number> = { straight: 2, right: 1, left: 1 };

const ARC_STEPS = 12;
const CRUISE = { min: 9, max: 13 };
/** m/s^2 */
const ACCELERATION = 2.5;
const COMFORT_BRAKING = 4;
const HARD_BRAKING = 10;
/** Odstup nárazník–nárazník udržovaný v koloně, metry. */
const MIN_GAP = 2;
/** Jak blízko křižovatky auto žádá o průjezd, metry. */
const REQUEST_DISTANCE = 6;
/** Místo, které auto potřebuje za křižovatkou, než smí vjet, nad rámec vlastní délky. */
const EXIT_ROOM = 3;
/** Po takto dlouhém čekání na místo na výjezdu si auto zvolí jiný směr. */
const PATIENCE = 4;
/** Boční rezerva při rozhodování, zda je něco v dráze auta. */
const LATERAL_MARGIN = 0.2;
/** Jak daleko dopředu auto hledá, kvůli čemu zastavit, a s jakým krokem, metry. */
const SIGHT = 40;
const SIGHT_STEP = 1;

/** Sestaví pruhy a křižovatky všech vnitřních ulic; okrajové ulice mají poloviční šířku. */
export function buildRoadNetwork(layout: CityLayout): RoadNetwork {
  const { gridSize, streetWidth, sidewalkWidth } = layout.config;
  const { pitch } = layout;
  // Polovina vozovky: plochy křižovatek a konce pruhů leží takto daleko od středu.
  const half = streetWidth / 2 - sidewalkWidth;
  const lane = half / 2;

  const junctions = new Map<string, Junction>();
  for (let i = 1; i < gridSize; i++) {
    for (let j = 1; j < gridSize; j++) {
      junctions.set(`${i},${j}`, {
        x: i * pitch,
        z: j * pitch,
        exits: [],
        ways: new Map(),
        occupants: new Set(),
      });
    }
  }

  const lanes: Lane[] = [];
  for (let i = 1; i < gridSize; i++) {
    for (let j = 1; j < gridSize; j++) {
      const from = junctions.get(`${i},${j}`);
      if (!from) continue;
      DIRECTIONS.forEach((d, direction) => {
        const to = junctions.get(`${i + d.x},${j + d.z}`);
        if (!to) return;
        const r = rightOf(d);
        const offset = { x: r.x * lane, z: r.z * lane };
        const path = makePath([
          {
            x: from.x + d.x * half + offset.x,
            z: from.z + d.z * half + offset.z,
            heading: headingOf(d),
          },
          {
            x: to.x - d.x * half + offset.x,
            z: to.z - d.z * half + offset.z,
            heading: headingOf(d),
          },
        ]);
        const created: Lane = { from, to, direction, path };
        from.exits[direction] = created;
        lanes.push(created);
      });
    }
  }

  for (const junction of junctions.values()) {
    for (let approach = 0; approach < 4; approach++) {
      for (const turn of Object.keys(TURN_OFFSET) as Turn[]) {
        const out = (approach + TURN_OFFSET[turn]) % 4;
        if (!junction.exits[out]) continue;
        junction.ways.set(`${approach}:${turn}`, wayAcross(junction, approach, turn, half, lane));
      }
    }
  }

  return { junctions: [...junctions.values()], lanes };
}

/**
 * Trasa přes křižovatku, od stopčáry na protější stranu: přímka, nebo
 * čtvrtkruh tečný k oběma pruhům — vpravo těsný, vlevo široký přes protisměrný
 * pruh.
 */
function wayAcross(c: Point, approach: number, turn: Turn, half: number, lane: number): Path {
  const d = direction(approach);
  const o = direction((approach + TURN_OFFSET[turn]) % 4);
  const rd = rightOf(d);
  const start = { x: c.x - d.x * half + rd.x * lane, z: c.z - d.z * half + rd.z * lane };

  if (turn === 'straight') {
    return makePath([
      { ...start, heading: headingOf(d) },
      { x: start.x + d.x * half * 2, z: start.z + d.z * half * 2, heading: headingOf(d) },
    ]);
  }

  const radius = turn === 'right' ? half - lane : half + lane;
  const centre = { x: start.x + o.x * radius, z: start.z + o.z * radius };
  const u = { x: -o.x * radius, z: -o.z * radius };
  const v = { x: d.x * radius, z: d.z * radius };
  const points: PathPoint[] = [];
  for (let s = 0; s <= ARC_STEPS; s++) {
    const phi = (s / ARC_STEPS) * (Math.PI / 2);
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    points.push({
      x: centre.x + u.x * cos + v.x * sin,
      z: centre.z + u.z * cos + v.z * sin,
      heading: headingOf({ x: v.x * cos - u.x * sin, z: v.z * cos - u.z * sin }),
    });
  }
  return makePath(points);
}

/** Auto v provozu: `Vehicle` pro vykreslení, vedené po síti. */
export class TrafficCar {
  readonly vehicle: Vehicle;
  /** Pruh, po kterém jede, nebo ten právě opuštěný při průjezdu křižovatkou. */
  lane: Lane;
  /** Kam pojede na konci `lane`. */
  turn: Turn = 'straight';
  crossing = false;
  /** Má povolení vjet do křižovatky na konci `lane`. */
  cleared = false;

  private distance: number;
  private waited = 0;
  private segment = 0;

  constructor(
    body: VehicleBody,
    lane: Lane,
    distance: number,
    readonly cruise: number,
    rng: Rng,
  ) {
    this.vehicle = new Vehicle(body, 0, 0, 0);
    this.lane = lane;
    this.distance = distance;
    this.chooseTurn(rng);
    this.place();
  }

  get path(): Path {
    return this.crossing ? this.way : this.lane.path;
  }

  private get way(): Path {
    const way = this.lane.to.ways.get(`${this.lane.direction}:${this.turn}`);
    if (!way) throw new Error(`No way ${this.turn} at a crossroads`);
    return way;
  }

  /** Pruh, na kterém bude po křižovatce na konci tohoto pruhu. */
  get exit(): Lane {
    const exit = this.lane.to.exits[(this.lane.direction + TURN_OFFSET[this.turn]) % 4];
    if (!exit) throw new Error(`No exit ${this.turn} at a crossroads`);
    return exit;
  }

  /** Půdorys auta, aby za ním ostatní zastavili a hráč do něj mohl narazit. */
  obstacle(): Obstacle {
    const { vehicle } = this;
    return {
      x: vehicle.x,
      z: vehicle.z,
      heading: vehicle.heading,
      halfLength: vehicle.body.length / 2,
      halfWidth: vehicle.body.width / 2,
      owner: this,
    };
  }

  update(dt: number, obstacles: readonly Obstacle[], rng: Rng): void {
    const { vehicle } = this;
    const halfLength = vehicle.body.length / 2;
    // Od předního nárazníku, protože ten musí zůstat mimo křižovatku.
    const remaining = this.path.length - this.distance - (this.crossing ? 0 : halfLength);

    if (!this.crossing && !this.cleared && remaining < REQUEST_DISTANCE) {
      this.cleared = this.requestCrossing(obstacles);
      if (!this.cleared) {
        this.waited += dt;
        if (this.waited > PATIENCE && this.exitBlocked(obstacles)) {
          this.chooseTurn(rng, this.turn);
          this.waited = 0;
        }
      }
    }

    let target = this.crossing ? TURN_SPEED[this.turn] : this.cruise;
    if (!this.crossing) {
      // Stát na čáře do povolení, pak vjet do odbočení jeho rychlostí.
      const endSpeed = this.cleared ? TURN_SPEED[this.turn] : 0;
      const room = Math.max(this.cleared ? remaining + halfLength : remaining - 0.5, 0);
      target = Math.min(target, Math.sqrt(endSpeed * endSpeed + 2 * COMFORT_BRAKING * room));
    }
    const gap = this.gapAhead(obstacles);
    target = Math.min(target, Math.sqrt(2 * COMFORT_BRAKING * Math.max(gap - MIN_GAP, 0)));

    vehicle.speed =
      target > vehicle.speed
        ? Math.min(target, vehicle.speed + ACCELERATION * dt)
        : Math.max(target, vehicle.speed - HARD_BRAKING * dt);

    const step = vehicle.speed * dt;
    this.distance += step;
    vehicle.wheelSpin += step / vehicle.body.wheelRadius;

    if (this.distance >= this.path.length) {
      if (this.crossing) {
        this.distance -= this.path.length;
        this.lane.to.occupants.delete(this);
        this.lane = this.exit;
        this.crossing = false;
        this.cleared = false;
        this.waited = 0;
        this.chooseTurn(rng);
      } else if (this.cleared) {
        this.distance -= this.path.length;
        this.crossing = true;
      } else {
        this.distance = this.path.length;
        vehicle.speed = 0;
      }
      this.segment = 0;
    }

    this.place();
    this.steerAlongPath(dt);
  }

  /** Smí projet, pokud nikdo uvnitř nejede po křížící se trase a za křižovatkou je místo. */
  private requestCrossing(obstacles: readonly Obstacle[]): boolean {
    const junction = this.lane.to;
    for (const other of junction.occupants) {
      if (other !== this && !compatible(this, other)) return false;
    }
    if (this.exitBlocked(obstacles)) return false;
    junction.occupants.add(this);
    this.waited = 0;
    return true;
  }

  /**
   * V prvních několika metrech pruhu, do kterého chce vjet, něco stojí, nebo bude
   * stát, až tam dojedou auta, která už k tomuto pruhu projíždějí křižovatkou.
   */
  private exitBlocked(obstacles: readonly Obstacle[]): boolean {
    const exit = this.exit;
    const start = exit.path.points[0];
    if (!start) return false;
    const d = direction(exit.direction);
    let need = this.vehicle.body.length + EXIT_ROOM;
    for (const other of this.lane.to.occupants) {
      if (other !== this && other.exit === exit) need += other.vehicle.body.length + MIN_GAP;
    }
    return obstacles.some((o) => {
      if (o.owner === this) return false;
      const dx = o.x - start.x;
      const dz = o.z - start.z;
      const along = dx * d.x + dz * d.z;
      const across = Math.abs(dx * -d.z + dz * d.x);
      return along > -o.halfLength && along < need + o.halfLength && across < 2;
    });
  }

  /**
   * Vzdálenost nárazník–nárazník k nejbližší věci na cestě, kterou auto pojede,
   * až do jeho dohledu. Díky sledování trasy místo pohledu přímo vpřed auto
   * v půli zatáčky nezastaví kvůli jinému, které čeká na straně.
   */
  private gapAhead(obstacles: readonly Obstacle[]): number {
    const { vehicle } = this;
    const reach = SIGHT + 5;
    const near = obstacles.filter(
      (o) =>
        o.owner !== this && Math.abs(o.x - vehicle.x) < reach && Math.abs(o.z - vehicle.z) < reach,
    );
    if (near.length === 0) return SIGHT;

    const radius = vehicle.body.width / 2 + LATERAL_MARGIN;
    const halfLength = vehicle.body.length / 2;
    for (let s = SIGHT_STEP; s <= SIGHT; s += SIGHT_STEP) {
      const p = this.pointAhead(s);
      if (near.some((o) => circleHitsObstacle(p.x, p.z, radius, o))) {
        return Math.max(s + radius - halfLength, 0);
      }
    }
    return SIGHT;
  }

  /** Kde bude střed auta o `ahead` metrů dál, přes křižovatku a ven z ní. */
  private pointAhead(ahead: number): Point {
    const route = this.crossing
      ? [this.way, this.exit.path]
      : [this.lane.path, this.way, this.exit.path];
    let d = this.distance + ahead;
    for (const path of route) {
      if (d <= path.length) return pointOn(path, d);
      d -= path.length;
    }
    const last = route[route.length - 1];
    return last ? pointOn(last, last.length) : { x: this.vehicle.x, z: this.vehicle.z };
  }

  private chooseTurn(rng: Rng, avoid?: Turn): void {
    const junction = this.lane.to;
    const options = (Object.keys(TURN_OFFSET) as Turn[]).filter(
      (turn) => turn !== avoid && junction.exits[(this.lane.direction + TURN_OFFSET[turn]) % 4],
    );
    if (options.length === 0) return;

    let pick = rng.range(
      0,
      options.reduce((sum, t) => sum + TURN_WEIGHT[t], 0),
    );
    for (const turn of options) {
      pick -= TURN_WEIGHT[turn];
      if (pick <= 0) {
        this.turn = turn;
        return;
      }
    }
    this.turn = options[options.length - 1] ?? this.turn;
  }

  private place(): void {
    const { points, distances } = this.path;
    let i = this.segment;
    while (i < points.length - 2 && (distances[i + 1] ?? 0) <= this.distance) i++;
    this.segment = i;

    const a = points[i];
    const b = points[i + 1] ?? a;
    if (!a || !b) return;
    const from = distances[i] ?? 0;
    const span = (distances[i + 1] ?? from) - from;
    const t = span > 0 ? Math.min(Math.max((this.distance - from) / span, 0), 1) : 0;

    this.vehicle.x = a.x + (b.x - a.x) * t;
    this.vehicle.z = a.z + (b.z - a.z) * t;
    this.vehicle.heading = a.heading + wrapAngle(b.heading - a.heading) * t;
    this.vehicle.y = 0;
  }

  /** Přední kola sledují zakřivení trasy, plynule, aby necukala. */
  private steerAlongPath(dt: number): void {
    const { points, distances } = this.path;
    const a = points[this.segment];
    const b = points[this.segment + 1];
    const span = (distances[this.segment + 1] ?? 0) - (distances[this.segment] ?? 0);
    const curvature = a && b && span > 0 ? wrapAngle(b.heading - a.heading) / span : 0;
    const target = Math.atan(this.vehicle.body.wheelbase * curvature);
    const step = this.vehicle.handling.steerRate * dt;
    this.vehicle.steer += Math.max(-step, Math.min(step, target - this.vehicle.steer));
  }
}

/** Veškerá doprava ve městě. */
export class Traffic {
  readonly cars: TrafficCar[] = [];

  constructor(readonly network: RoadNetwork) {}

  /**
   * Umístí auto na náhodné místo v síti, mimo všechna ostatní auta i mimo
   * `avoid`. Vrátí null, pokud se volné místo nenašlo.
   */
  spawn(body: VehicleBody, rng: Rng, avoid: readonly Obstacle[] = []): TrafficCar | null {
    const clearance = body.length + MIN_GAP * 2;
    for (let tries = 0; tries < 50; tries++) {
      const lane = rng.pick(this.network.lanes);
      const distance = rng.range(clearance / 2, lane.path.length - REQUEST_DISTANCE - body.length);
      if (distance <= 0) continue;
      const car = new TrafficCar(body, lane, distance, rng.range(CRUISE.min, CRUISE.max), rng);
      const { x, z } = car.vehicle;
      const crowded = [...this.cars.map((c) => c.obstacle()), ...avoid].some(
        (o) => Math.hypot(o.x - x, o.z - z) < clearance / 2 + o.halfLength,
      );
      if (crowded) continue;
      this.cars.push(car);
      return car;
    }
    return null;
  }

  /** Natrvalo vyřadí auto z provozu a uvolní každou křižovatku, kterou si zabralo. */
  remove(car: TrafficCar): void {
    const index = this.cars.indexOf(car);
    if (index >= 0) this.cars.splice(index, 1);
    for (const junction of this.network.junctions) junction.occupants.delete(car);
  }

  /** Půdorysy všech aut, pro kolizní svět i pro sebe navzájem. */
  obstacles(): Obstacle[] {
    return this.cars.map((car) => car.obstacle());
  }

  /** `others` je to, kvůli čemu musí doprava také zastavit: hráč, hráčovo auto. */
  update(dt: number, others: readonly Obstacle[], rng: Rng): void {
    const all = [...this.obstacles(), ...others];
    for (const car of this.cars) car.update(dt, all, rng);
  }
}

/**
 * Dvě auta smějí sdílet křižovatku, pokud přijíždějí ze stejného směru, nebo proti sobě
 * a žádné neodbočuje vlevo.
 */
function compatible(a: TrafficCar, b: TrafficCar): boolean {
  const approachA = a.lane.direction;
  const approachB = b.lane.direction;
  if (approachA === approachB) return true;
  return (approachA + 2) % 4 === approachB && a.turn !== 'left' && b.turn !== 'left';
}

function makePath(points: PathPoint[]): Path {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    distances.push((distances[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { points, distances, length: distances[distances.length - 1] ?? 0 };
}

function direction(index: number): Point {
  return DIRECTIONS[((index % 4) + 4) % 4] ?? { x: 0, z: -1 };
}

/** Bod `distance` metrů podél trasy. */
function pointOn(path: Path, distance: number): Point {
  const { points, distances } = path;
  for (let i = 0; i + 1 < points.length; i++) {
    const to = distances[i + 1] ?? 0;
    if (distance > to && i + 2 < points.length) continue;
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) break;
    const from = distances[i] ?? 0;
    const t = to > from ? Math.min(Math.max((distance - from) / (to - from), 0), 1) : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  return points[0] ?? { x: 0, z: 0 };
}

/** Pravá strana ke směru jízdy, v konvenci headingu vozidla. */
const rightOf = (d: Point): Point => ({ x: -d.z, z: d.x });

/** Heading mířící podél `d`: 0 je -Z, pi/2 je +X. */
const headingOf = (d: Point): number => Math.atan2(d.x, -d.z);

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
