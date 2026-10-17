import { vec2, type Vec2 } from '@/math/vec2';

/**
 * Keyboard + pointer-lock mouse input.
 *
 * Mouse look needs relative motion, which the browser only reports while the
 * pointer is locked, so look deltas accumulate between frames and are drained
 * by `endFrame()`. Callers must read deltas before that call.
 */
/**
 * Keys the game consumes. Only these have their default action suppressed, so
 * browser shortcuts — and crucially Escape's pointer-lock release — still work.
 */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyC',
  'KeyE',
  'KeyF',
  'KeyN',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'Tab',
]);

export class Input {
  private readonly held = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly teardown: Array<() => void> = [];

  /** Accumulated mouse motion since the last `endFrame()`, in raw pixels. */
  readonly lookDelta: Vec2 = vec2();
  pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!this.held.has(e.code)) this.pressedThisFrame.add(e.code);
      this.held.add(e.code);

      // Escape releases the lock. Browsers do this themselves, but doing it
      // explicitly keeps the behaviour identical everywhere.
      if (e.code === 'Escape') {
        document.exitPointerLock();
        return;
      }

      // Space scrolls, Tab moves focus away from the canvas.
      if (this.pointerLocked && GAME_KEYS.has(e.code)) e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent): void => void this.held.delete(e.code);

    const onMouseMove = (e: MouseEvent): void => {
      if (!this.pointerLocked) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    };

    const onLockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) {
        // Keys held when focus is lost would otherwise stay stuck down.
        this.held.clear();
        this.lookDelta.x = 0;
        this.lookDelta.y = 0;
      }
    };

    // Bound to the document, not the canvas: the start overlay covers the
    // whole viewport, so a canvas-only listener never sees the first click.
    const onClick = (): void => this.requestPointerLock();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('click', onClick);

    this.teardown.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('click', onClick);
    });
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;

    // Browsers reject the request outside a user gesture and during the short
    // cooldown after Esc. Both are expected, so swallow the rejection rather
    // than let it surface as an unhandled promise.
    const pending: unknown = this.canvas.requestPointerLock();
    if (pending instanceof Promise) pending.catch(() => {});
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True only on the frame the key went down. Relies on `endFrame()`. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Returns 1, -1 or 0 for a pair of opposing keys. */
  axis(positive: string, negative: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
  }

  dispose(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
  }
}
