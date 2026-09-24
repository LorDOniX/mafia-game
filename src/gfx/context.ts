export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Resizes the drawing buffer to the CSS size * DPR. Returns true if it changed. */
  resize(): boolean;
}

export function createContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
  });

  if (!gl) {
    throw new Error('WebGL2 is not supported in this browser.');
  }

  function resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

    if (canvas.width === width && canvas.height === height) return false;

    canvas.width = width;
    canvas.height = height;
    gl!.viewport(0, 0, width, height);
    return true;
  }

  resize();
  return { gl, canvas, resize };
}
