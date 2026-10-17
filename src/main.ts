import { createContext } from '@/gfx/context';
import { Renderer } from '@/gfx/renderer';
import { startLoop } from '@/core/loop';
import { Input } from '@/core/input';
import { Camera } from '@/core/camera';
import { FirstPersonController } from '@/core/controller';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import {
  CUSTOM_FACADES,
  loadCityAssets,
  loadVehicleModel,
  POLICE,
  POLICE_COUNT,
  VEHICLE,
} from '@/city/assets';
import { applyCustomFacades } from '@/city/facades';
import { DriveController } from '@/core/drive';
import { createRng } from '@/core/rng';
import { PARKED, Vehicle } from '@/vehicle/vehicle';
import { fitVehicle, vehiclePose, vehicleTransform } from '@/vehicle/model';
import { randomLoop, RouteDriver } from '@/vehicle/traffic';
import type { ModelInstance } from '@/gfx/model';

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
  applyCustomFacades(layout, CUSTOM_FACADES);
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
  const [assets, carModel, policeModel] = await Promise.all([
    loadCityAssets(),
    loadVehicleModel(),
    loadVehicleModel(POLICE),
  ]);
  prompt.textContent = defaultPrompt;

  const renderer = new Renderer(ctx, layout, assets);

  // Parked just past the spawn crossroads, in the right-hand lane of the
  // avenue the player starts out looking down.
  const car = carModel && {
    fit: fitVehicle(carModel.data, VEHICLE),
    model: renderer.createModel(carModel),
  };
  const vehicle = car && new Vehicle(car.fit.body, spawn - 2, spawn + 20, Math.PI);

  // Each patrol car gets its own random loop and starting point on it.
  const police = policeModel && {
    fit: fitVehicle(policeModel.data, POLICE),
    model: renderer.createModel(policeModel),
  };
  const trafficRng = createRng((Math.random() * 2 ** 32) >>> 0);
  const patrols = police
    ? Array.from({ length: POLICE_COUNT }, () =>
        RouteDriver.spawn(police.fit.body, randomLoop(layout, trafficRng), trafficRng),
      )
    : [];
  const drive = new DriveController(camera, input, collision);
  let driving = false;

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
    if (vehicle && input.wasPressed('KeyE')) {
      if (driving) {
        const exit = drive.exitPoint(vehicle);
        if (exit) {
          driving = false;
          controller.teleport(exit.x, exit.z, vehicle.heading);
        }
      } else if (
        controller.mode === 'walk' &&
        drive.canEnter(vehicle, camera.position.x, camera.position.z)
      ) {
        driving = true;
        drive.enter(vehicle);
      }
    }

    // The car keeps simulating when empty, so one left rolling coasts to a stop.
    vehicle?.update(dt, driving ? drive.controls() : PARKED, collision);
    if (vehicle && driving) drive.updateCamera(dt, vehicle);
    else controller.update(dt);

    for (const patrol of patrols) patrol.update(dt, collision);

    const instances: ModelInstance[] =
      car && vehicle
        ? [
            {
              model: car.model,
              transform: vehicleTransform(vehicle, car.fit),
              pose: vehiclePose(vehicle, VEHICLE),
            },
          ]
        : [];
    if (police) {
      for (const { vehicle: patrol } of patrols) {
        instances.push({
          model: police.model,
          transform: vehicleTransform(patrol, police.fit),
          pose: vehiclePose(patrol, POLICE),
        });
      }
    }
    renderer.render(camera, instances);
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
        `${driving && vehicle ? `drive ${Math.abs(vehicle.speed * 3.6).toFixed(0)} km/h` : controller.mode}  |  x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}  |  ` +
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
