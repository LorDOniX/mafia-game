/** Rounds in a full magazine. */
export const MAGAZINE = 8;
const FIRE_INTERVAL = 0.22;
const RELOAD_TIME = 1.4;
/** How fast the recoil kick settles, per second. */
const KICK_RECOVERY = 7;

/** The player's pistol: a magazine, a rate of fire and a reload; reserve ammo is endless. */
export class Pistol {
  magazine = MAGAZINE;
  /** 1 right after a shot, easing back to 0, for the viewmodel and the camera. */
  kick = 0;
  private cooldown = 0;
  private reloadLeft = 0;

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt * KICK_RECOVERY);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) this.magazine = MAGAZINE;
    }
  }

  /** Pulls the trigger; true if a round went off. An empty pistol reloads instead. */
  trigger(): boolean {
    if (this.reloading || this.cooldown > 0) return false;
    if (this.magazine === 0) {
      this.reload();
      return false;
    }
    this.magazine--;
    this.cooldown = FIRE_INTERVAL;
    this.kick = 1;
    if (this.magazine === 0) this.reload();
    return true;
  }

  reload(): void {
    if (!this.reloading && this.magazine < MAGAZINE) this.reloadLeft = RELOAD_TIME;
  }
}
