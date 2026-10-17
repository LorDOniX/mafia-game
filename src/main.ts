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
  loadOptionalModel,
  PARK_TREES,
  POLICE,
  POLICE_COUNT,
  STREET_TREES,
  TREE_MODELS,
  VEHICLE,
  type TreeSpecies,
} from '@/city/assets';
import { applyCustomFacades } from '@/city/facades';
import { speciesAt, treeTransform } from '@/city/trees';
import { DriveController } from '@/core/drive';
import { createRng } from '@/core/rng';
import { PARKED, Vehicle } from '@/vehicle/vehicle';
import { fitVehicle, vehiclePose, vehicleTransform } from '@/vehicle/model';
import { randomLoop, RouteDriver } from '@/vehicle/traffic';
import { Minimap, type MapCar } from '@/ui/minimap';
import { bakeInstances } from '@/gfx/batch';
import type { ModelInstance } from '@/gfx/model';
import { identity } from '@/math/mat4';

const HUD_INTERVAL = 0.25;
const PLAYER_CAR_COLOR = '#e0b84a';
const POLICE_COLOR = '#3f7bff';

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const crosshair = document.querySelector<HTMLElement>('#crosshair');
  const hud = document.querySelector<HTMLElement>('#hud');
  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  const speedo = document.querySelector<HTMLElement>('#speedo');
  const speedoValue = speedo?.querySelector<HTMLElement>('.value');

  if (
    !canvas ||
    !overlay ||
    !prompt ||
    !crosshair ||
    !hud ||
    !minimapCanvas ||
    !speedo ||
    !speedoValue
  ) {
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
  const species = Object.keys(TREE_MODELS) as TreeSpecies[];
  const [assets, carModel, policeModel, treeModels] = await Promise.all([
    loadCityAssets(),
    loadOptionalModel(VEHICLE.url),
    loadOptionalModel(POLICE.url),
    Promise.all(species.map((s) => loadOptionalModel(TREE_MODELS[s].url))),
  ]);
  prompt.textContent = defaultPrompt;

  const renderer = new Renderer(ctx, layout, assets);

  // Every tree of a species is merged into one static model, drawn in place.
  const trees: ModelInstance[] = species.flatMap((s, i) => {
    const loaded = treeModels[i];
    if (!loaded) return [];
    const transforms = layout.trees
      .filter((spot) => speciesAt(spot, STREET_TREES, PARK_TREES) === s)
      .map((spot) =>
        treeTransform(spot, loaded.data, TREE_MODELS[s].height, layout.config.sidewalkHeight),
      );
    if (transforms.length === 0) return [];
    const data = bakeInstances(loaded.data, transforms);
    return [{ model: renderer.createModel({ data, image: loaded.image }), transform: identity() }];
  });

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
  const minimap = new Minimap(minimapCanvas, layout);
  const mapCar = (v: Vehicle, color: string): MapCar => ({
    x: v.x,
    z: v.z,
    heading: v.heading,
    length: v.body.length,
    width: v.body.width,
    color,
  });

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

    const instances: ModelInstance[] = [...trees];
    if (car && vehicle) {
      instances.push({
        model: car.model,
        transform: vehicleTransform(vehicle, car.fit),
        pose: vehiclePose(vehicle, VEHICLE),
      });
    }
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

    minimap.draw(
      {
        x: camera.position.x,
        z: camera.position.z,
        yaw: camera.yaw,
        fov: camera.horizontalFov(),
      },
      [
        ...patrols.map((p) => mapCar(p.vehicle, POLICE_COLOR)),
        ...(vehicle ? [mapCar(vehicle, PLAYER_CAR_COLOR)] : []),
      ],
    );

    speedo.hidden = !(driving && vehicle);
    if (driving && vehicle) speedoValue.textContent = Math.abs(vehicle.speed * 3.6).toFixed(0);

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
