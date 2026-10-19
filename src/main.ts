import { createContext } from '@/gfx/context';
import { Renderer } from '@/gfx/renderer';
import { startLoop } from '@/core/loop';
import { Input } from '@/core/input';
import { Camera } from '@/core/camera';
import { FirstPersonController } from '@/core/controller';
import { DEFAULT_CITY_CONFIG, generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import {
  ANIMALS,
  ANIMALS_PER_PARK,
  CUSTOM_FACADES,
  GANGSTER_MODELS,
  loadCityAssets,
  loadOptionalModel,
  PARK_TREES,
  PISTOL_MODEL,
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
import { MAX_LIGHTS, nearestLights, visibleLights, type SpotLight } from '@/gfx/lights';
import { AdaptiveResolution } from '@/gfx/resolution';
import { flashlight } from '@/core/flashlight';
import type { Model, ModelInstance } from '@/gfx/model';
import { identity, type Mat4 } from '@/math/mat4';
import { fitBody, handTransform } from '@/people/body';
import type { Gangster } from '@/people/gangster';
import { gripTransform, viewmodelTransform } from '@/people/weapon';
import { DEFAULT_GANG_WAR, GangWar, planTurf, type Flash } from '@/game/gangwar';
import { Pistol } from '@/game/pistol';
import { CombatHud } from '@/ui/combat-hud';

const HUD_INTERVAL = 0.25;
const PLAYER_CAR_COLOR = '#e0b84a';
/** Kolik nejbližších viditelných světlometů svítí; zbytek z MAX_LIGHTS dostanou lampy. */
const HEADLIGHT_SLOTS = 64;
/** Místo, které hráč zabírá pěšky, aby provoz zastavil před ním. */
const PEDESTRIAN_RADIUS = 0.4;
/** Sekundy mezi pádem a opětovným vstáním na startu. */
const RESPAWN_DELAY = 2.5;
/** Zpětný ráz kamery na výstřel, v radiánech náklonu (pitch). */
const RECOIL = 0.015;
/** Záblesk z hlavně: jasný, široký a krátký. */
const FLASH_COLOR: [number, number, number] = [80, 60, 30];
const FLASH_RANGE = 14;
/** Za touto vzdáleností je v noční mlze vše skoro neviditelné, takže tam světla nesvítí. */
const LIGHT_CULL_DISTANCE = 250;

/** Auto mimo provoz: to, které hráč řídí, nebo jedno ponechané zaparkované. */
interface FreeCar {
  vehicle: Vehicle;
  model: Model;
  fit: VehicleFit;
  config: VehicleModelConfig;
  mapColor: string;
  odometerKm: number;
  /** Svět, jak ho vidí toto auto: vše pevné kromě něj samotného. */
  world: VehicleWorld;
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const crosshair = document.querySelector<HTMLElement>('#crosshair');
  const hud = document.querySelector<HTMLElement>('#hud');
  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  const bigMapCanvas = document.querySelector<HTMLCanvasElement>('#bigmap');
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
    !bigMapCanvas ||
    !speedometerCanvas ||
    !dayNight ||
    !clockCanvas
  ) {
    throw new Error('Missing required DOM nodes');
  }

  const ctx = createContext(canvas);
  // Spawn uprostřed křižovatky s pohledem podél třídy: blok N začíná
  // na N * pitch + streetWidth / 2, takže celé násobky pitch padnou
  // na osy ulic.
  const pitch = DEFAULT_CITY_CONFIG.blockSize + DEFAULT_CITY_CONFIG.streetWidth;
  const spawn = Math.floor(DEFAULT_CITY_CONFIG.gridSize / 2) * pitch;
  // Území gangu se vybírá před stavbou města, protože každá jeho čtvrť má svůj park.
  const gangRng = createRng((Math.random() * 2 ** 32) >>> 0);
  const gangOptions = { ...DEFAULT_GANG_WAR, safe: { x: spawn, z: spawn } };
  const turf = planTurf(DEFAULT_CITY_CONFIG, gangOptions, gangRng);
  const layout = generateCity({ parks: turf.parks });
  applyCustomFacades(layout, CUSTOM_FACADES);
  const collision = new CityCollision(layout);

  const camera = new Camera();
  camera.aspect = canvas.width / canvas.height;

  const input = new Input(canvas);
  const controller = new FirstPersonController(camera, input, collision);

  controller.teleport(spawn, spawn, Math.PI);

  // Textury a obloha se sestaví nebo stáhnou před prvním snímkem, takže samotný
  // renderer zůstává synchronní.
  const defaultPrompt = prompt.textContent ?? 'Click to enter the city';
  prompt.textContent = 'Building Lost Heaven\u2026';
  const species = Object.keys(TREE_MODELS) as TreeSpecies[];
  const [assets, carModel, trafficModels, treeModels, animalModels, gangModels, pistolModel] =
    await Promise.all([
      loadCityAssets(),
      loadOptionalModel(VEHICLE.url),
      Promise.all(TRAFFIC_CARS.map((c) => loadOptionalModel(c.url))),
      Promise.all(species.map((s) => loadOptionalModel(TREE_MODELS[s].url))),
      Promise.all(ANIMALS.map((a) => loadOptionalModel(a.url))),
      Promise.all(GANGSTER_MODELS.map((url) => loadOptionalModel(url))),
      loadOptionalModel(PISTOL_MODEL.url),
    ]);
  prompt.textContent = defaultPrompt;

  const renderer = new Renderer(ctx, layout, assets);

  // Stromy jednoho druhu se sloučí do jednoho statického modelu, kresleného na místě.
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

  // Náhodná hrstka zvířat v každém parku, při každé návštěvě jiná.
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

  // Soupeřící gang, každý člen v náhodně vybraném modelu postavy.
  const war = new GangWar(layout, gangOptions, turf, collision, gangRng);
  const pistolKind = pistolModel && renderer.createModel(pistolModel);
  const looks = gangModels.flatMap((loaded) => {
    if (!loaded) return [];
    const fit = fitBody(loaded.data);
    const arm = loaded.data.parts.find((p) => p.name === 'arm-right')?.matrix ?? identity();
    const grip = gripTransform(PISTOL_MODEL, fit.scale);
    return [{ model: renderer.createModel(loaded), fit, arm, grip }];
  });
  const lookOf = new Map<Gangster, (typeof looks)[number]>();
  if (looks.length) for (const g of war.gangsters) lookOf.set(g, gangRng.pick(looks));
  const pistol = new Pistol();
  const combatHud = new CombatHud();
  /** Odpočítává od RESPAWN_DELAY, jakmile je hráč zabit. */
  let downFor = 0;

  // Čas běží během hraní; N nebo tlačítko přeskočí dopředu na večer nebo na ráno.
  const clock = new GameClock();
  const isDay = (): boolean => daylightAt(clock.hour).daylight > 0.5;
  const skipTime = (): void => clock.skipTo(isDay() ? 21 : 7);
  dayNight.addEventListener('click', (event) => {
    // Kliknutí zachycené na úrovni celého dokumentu by jinak zamklo myš.
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
      penetration: (x, z, r) => collision.penetration(x, z, r, vehicle),
      groundHeightAt: (x, z) => collision.groundHeightAt(x, z),
    },
  });

  // Zaparkované kousek za křižovatkou spawnu, v pravém pruhu třídy, do níž se
  // hráč na začátku dívá. Každé auto vzaté z provozu se k němu přidá zde
  // a zůstane tam, kde ho hráč nechá.
  const freeCars: FreeCar[] = [];
  if (carModel) {
    const fit = fitVehicle(carModel.data, VEHICLE);
    const kind = { model: renderer.createModel(carModel), fit, config: VEHICLE };
    const parked = new Vehicle(fit.body, spawn - 2, spawn + 20, Math.PI);
    freeCars.push(freeCar(parked, kind, PLAYER_CAR_COLOR, 0));
  }
  let driven: FreeCar | null = null;

  /** Kvůli čemu musí provoz zastavit kromě sebe sama: auta mimo provoz a chodci. */
  const playerObstacles = (): Obstacle[] => {
    const list = freeCars.map((c) => carObstacle(c.vehicle, c.vehicle));
    const person = (x: number, z: number): Obstacle => ({
      x,
      z,
      heading: 0,
      halfLength: PEDESTRIAN_RADIUS,
      halfWidth: PEDESTRIAN_RADIUS,
    });
    if (!driven) list.push(person(camera.position.x, camera.position.z));
    for (const g of war.gangsters) if (g.alive) list.push(person(g.body.x, g.body.z));
    return list;
  };

  // Provoz pro celé město, modely vybrané podle svých vah.
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
  const bigMap = new Minimap(bigMapCanvas, layout, true);
  const speedometer = new Speedometer(speedometerCanvas);
  const mapCar = (v: Vehicle, color: string): MapCar => ({
    x: v.x,
    z: v.z,
    heading: v.heading,
    length: v.body.length,
    width: v.body.width,
    color,
  });

  // Zamítnutý požadavek na pointer lock (bez gesta uživatele, nebo prodleva hned
  // po Esc) by jinak působil jako kliknutí, které nic neudělá.
  document.addEventListener('pointerlockerror', () => {
    prompt.textContent = 'Could not capture the mouse \u2014 click again';
  });
  document.addEventListener('pointerlockchange', () => {
    prompt.textContent = document.pointerLockElement
      ? defaultPrompt
      : 'Paused \u2014 press Esc or click to continue';
  });

  overlay.hidden = false;
  let hudTimer = 0;
  let fps = 0;
  const resolution = new AdaptiveResolution();

  const flashLight = (flash: Flash): SpotLight => {
    const fade = 1 - flash.age / 0.07;
    return {
      position: flash.position,
      direction: flash.direction,
      color: [FLASH_COLOR[0] * fade, FLASH_COLOR[1] * fade, FLASH_COLOR[2] * fade],
      range: FLASH_RANGE,
      inner: 0.8,
      outer: 1.4,
    };
  };

  let flashlightOn = false;
  /**
   * Nejprve baterka a záblesky z hlavní, pak světlomety provozu a řízeného auta,
   * pak nejbližší lampy; poslední dvě skupiny ztlumené podle toho, jak se
   * za soumraku rozsvěcují světla.
   */
  const sceneLights = (level: number): SpotLight[] => {
    const own = [
      ...(flashlightOn ? [flashlight(camera)] : []),
      ...nearestLights(war.flashes.map(flashLight), camera.position, 4),
    ];
    if (level < 0.01) return own;
    const dim = (light: SpotLight): SpotLight => ({
      ...light,
      color: [light.color[0] * level, light.color[1] * level, light.color[2] * level],
    });
    const cars = traffic.cars.map((c) => c.vehicle);
    if (driven) cars.push(driven.vehicle);
    // Jen světla, která mohou osvětlit něco v záběru: každé další stojí každý pixel.
    camera.update();
    const seen = (lights: SpotLight[]): SpotLight[] =>
      visibleLights(lights, camera.viewProjection, camera.position, LIGHT_CULL_DISTANCE);
    const beams = nearestLights(seen(cars.map(headlight)), camera.position, HEADLIGHT_SLOTS);
    const left = MAX_LIGHTS - own.length - beams.length;
    const lamps = nearestLights(seen(lampLights), camera.position, left);
    return [...own, ...beams.map(dim), ...lamps.map(dim)];
  };

  /**
   * Nejbližší auto na dosah, zaparkované nebo v provozu. Auto vzaté z provozu ho
   * opustí natrvalo: stane se volným autem, teď řízeným a po opuštění zaparkovaným.
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
    // Auta jsou pevná; jen řízené auto není překážkou samo sobě a své sledovací kameře.
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

    // Opuštěná auta se simulují dál se zataženou ruční brzdou; rozjeté smykem zastaví.
    for (const car of freeCars) {
      car.vehicle.update(dt, car === driven ? drive.controls() : PARKED, car.world);
    }
    if (driven) {
      driven.odometerKm += (Math.abs(driven.vehicle.speed) * dt) / 1000;
      drive.updateCamera(dt, driven.vehicle);
    } else if (war.alive) {
      controller.update(dt);
    }

    traffic.update(dt, playerObstacles(), trafficRng);
    for (const { animal } of animals) animal.update(dt, animalRng, collision);
    fight(dt);
  };

  /** Válka gangů v tomto snímku: výstřely hráče, výstřely gangu a opětovné vstání. */
  const fight = (dt: number): void => {
    pistol.update(dt);
    const standing = war.alive;
    if (standing && !driven) {
      if (input.wasPressed('KeyR')) pistol.reload();
      if (input.wasPressed('Mouse0') && pistol.trigger()) {
        const origin = { ...camera.position };
        const direction = camera.forward();
        const shot = war.shoot(origin, direction, (max) =>
          collision.raycast(origin, direction, max),
        );
        if (shot.gangster) combatHud.hitMarker();
        camera.addLook(0, RECOIL);
      }
    }
    if (driven) war.runOver(carObstacle(driven.vehicle, driven), driven.vehicle.speed);

    const eye = driven
      ? { x: driven.vehicle.x, y: driven.vehicle.y + 1.2, z: driven.vehicle.z }
      : { ...camera.position };
    war.update(dt, { position: eye, alive: standing, inCar: driven !== null }, collision, gangRng);

    for (const event of war.events.splice(0)) combatHud.announce(event.text, event.points);

    if (!war.alive) {
      downFor += dt;
      if (downFor > RESPAWN_DELAY) {
        downFor = 0;
        driven = null;
        controller.teleport(spawn, spawn, Math.PI);
        war.respawn();
      }
    }
  };

  startLoop(({ dt }) => {
    // Menu je zobrazené, kdykoli je myš volná; svět za ním stojí.
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
    for (const gangster of war.gangsters) {
      const look = lookOf.get(gangster);
      if (!look) continue;
      const transform = gangster.body.transform(look.fit);
      const pose = gangster.body.pose();
      instances.push({ model: look.model, transform, pose });
      if (pistolKind && gangster.alive) {
        const gun: Mat4 = handTransform(transform, look.arm, pose('arm-right'), look.grip);
        instances.push({ model: pistolKind, transform: gun });
      }
    }
    if (pistolKind && !driven && war.alive) {
      instances.push({
        model: pistolKind,
        transform: viewmodelTransform(camera, PISTOL_MODEL, pistol.kick, pistol.reloadProgress),
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

    const mapView = {
      x: camera.position.x,
      z: camera.position.z,
      yaw: camera.yaw,
      fov: camera.horizontalFov(),
    };
    const mapCars = [
      ...traffic.cars.map((c) => mapCar(c.vehicle, kindOf.get(c)?.entry.mapColor ?? '#cccccc')),
      ...freeCars.map((c) => mapCar(c.vehicle, c === driven ? PLAYER_CAR_COLOR : c.mapColor)),
    ];
    const mapMarks = {
      areas: war.districts
        .filter((d) => d.contested)
        .map((d) => ({
          rect: d.bounds,
          color: d.captured ? 'rgba(70, 170, 90, 0.22)' : 'rgba(200, 40, 30, 0.25)',
        })),
      dots: war.gangsters
        .filter((g) => g.alive)
        .map((g) => ({ x: g.body.x, z: g.body.z, color: '#ff3b30' })),
    };
    minimap.draw(mapView, mapCars, mapMarks);
    bigMapCanvas.hidden = paused || !input.isDown('Tab');
    if (!bigMapCanvas.hidden) bigMap.draw(mapView, mapCars, mapMarks);

    combatHud.update(
      {
        health: war.health,
        magazine: pistol.magazine,
        reloading: pistol.reloading,
        score: war.score,
        taken: war.contested - war.remaining,
        total: war.contested,
        showAmmo: !driven,
        hurt: war.hurt,
      },
      dt,
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

    // Snímkovou frekvenci před zobrazením vyhladit; surové dt každého snímku je nečitelné.
    fps += (1 / Math.max(dt, 1e-6) - fps) * 0.1;
    if (resolution.update(dt)) ctx.scale = resolution.scale;

    hudTimer += dt;
    if (hudTimer >= HUD_INTERVAL) {
      hudTimer = 0;
      const p = camera.position;
      hud.textContent =
        `${fps.toFixed(0)} fps  |  ${Math.round(ctx.scale * 100)}% res  |  ${renderer.stats.triangles.toLocaleString()} tris  |  ` +
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
