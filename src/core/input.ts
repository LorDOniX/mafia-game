import { vec2, type Vec2 } from '@/math/vec2';

/**
 * Vstup z klávesnice + myši s pointer lockem.
 *
 * Rozhlížení myší potřebuje relativní pohyb, který prohlížeč hlásí jen při
 * zamčeném kurzoru, takže se delty pohledu mezi snímky sčítají a vyprázdní je
 * `endFrame()`. Volající musí delty přečíst před tímto voláním.
 */
/**
 * Klávesy, které hra zpracovává. Jen u nich se potlačí výchozí akce, takže
 * zkratky prohlížeče — a hlavně uvolnění pointer locku klávesou Escape — stále
 * fungují.
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
  'KeyR',
  'KeyT',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'Tab',
]);

/** Jak dlouho po ztrátě zámku Esc ještě nepokračuje: tentýž stisk může doručit keydown až po uvolnění. */
const RESUME_GUARD_MS = 250;

export class Input {
  private readonly held = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly teardown: Array<() => void> = [];
  private unlockedAt = -Infinity;

  /** Nasčítaný pohyb myši od posledního `endFrame()`, v surových pixelech. */
  readonly lookDelta: Vec2 = vec2();
  pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!this.held.has(e.code)) this.pressedThisFrame.add(e.code);
      this.held.add(e.code);

      // Escape přepíná pauzu: ve hře uvolní zámek (prohlížeče to dělají samy, ale
      // explicitní volání zajišťuje všude stejné chování), v menu ho znovu zachytí.
      if (e.code === 'Escape') {
        if (this.pointerLocked) document.exitPointerLock();
        else if (performance.now() - this.unlockedAt > RESUME_GUARD_MS) this.requestPointerLock();
        return;
      }

      // Mezerník posouvá stránku, Tab přesouvá fokus pryč z canvasu.
      if (this.pointerLocked && GAME_KEYS.has(e.code)) e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent): void => void this.held.delete(e.code);

    const onMouseMove = (e: MouseEvent): void => {
      if (!this.pointerLocked) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    };

    // Tlačítka se počítají jen ve hře, takže klik, který zachytí myš, nikdy nevystřelí.
    const onMouseDown = (e: MouseEvent): void => {
      if (!this.pointerLocked) return;
      const code = `Mouse${e.button}`;
      if (!this.held.has(code)) this.pressedThisFrame.add(code);
      this.held.add(code);
    };
    const onMouseUp = (e: MouseEvent): void => void this.held.delete(`Mouse${e.button}`);

    const onLockChange = (): void => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) {
        if (wasLocked) this.unlockedAt = performance.now();
        // Klávesy držené při ztrátě fokusu by jinak zůstaly zaseknuté dole.
        this.held.clear();
        this.lookDelta.x = 0;
        this.lookDelta.y = 0;
      }
    };

    // Navázáno na document, ne na canvas: úvodní overlay překrývá celý viewport,
    // takže listener jen na canvasu by první klik nikdy nezachytil.
    const onClick = (): void => this.requestPointerLock();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('click', onClick);

    this.teardown.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('click', onClick);
    });
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;

    // Prohlížeče požadavek odmítnou mimo uživatelské gesto a během krátké
    // prodlevy po Esc. Obě situace jsou očekávané, takže se zamítnutí spolkne,
    // místo aby se projevilo jako neošetřený promise.
    const pending: unknown = this.canvas.requestPointerLock();
    if (pending instanceof Promise) pending.catch(() => {});
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True jen ve snímku, kdy byla klávesa stisknuta. Spoléhá na `endFrame()`. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Vrací 1, -1 nebo 0 pro dvojici protichůdných kláves. */
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
