import { createContext } from '@/gfx/context';
import { Renderer } from '@/gfx/renderer';
import { startLoop } from '@/core/loop';
import { Input } from '@/core/input';
import { Camera } from '@/core/camera';
import { FirstPersonController } from '@/core/controller';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import { loadCityAssets } from '@/city/assets';

const HUD_INTERVAL = 0.25;

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const crosshair = document.querySelector<HTMLElement>('#crosshair');
  const hud = document.querySelector<HTMLElement>('#hud');

  if (!canvas || !overlay || !prompt || !crosshair || !hud) {
    throw new Error('Missing required DOM nodes');
  }

  const ctx = createContext(canvas);
  const layout = generateCity();
  const collision = new CityCollision(layout);

  const camera = new Camera();
  camera.aspect = canvas.width / canvas.height;

  const input = new Input(canvas);
  const controller = new FirstPersonController(camera, input, collision);

  // Spawn in the middle of a crossroads, looking down the avenue: block N
  // starts at N * pitch + streetWidth / 2, so whole multiples of the pitch land
  // on street centrelines.
  const spawn = Math.floor(layout.config.gridSize / 2) * layout.pitch;
  controller.teleport(spawn, spawn, Math.PI);

  // Textures and the sky are built or fetched before the first frame, so the
  // renderer itself stays synchronous.
  const defaultPrompt = prompt.textContent ?? 'Click to enter the city';
  prompt.textContent = 'Building Lost Heaven\u2026';
  const assets = await loadCityAssets();
  prompt.textContent = defaultPrompt;

  const renderer = new Renderer(ctx, layout, assets);

  // A denied lock request (no user gesture, or the cooldown right after Esc)
  // would otherwise read as a dead click.
  document.addEventListener('pointerlockerror', () => {
    prompt.textContent = 'Could not capture the mouse \u2014 click again';
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) prompt.textContent = defaultPrompt;
  });

  overlay.hidden = false;
  let hudTimer = 0;
  let fps = 0;

  startLoop(({ dt, elapsed }) => {
    controller.update(dt);
    renderer.render(camera);
    input.endFrame();

    const locked = input.pointerLocked;
    overlay.hidden = locked;
    crosshair.hidden = !locked;

    // Smooth the frame rate before showing it; raw per-frame dt is unreadable.
    fps += (1 / Math.max(dt, 1e-6) - fps) * 0.1;

    hudTimer += dt;
    if (hudTimer >= HUD_INTERVAL) {
      hudTimer = 0;
      const p = camera.position;
      hud.textContent =
        `${fps.toFixed(0)} fps  |  ${renderer.stats.triangles.toLocaleString()} tris  |  ` +
        `${controller.mode}  |  x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}  |  ` +
        `${elapsed.toFixed(0)}s`;
    }
  });
}

main().catch((error: unknown) => {
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  overlay?.classList.add('error');
  if (prompt) prompt.textContent = error instanceof Error ? error.message : String(error);
  throw error;
});
