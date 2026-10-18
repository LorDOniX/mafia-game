import type { Camera } from './camera';
import type { Input } from './input';
import type { CityCollision } from '@/city/collision';

export type MoveMode = 'walk' | 'fly';

const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.45;
const WALK_SPEED = 6;
const WALK_SPRINT = 12;
const FLY_SPEED = 24;
const FLY_SPRINT = 70;
const MOUSE_SENSITIVITY = 0.0022;
/** Vyšší hodnota usadí kameru na cílovou rychlost rychleji. */
const DAMPING = 14;
/** Rychlost odrazu v m/s a gravitace v m/s^2: skok zhruba 1 m. */
const JUMP_SPEED = 6;
const GRAVITY = 18;

/**
 * Ovladač WASD + rozhlížení myší se dvěma režimy: `walk` drží kameru ve výšce
 * očí a koliduje s budovami, `fly` je bez omezení pro prohlížení města shora.
 */
export class FirstPersonController {
  mode: MoveMode = 'walk';

  private velocity = { x: 0, y: 0, z: 0 };
  private airborne = false;

  constructor(
    private readonly camera: Camera,
    private readonly input: Input,
    private readonly collision: CityCollision,
  ) {}

  teleport(x: number, z: number, yaw = 0): void {
    this.camera.position.x = x;
    this.camera.position.z = z;
    this.camera.position.y = this.collision.groundHeightAt(x, z) + EYE_HEIGHT;
    this.camera.yaw = yaw;
    this.camera.pitch = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.airborne = false;
  }

  update(dt: number): void {
    const { camera, input } = this;

    if (input.wasPressed('KeyF')) {
      this.mode = this.mode === 'walk' ? 'fly' : 'walk';
      this.airborne = false;
    }

    if (input.pointerLocked) {
      camera.addLook(input.lookDelta.x * MOUSE_SENSITIVITY, -input.lookDelta.y * MOUSE_SENSITIVITY);
    }

    const forwardAxis = input.axis('KeyW', 'KeyS');
    const strafeAxis = input.axis('KeyD', 'KeyA');
    const sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

    // Směr pohybu: fly sleduje vektor pohledu, walk zůstává vodorovně.
    const forward = this.mode === 'fly' ? camera.forward() : camera.groundForward();
    const right = camera.groundRight();

    let targetX = forward.x * forwardAxis + right.x * strafeAxis;
    let targetY = forward.y * forwardAxis;
    let targetZ = forward.z * forwardAxis + right.z * strafeAxis;

    if (this.mode === 'fly') {
      targetY += input.axis('Space', 'KeyC');
    }

    const magnitude = Math.hypot(targetX, targetY, targetZ);
    if (magnitude > 0) {
      // Normalizace, aby diagonály nebyly rychlejší než pohyb v hlavních směrech.
      const speed =
        this.mode === 'fly'
          ? sprinting
            ? FLY_SPRINT
            : FLY_SPEED
          : sprinting
            ? WALK_SPRINT
            : WALK_SPEED;
      const scale = speed / magnitude;
      targetX *= scale;
      targetY *= scale;
      targetZ *= scale;
    }

    // Exponenciální vyhlazování k cílové rychlosti nezávislé na snímkové frekvenci.
    const blend = 1 - Math.exp(-DAMPING * dt);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    // Při chůzi svislou rychlost řídí skok a gravitace.
    if (this.mode === 'fly') this.velocity.y += (targetY - this.velocity.y) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    const nextX = camera.position.x + this.velocity.x * dt;
    const nextZ = camera.position.z + this.velocity.z * dt;

    if (this.mode === 'walk') {
      const resolved = this.collision.resolve(
        camera.position.x,
        camera.position.z,
        nextX,
        nextZ,
        PLAYER_RADIUS,
      );
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;

      const ground = this.collision.groundHeightAt(resolved.x, resolved.z) + EYE_HEIGHT;
      if (!this.airborne && input.wasPressed('Space')) {
        this.airborne = true;
        this.velocity.y = JUMP_SPEED;
      }

      if (this.airborne) {
        this.velocity.y -= GRAVITY * dt;
        camera.position.y += this.velocity.y * dt;
        if (camera.position.y <= ground) {
          camera.position.y = ground;
          this.airborne = false;
          this.velocity.y = 0;
        }
      } else {
        // Obrubníky mají jen 15cm, takže přichycení nahoru na ně působí plynule.
        camera.position.y += (ground - camera.position.y) * blend;
        this.velocity.y = 0;
      }
    } else {
      camera.position.x = nextX;
      camera.position.z = nextZ;
      camera.position.y += this.velocity.y * dt;
    }
  }
}
