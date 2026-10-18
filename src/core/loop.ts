export interface FrameInfo {
  /** Sekundy od předchozího snímku, ořezané kvůli prevenci spiral-of-death. */
  dt: number;
  /** Sekundy od spuštění smyčky. */
  elapsed: number;
  frame: number;
}

export interface LoopHandle {
  stop(): void;
}

const MAX_DT = 1 / 15;

export function startLoop(update: (info: FrameInfo) => void): LoopHandle {
  let rafId = 0;
  let last = performance.now();
  let elapsed = 0;
  let frame = 0;
  let running = true;

  function tick(now: number): void {
    if (!running) return;

    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    elapsed += dt;
    frame += 1;

    update({ dt, elapsed, frame });
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
