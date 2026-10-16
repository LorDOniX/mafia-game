import type { Camera } from './camera';
import type { Input } from './input';
import type { CityCollision } from '@/city/collision';
import type { Vehicle, VehicleControls } from '@/vehicle/vehicle';

/** How close to the bodywork the player must stand to get in, in metres. */
const ENTER_REACH = 1.5;
/** Gap left between the bodywork and the player on getting out. */
const EXIT_CLEARANCE = 0.9;
const PLAYER_RADIUS = 0.5;

const CHASE_DISTANCE = 8;
/** Point on the car the camera looks at, above its base. */
const LOOK_HEIGHT = 1.4;
const DEFAULT_ORBIT_PITCH = 0.3;
const MIN_ORBIT_PITCH = -0.1;
const MAX_ORBIT_PITCH = 1.2;
/** Higher swings the camera in behind the car faster. */
const FOLLOW = 5;
/** Rate at which a mouse-look offset drifts back behind the car once moving. */
const RECENTRE = 1.2;
const MOUSE_SENSITIVITY = 0.0022;
const CAMERA_RADIUS = 0.3;
const MIN_CAMERA_HEIGHT = 0.5;

/**
 * Driving: turns keys into vehicle controls and flies a chase camera behind
 * the car. Getting in and out is the caller's decision; this only answers
 * whether the player is close enough and where they can step out.
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

  /** W/S throttle and reverse, A/D steer, Space handbrake. */
  controls(): VehicleControls {
    const { input } = this;
    return {
      throttle: input.axis('KeyW', 'KeyS'),
      steer: input.axis('KeyD', 'KeyA'),
      handbrake: input.isDown('Space'),
    };
  }

  /** True if (x, z) is within reach of the car's bodywork. */
  canEnter(vehicle: Vehicle, x: number, z: number): boolean {
    // Distance to the car's footprint rectangle, measured in its own frame.
    const dx = x - vehicle.x;
    const dz = z - vehicle.z;
    const f = vehicle.forward();
    const r = vehicle.right();
    const along = Math.abs(dx * f.x + dz * f.z) - vehicle.body.length / 2;
    const across = Math.abs(dx * r.x + dz * r.z) - vehicle.body.width / 2;

    return Math.hypot(Math.max(along, 0), Math.max(across, 0)) <= ENTER_REACH;
  }

  /** Puts the camera straight behind the car, dropping any look offset. */
  enter(vehicle: Vehicle): void {
    this.cameraYaw = vehicle.heading;
    this.orbitYaw = 0;
    this.orbitPitch = DEFAULT_ORBIT_PITCH;
  }

  /**
   * Where the player steps out: the driver's (left) side first, then the
   * right, behind and ahead. Null if the car is boxed in on every side.
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

  /** Call after the vehicle has moved this frame. */
  updateCamera(dt: number, vehicle: Vehicle): void {
    const { camera, input } = this;
    const look = input.pointerLocked ? input.lookDelta : { x: 0, y: 0 };

    this.orbitYaw += look.x * MOUSE_SENSITIVITY;
    this.orbitPitch = Math.min(
      Math.max(this.orbitPitch + look.y * MOUSE_SENSITIVITY, MIN_ORBIT_PITCH),
      MAX_ORBIT_PITCH,
    );

    // Looking around while parked stays put; once driving, the view drifts
    // back behind the car so the road ahead is always in shot.
    if (Math.abs(vehicle.speed) > 2 && look.x === 0) {
      this.orbitYaw *= Math.exp(-RECENTRE * dt);
    }

    // Lag behind the heading so turns read as motion rather than a spinning world.
    this.cameraYaw += wrapAngle(vehicle.heading - this.cameraYaw) * (1 - Math.exp(-FOLLOW * dt));

    const yaw = this.cameraYaw + this.orbitYaw;
    const target = { x: vehicle.x, y: vehicle.y + LOOK_HEIGHT, z: vehicle.z };
    const flat = Math.cos(this.orbitPitch) * CHASE_DISTANCE;
    const desired = {
      x: target.x - Math.sin(yaw) * flat,
      y: target.y + Math.sin(this.orbitPitch) * CHASE_DISTANCE,
      z: target.z + Math.cos(yaw) * flat,
    };

    // Pull in along the boom rather than end up inside a building.
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
    // Fully pulled in, the camera sits on the target and has no direction.
    if (Math.hypot(dx, dz) < 1e-3) return;
    camera.yaw = Math.atan2(dx, -dz);
    camera.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}

/** Wraps an angle into (-pi, pi], so the camera always turns the short way round. */
function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.round(angle / turn);
}
