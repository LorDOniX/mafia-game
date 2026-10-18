import type { Camera } from './camera';
import type { Input } from './input';
import type { CityCollision } from '@/city/collision';
import type { Vehicle, VehicleControls } from '@/vehicle/vehicle';

/** Jak blízko ke karoserii musí hráč stát, aby nastoupil, v metrech. */
const ENTER_REACH = 1.5;
/** Mezera mezi karoserií a hráčem při vystoupení. */
const EXIT_CLEARANCE = 0.9;
const PLAYER_RADIUS = 0.5;

const CHASE_DISTANCE = 8;
/** Bod na voze, na který se kamera dívá, nad jeho základnou. */
const LOOK_HEIGHT = 1.4;
const DEFAULT_ORBIT_PITCH = 0.3;
const MIN_ORBIT_PITCH = -0.1;
const MAX_ORBIT_PITCH = 1.2;
/** Vyšší hodnota stočí kameru za vůz rychleji. */
const FOLLOW = 5;
/** Rychlost, kterou se odchylka pohledu myší vrací za vůz, jakmile jede. */
const RECENTRE = 1.2;
const MOUSE_SENSITIVITY = 0.0022;
const CAMERA_RADIUS = 0.3;
const MIN_CAMERA_HEIGHT = 0.5;

/**
 * Řízení: převádí klávesy na ovládání vozidla a vede chase kameru za vozem.
 * O nastoupení a vystoupení rozhoduje volající; tato třída jen odpovídá, zda je
 * hráč dost blízko a kde může vystoupit.
 */
export class DriveController {
  private cameraYaw = 0;
  private orbitYaw = 0;
  private orbitPitch = DEFAULT_ORBIT_PITCH;

  constructor(
    private readonly camera: Camera,
    private readonly input: Input,
    private readonly collision: CityCollision,
  ) {}

  /** W/S plyn a couvání, A/D zatáčení, mezerník ruční brzda. */
  controls(): VehicleControls {
    const { input } = this;
    return {
      throttle: input.axis('KeyW', 'KeyS'),
      steer: input.axis('KeyD', 'KeyA'),
      handbrake: input.isDown('Space'),
    };
  }

  /** True, pokud je (x, z) na dosah karoserie vozu. */
  canEnter(vehicle: Vehicle, x: number, z: number): boolean {
    // Vzdálenost k obdélníku půdorysu vozu, měřená v jeho vlastní soustavě.
    const dx = x - vehicle.x;
    const dz = z - vehicle.z;
    const f = vehicle.forward();
    const r = vehicle.right();
    const along = Math.abs(dx * f.x + dz * f.z) - vehicle.body.length / 2;
    const across = Math.abs(dx * r.x + dz * r.z) - vehicle.body.width / 2;

    return Math.hypot(Math.max(along, 0), Math.max(across, 0)) <= ENTER_REACH;
  }

  /** Postaví kameru přímo za vůz a zruší případnou odchylku pohledu. */
  enter(vehicle: Vehicle): void {
    this.cameraYaw = vehicle.heading;
    this.orbitYaw = 0;
    this.orbitPitch = DEFAULT_ORBIT_PITCH;
  }

  /**
   * Kde hráč vystoupí: nejprve na straně řidiče (levé), pak vpravo, vzadu
   * a vpředu. Null, pokud je vůz zablokovaný ze všech stran.
   */
  exitPoint(vehicle: Vehicle): { x: number; z: number } | null {
    const f = vehicle.forward();
    const r = vehicle.right();
    const side = vehicle.body.width / 2 + EXIT_CLEARANCE;
    const end = vehicle.body.length / 2 + EXIT_CLEARANCE;

    const candidates = [
      { x: -r.x * side, z: -r.z * side },
      { x: r.x * side, z: r.z * side },
      { x: -f.x * end, z: -f.z * end },
      { x: f.x * end, z: f.z * end },
    ];

    for (const offset of candidates) {
      const x = vehicle.x + offset.x;
      const z = vehicle.z + offset.z;
      if (!this.collision.blocked(x, z, PLAYER_RADIUS)) return { x, z };
    }
    return null;
  }

  /** Volat poté, co se vozidlo v tomto snímku pohnulo. */
  updateCamera(dt: number, vehicle: Vehicle): void {
    const { camera, input } = this;
    const look = input.pointerLocked ? input.lookDelta : { x: 0, y: 0 };

    this.orbitYaw += look.x * MOUSE_SENSITIVITY;
    this.orbitPitch = Math.min(
      Math.max(this.orbitPitch + look.y * MOUSE_SENSITIVITY, MIN_ORBIT_PITCH),
      MAX_ORBIT_PITCH,
    );

    // Rozhlížení při staní zůstává; při jízdě se pohled vrací za vůz, aby byla
    // silnice před ním vždy v záběru.
    if (Math.abs(vehicle.speed) > 2 && look.x === 0) {
      this.orbitYaw *= Math.exp(-RECENTRE * dt);
    }

    // Zpoždění za směrem jízdy, aby zatáčky působily jako pohyb, ne točící se svět.
    this.cameraYaw += wrapAngle(vehicle.heading - this.cameraYaw) * (1 - Math.exp(-FOLLOW * dt));

    const yaw = this.cameraYaw + this.orbitYaw;
    const target = { x: vehicle.x, y: vehicle.y + LOOK_HEIGHT, z: vehicle.z };
    const flat = Math.cos(this.orbitPitch) * CHASE_DISTANCE;
    const desired = {
      x: target.x - Math.sin(yaw) * flat,
      y: target.y + Math.sin(this.orbitPitch) * CHASE_DISTANCE,
      z: target.z + Math.cos(yaw) * flat,
    };

    // Přisunout kameru podél ramene, místo aby skončila uvnitř budovy.
    const steps = 16;
    let reach = 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = target.x + (desired.x - target.x) * t;
      const z = target.z + (desired.z - target.z) * t;
      if (this.collision.overlaps(x, z, CAMERA_RADIUS)) {
        reach = (i - 1) / steps;
        break;
      }
    }

    camera.position.x = target.x + (desired.x - target.x) * reach;
    camera.position.y = Math.max(target.y + (desired.y - target.y) * reach, MIN_CAMERA_HEIGHT);
    camera.position.z = target.z + (desired.z - target.z) * reach;

    const dx = target.x - camera.position.x;
    const dy = target.y - camera.position.y;
    const dz = target.z - camera.position.z;
    // Při plném přisunutí leží kamera na cíli a nemá žádný směr.
    if (Math.hypot(dx, dz) < 1e-3) return;
    camera.yaw = Math.atan2(dx, -dz);
    camera.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}

/** Zalomí úhel do (-pi, pi], aby se kamera vždy otáčela kratší cestou. */
function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.round(angle / turn);
}
