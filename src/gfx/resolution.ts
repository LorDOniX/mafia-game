/** Pod tímto průměrem snímků za sekundu se rozlišení sníží. */
const LOW_FPS = 50;
/** Nad tímto se smí zase zvýšit; mezera mezi prahy brání přeskakování tam a zpět. */
const HIGH_FPS = 57;
const MIN_SCALE = 0.5;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;
/** Sekundy, přes které se průměruje snímková frekvence. */
const WINDOW = 1;
/** Kolik dobrých oken v řadě je potřeba, než se rozlišení zvýší. */
const RECOVER_WINDOWS = 3;

/**
 * Dynamické rozlišení: při poklesu snímkové frekvence rychle ubere pixely, při
 * rezervě je pomalu vrací. `scale` je podíl plného rozlišení na každé ose.
 */
export class AdaptiveResolution {
  scale = 1;
  private time = 0;
  private frames = 0;
  private goodWindows = 0;

  /** Vrací true, pokud se `scale` změnilo. */
  update(dt: number): boolean {
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW) return false;

    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;

    if (fps < LOW_FPS) {
      this.goodWindows = 0;
      if (this.scale <= MIN_SCALE) return false;
      this.scale = Math.max(MIN_SCALE, this.scale - STEP_DOWN);
      return true;
    }
    if (fps > HIGH_FPS && this.scale < 1) {
      if (++this.goodWindows < RECOVER_WINDOWS) return false;
      this.goodWindows = 0;
      this.scale = Math.min(1, this.scale + STEP_UP);
      return true;
    }
    this.goodWindows = 0;
    return false;
  }
}
