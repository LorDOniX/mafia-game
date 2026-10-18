import { createContext } from '@/gfx/context';
import { Renderer } from '@/gfx/renderer';
import { startLoop } from '@/core/loop';
import { Input } from '@/core/input';
import { Camera } from '@/core/camera';
import { FirstPersonController } from '@/core/controller';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import {
  ANIMALS,
  ANIMALS_PER_PARK,
  CUSTOM_FACADES,
  loadCityAssets,
  loadOptionalModel,
  PARK_TREES,
  STREET_TREES,
  TRAFFIC_CARS,
  TRAFFIC_COUNT,
  trafficVehicleConfig,
  TREE_MODELS,
  VEHICLE,
  type TreeSpecies,
} from '@/city/assets';
import { applyCustomFacades } from '@/city/facades';
import { speciesAt, treeTransform } from '@/city/trees';
import { createLampModel, lampLight, lampTransform } from '@/city/lamp';
import { DriveController } from '@/core/drive';
import { createRng } from '@/core/rng';
import { PARKED, Vehicle, type VehicleWorld } from '@/vehicle/vehicle';
import {
  fitVehicle,
  headlight,
  vehiclePose,
  vehicleTransform,
  type VehicleFit,
  type VehicleModelConfig,
} from '@/vehicle/model';
import { buildRoadNetwork, Traffic, type TrafficCar } from '@/vehicle/traffic';
import type { Obstacle } from '@/city/collision';
import { Animal, fitAnimal } from '@/animals/animal';
import { Minimap, type MapCar } from '@/ui/minimap';
import { Speedometer } from '@/ui/speedometer';
import { ClockDial } from '@/ui/clock';
import { daylightAt, GameClock } from '@/game/clock';
import { bakeInstances } from '@/gfx/batch';
import { MAX_LIGHTS, nearestLights, type SpotLight } from '@/gfx/lights';
import { flashlight } from '@/core/flashlight';
import type { Model, ModelInstance } from '@/gfx/model';
import { identity } from '@/math/mat4';

const HUD_INTERVAL = 0.25;
const PLAYER_CAR_COLOR = '#e0b84a';
/** Shader light slots kept for headlights; street lamps get the rest. */
const HEADLIGHT_SLOTS = 8;
/** Room the player takes up on foot, for traffic to stop short of. */
const PEDESTRIAN_RADIUS = 0.4;

/** A car out of traffic: the one the player is driving, or one left parked. */
interface FreeCar {
  vehicle: Vehicle;
  model: Model;
  fit: VehicleFit;
  config: VehicleModelConfig;
  mapColor: string;
  odometerKm: number;
  /** The world as this car sees it: everything solid except itself. */
  world: VehicleWorld;
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const crosshair = document.querySelector<HTMLElement>('#crosshair');
  const hud = document.querySelector<HTMLElement>('#hud');
  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  const speedometerCanvas = document.querySelector<HTMLCanvasElement>('#speedometer');
  const dayNight = document.querySelector<HTMLButtonElement>('#daynight');
  const clockCanvas = document.querySelector<HTMLCanvasElement>('#clock');

  if (
    !canvas ||
    !overlay ||
    !prompt ||
    !crosshair ||
    !hud ||
    !minimapCanvas ||
    !speedometerCanvas ||
    !dayNight ||
    !clockCanvas
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
  const [assets, carModel, trafficModels, treeModels, animalModels] = await Promise.all([
    loadCityAssets(),
    loadOptionalModel(VEHICLE.url),
    Promise.all(TRAFFIC_CARS.map((c) => loadOptionalModel(c.url))),
    Promise.all(species.map((s) => loadOptionalModel(TREE_MODELS[s].url))),
    Promise.all(ANIMALS.map((a) => loadOptionalModel(a.url))),
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

  const kerb = layout.config.sidewalkHeight;
  const lamps: ModelInstance = {
    model: renderer.createModel({
      data: bakeInstances(
        createLampModel(),
        layout.lamps.map((spot) => lampTransform(spot, kerb)),
      ),
      image: null,
    }),
    transform: identity(),
  };
  const lampLights = layout.lamps.map((spot) => lampLight(spot, kerb));

  // A random handful of animals in every park, different each visit.
  const animalRng = createRng((Math.random() * 2 ** 32) >>> 0);
  const breeds = ANIMALS.flatMap((species, i) => {
    const loaded = animalModels[i];
    return loaded
      ? [
          {
            species,
            model: renderer.createModel(loaded),
            fit: fitAnimal(loaded.data, species.height),
          },
        ]
      : [];
  });
  const animals = breeds.length
    ? layout.blocks
        .filter((block) => block.isPark)
        .flatMap((park) =>
          Array.from({ length: animalRng.int(ANIMALS_PER_PARK.min, ANIMALS_PER_PARK.max) }, () => {
            const breed = animalRng.pick(breeds);
            return {
              breed,
              animal: new Animal(breed.species, park.plot, kerb, animalRng, collision),
            };
          }),
        )
    : [];

  // Time runs while playing; N or the button skips ahead to evening or morning.
  const clock = new GameClock();
  const isDay = (): boolean => daylightAt(clock.hour).daylight > 0.5;
  const skipTime = (): void => clock.skipTo(isDay() ? 21 : 7);
  dayNight.addEventListener('click', (event) => {
    // The document-wide click would otherwise grab the mouse.
    event.stopPropagation();
    skipTime();
  });
  const clockDial = new ClockDial(clockCanvas);

  const carObstacle = (v: Vehicle, owner: unknown): Obstacle => ({
    x: v.x,
    z: v.z,
    heading: v.heading,
    halfLength: v.body.length / 2,
    halfWidth: v.body.width / 2,
    owner,
  });
  const freeCar = (
    vehicle: Vehicle,
    kind: { model: Model; fit: VehicleFit; config: VehicleModelConfig },
    mapColor: string,
    odometerKm: number,
  ): FreeCar => ({
    ...kind,
    vehicle,
    mapColor,
    odometerKm,
    world: {
      blocked: (x, z, r) => collision.blocked(x, z, r, vehicle),
      groundHeightAt: (x, z) => collision.groundHeightAt(x, z),
    },
  });

  // Parked just past the spawn crossroads, in the right-hand lane of the
  // avenue the player starts out looking down. Any car taken from traffic
  // joins it here, and stays wherever it is left.
  const freeCars: FreeCar[] = [];
  if (carModel) {
    const fit = fitVehicle(carModel.data, VEHICLE);
    const kind = { model: renderer.createModel(carModel), fit, config: VEHICLE };
    const parked = new Vehicle(fit.body, spawn - 2, spawn + 20, Math.PI);
    freeCars.push(freeCar(parked, kind, PLAYER_CAR_COLOR, 0));
  }
  let driven: FreeCar | null = null;

  /** What traffic has to stop for besides itself: cars out of traffic, and the player on foot. */
  const playerObstacles = (): Obstacle[] => {
    const list = freeCars.map((c) => carObstacle(c.vehicle, c.vehicle));
    if (!driven) {
      const { x, z } = camera.position;
      list.push({ x, z, heading: 0, halfLength: PEDESTRIAN_RADIUS, halfWidth: PEDESTRIAN_RADIUS });
    }
    return list;
  };

  // A town's worth of traffic, models picked by their weights.
  const trafficRng = createRng((Math.random() * 2 ** 32) >>> 0);
  const fleet = TRAFFIC_CARS.flatMap((entry, i) => {
    const loaded = trafficModels[i];
    if (!loaded) return [];
    const config = trafficVehicleConfig(entry);
    return [
      { entry, config, fit: fitVehicle(loaded.data, config), model: renderer.createModel(loaded) },
    ];
  });
  const traffic = new Traffic(buildRoadNetwork(layout));
  const kindOf = new Map<TrafficCar, (typeof fleet)[number]>();
  const totalWeight = fleet.reduce((sum, kind) => sum + kind.entry.weight, 0);
  for (let n = 0; n < TRAFFIC_COUNT && fleet.length; n++) {
    let pick = trafficRng.range(0, totalWeight);
    const kind = fleet.find((k) => (pick -= k.entry.weight) <= 0) ?? fleet[0];
    if (!kind) break;
    const spawned = traffic.spawn(kind.fit.body, trafficRng, playerObstacles());
    if (spawned) kindOf.set(spawned, kind);
  }

  const drive = new DriveController(camera, input, collision);
  const minimap = new Minimap(minimapCanvas, layout);
  const speedometer = new Speedometer(speedometerCanvas);
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
    prompt.textContent = document.pointerLockElement
      ? defaultPrompt
      : 'Paused \u2014 click to continue';
  });

  overlay.hidden = false;
  let hudTimer = 0;
  let fps = 0;

  let flashlightOn = false;
  /**
   * The flashlight first, then headlights of traffic and the driven car, then
   * the nearest lamps, the last two dimmed as the lights come up at dusk.
   */
  const sceneLights = (level: number): SpotLight[] => {
    const own = flashlightOn ? [flashlight(camera)] : [];
    if (level < 0.01) return own;
    const dim = (light: SpotLight): SpotLight => ({
      ...light,
      color: [light.color[0] * level, light.color[1] * level, light.color[2] * level],
    });
    const cars = traffic.cars.map((c) => c.vehicle);
    if (driven) cars.push(driven.vehicle);
    const beams = nearestLights(cars.map(headlight), camera.position, HEADLIGHT_SLOTS);
    const left = MAX_LIGHTS - own.length - beams.length;
    const lamps = nearestLights(lampLights, camera.position, left);
    return [...own, ...beams.map(dim), ...lamps.map(dim)];
  };

  /**
   * The nearest car within reach, parked or in traffic. One taken from traffic
   * leaves it for good: it becomes a free car, driven now and parked once left.
   */
  const enterNearestCar = (): FreeCar | null => {
    const { x, z } = camera.position;
    const reachable = [
      ...freeCars.map((c) => ({ vehicle: c.vehicle, take: () => c })),
      ...traffic.cars.map((c) => ({
        vehicle: c.vehicle,
        take: (): FreeCar | null => {
          const kind = kindOf.get(c);
          if (!kind) return null;
          traffic.remove(c);
          kindOf.delete(c);
          const taken = freeCar(
            c.vehicle,
            kind,
            kind.entry.mapColor,
            trafficRng.range(2000, 90000),
          );
          freeCars.push(taken);
          return taken;
        },
      })),
    ]
      .filter((c) => drive.canEnter(c.vehicle, x, z))
      .sort(
        (a, b) =>
          Math.hypot(a.vehicle.x - x, a.vehicle.z - z) -
          Math.hypot(b.vehicle.x - x, b.vehicle.z - z),
      );
    return reachable[0]?.take() ?? null;
  };

  let playTime = 0;
  const simulate = (dt: number): void => {
    clock.advance(dt);
    // Cars are solid, except the one being driven, to itself and its chase camera.
    collision.setObstacles([
      ...traffic.obstacles(),
      ...freeCars.filter((c) => c !== driven).map((c) => carObstacle(c.vehicle, c.vehicle)),
    ]);

    if (input.wasPressed('KeyE')) {
      if (driven) {
        const exit = drive.exitPoint(driven.vehicle);
        if (exit) {
          controller.teleport(exit.x, exit.z, driven.vehicle.heading);
          driven = null;
        }
      } else if (controller.mode === 'walk') {
        driven = enterNearestCar();
        if (driven) drive.enter(driven.vehicle);
      }
    }

    // Left cars keep simulating, handbrake on, so one left rolling skids to a stop.
    for (const car of freeCars) {
      car.vehicle.update(dt, car === driven ? drive.controls() : PARKED, car.world);
    }
    if (driven) {
      driven.odometerKm += (Math.abs(driven.vehicle.speed) * dt) / 1000;
      drive.updateCamera(dt, driven.vehicle);
    } else {
      controller.update(dt);
    }

    traffic.update(dt, playerObstacles(), trafficRng);
    for (const { animal } of animals) animal.update(dt, animalRng, collision);
  };

  startLoop(({ dt }) => {
    // The menu is up whenever the mouse is free; the world holds still behind it.
    const paused = !input.pointerLocked;
    if (!paused) {
      playTime += dt;
      simulate(dt);
    }
    if (input.wasPressed('KeyN')) skipTime();
    if (input.wasPressed('KeyT')) flashlightOn = !flashlightOn;

    const instances: ModelInstance[] = [...trees, lamps];
    for (const { breed, animal } of animals) {
      instances.push({
        model: breed.model,
        transform: animal.transform(breed.fit),
        pose: animal.pose(),
      });
    }
    for (const free of freeCars) {
      instances.push({
        model: free.model,
        transform: vehicleTransform(free.vehicle, free.fit),
        pose: vehiclePose(free.vehicle, free.config),
      });
    }
    for (const trafficCar of traffic.cars) {
      const kind = kindOf.get(trafficCar);
      if (!kind) continue;
      instances.push({
        model: kind.model,
        transform: vehicleTransform(trafficCar.vehicle, kind.fit),
        pose: vehiclePose(trafficCar.vehicle, kind.config),
      });
    }
    const sun = daylightAt(clock.hour);
    renderer.render(camera, instances, {
      daylight: sun.daylight,
      dusk: sun.dusk,
      lightsOn: sun.lights,
      lights: sceneLights(sun.lights),
    });
    input.endFrame();

    clockDial.draw(clock.hour, clock.label(), clock.day);
    const skipLabel = isDay() ? 'Skip to evening (N)' : 'Skip to morning (N)';
    if (dayNight.textContent !== skipLabel) dayNight.textContent = skipLabel;

    minimap.draw(
      {
        x: camera.position.x,
        z: camera.position.z,
        yaw: camera.yaw,
        fov: camera.horizontalFov(),
      },
      [
        ...traffic.cars.map((c) => mapCar(c.vehicle, kindOf.get(c)?.entry.mapColor ?? '#cccccc')),
        ...freeCars.map((c) => mapCar(c.vehicle, c === driven ? PLAYER_CAR_COLOR : c.mapColor)),
      ],
    );

    speedometerCanvas.hidden = !driven;
    if (driven) {
      speedometer.draw({
        speedKmh: driven.vehicle.speed * 3.6,
        odometerKm: driven.odometerKm,
      });
    }

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
        `${driven ? `drive ${Math.abs(driven.vehicle.speed * 3.6).toFixed(0)} km/h` : controller.mode}  |  x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}  |  ` +
        `${playTime.toFixed(0)}s`;
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
