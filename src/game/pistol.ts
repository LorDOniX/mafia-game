/** Nábojů v plném zásobníku. */
export const MAGAZINE = 8;
const FIRE_INTERVAL = 0.22;
const RELOAD_TIME = 1.4;
/** Jak rychle odeznívá zpětný ráz, za sekundu. */
const KICK_RECOVERY = 7;

/** Hráčova pistole: zásobník, kadence a přebíjení; zásoba munice je nekonečná. */
export class Pistol {
  magazine = MAGAZINE;
  /** 1 hned po výstřelu, plynule klesá k 0, pro viewmodel a kameru. */
  kick = 0;
  private cooldown = 0;
  private reloadLeft = 0;

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  /** Průběh přebíjení 0..1; mimo přebíjení 0. */
  get reloadProgress(): number {
    return this.reloadLeft > 0 ? 1 - this.reloadLeft / RELOAD_TIME : 0;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt * KICK_RECOVERY);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) this.magazine = MAGAZINE;
    }
  }

  /** Zmáčkne spoušť; true, pokud náboj vyšel. Prázdná pistole místo toho přebíjí. */
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
