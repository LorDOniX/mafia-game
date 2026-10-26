# mafia-game

A TypeScript + WebGL2 game inspired by _Mafia: The City of Lost Heaven_.
The GL layer is hand-rolled — no rendering framework.

## Getting started

```bash
npm install
npm run dev      # dev server at http://localhost:5173
```

Click the canvas to capture the mouse, `Esc` to release it.

## Controls

| Input       | Action                  |
| ----------- | ----------------------- |
| `W A S D`   | Walk                    |
| Mouse       | Look                    |
| `Shift`     | Run                     |
| `F`         | Toggle walk / fly mode  |
| `Space` `C` | Up / down (fly only)    |
| `E`         | Get in / out of the car |
| `Esc`       | Release the cursor      |

Walk mode holds the camera at eye height and collides with buildings. Fly mode
is unconstrained, for looking at the city from above.

A car is parked just ahead of the spawn point. Walk up to it and press `E`:

| Input   | Action                                 |
| ------- | -------------------------------------- |
| `W`     | Accelerate                             |
| `S`     | Brake, then reverse                    |
| `A` `D` | Steer                                  |
| `Space` | Handbrake                              |
| Mouse   | Look around; recentres once you drive  |
| `E`     | Get out (driver's side when it's free) |

## Scripts

| Script              | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Vite dev server with HMR           |
| `npm run build`     | Typecheck, then production build   |
| `npm run preview`   | Serve the production build         |
| `npm run typecheck` | `tsc --noEmit`                     |
| `npm test`          | Run the Vitest suite once          |
| `npm run lint`      | ESLint over the repo               |
| `npm run format`    | Prettier write                     |
| `npm run upload`    | Build, then upload `dist/` via FTP |

## Deployment

- `npm run upload` builds and uploads `dist/` to FTP `/www/subdom/app/mafia-game/` = https://app.makuderovi.cz/mafia-game/ (`scripts/upload.ts`, same as in the todo repo)
- FTP access lives in `conf/env.json` (not in git): `{ "ftp": { "host", "user", "password", "secure" } }`
- only changed files are uploaded (server state in `build-data/upload.json`), files from the previous upload missing in the new build are deleted; `npx tsx scripts/upload.ts --full` re-uploads everything
- the production build uses `base: '/mafia-game/'` (vite.config.ts), the dev server stays on http://localhost:5173/
- absolute `public/` paths in code (`/models/car.glb`) get the base prefix in the loaders (`publicUrl` in `src/gfx/image.ts`)

## Layout

```
src/
  main.ts          entrypoint: wires context, city, input, loop, renderer
  core/
    loop.ts        rAF frame loop with a clamped delta
    input.ts       keyboard + pointer-lock mouse look
    camera.ts      yaw/pitch camera, view & projection matrices
    controller.ts  first-person movement, walk and fly modes
    drive.ts       driving input, getting in and out, chase camera
    rng.ts         seeded deterministic PRNG
  city/
    assets.ts      texture + sky manifest; swap procedural art for PNGs here
    layout.ts      city generation: blocks, plots, buildings (no GL, no DOM)
    mesh.ts        layout -> interleaved vertex + index buffers
    collision.ts   uniform-grid building lookup, ground height
    facades.ts     custom facades: definition and assignment to buildings
    textures.ts    procedural surface textures (Canvas2D)
    sky.ts         procedural sky cube map + the shared sun direction
  gfx/
    context.ts     WebGL2 acquisition + DPR-aware resize
    shader.ts      compile/link with real logs, reflects uniforms & attributes
    buffer.ts      VBO + VAO helpers
    mesh.ts        indexed static mesh from an interleaved buffer
    texture.ts     2D-array, 2D and cube-map upload, anisotropic filtering
    gltf.ts        minimal binary glTF (.glb) loader
    model.ts       model pass: draws loaded models with the city's lighting
    image.ts       image fetch/decode, rescaling, bilinear resampling
    skybox.ts      skybox pass
    renderer.ts    city pass + skybox pass
  vehicle/
    vehicle.ts     arcade car handling and collision (no GL, no DOM)
    model.ts       measures a car off its model, poses body and wheels
  math/            vec2 / vec3 / mat4, column-major to match GL
  game/state.ts    mafia domain model (roles, phases, win condition)
  shaders/         GLSL sources, imported via `?raw`
tests/             Vitest specs
```

`@/*` is aliased to `src/*` in Vite, Vitest, and tsconfig.

## How the city is built

`generateCity()` lays out a square grid of blocks separated by streets. Each
block is ringed with terraced buildings whose heights taper from downtown out to
the edges, and a few blocks come out as open plazas. Everything derives from
`CityConfig.seed`, so a given seed always produces the same city:

```ts
const layout = generateCity({ seed: 1930, gridSize: 8 });
```

`buildCityMesh()` flattens the whole layout into one interleaved buffer drawn in
a single call — the city is static, so there is nothing to gain from per-building
draws. Vertices carry `position`, `normal`, `uv`, a texture-array `layer`, and a
`tint` that also bakes in a cheap street-level ambient occlusion term.

## Textures

Out of the box there are no binary assets: surface textures and the sky cube map
are drawn procedurally at startup (`city/textures.ts`, `city/sky.ts`). Surfaces
live in a `TEXTURE_2D_ARRAY` rather than an atlas, so every layer keeps its own
`REPEAT` wrap and mip chain and tiled facades cannot bleed into each other.

### Using your own PNGs

`src/city/assets.ts` is the only file you need to edit. Drop the images in
`public/`, which Vite serves verbatim, and reference them by absolute path:

```
public/textures/brick.png   ->   /textures/brick.png
```

Then set the layers you want to override:

```ts
export const SURFACE_TEXTURES: Partial<Record<TextureLayer, string>> = {
  [TextureLayer.Road]: '/textures/asphalt.png',
  [TextureLayer.Brick]: '/textures/brick.png',
};
```

Notes that matter in practice:

- **Don't `import` the images from `src/`.** That route rewrites the filename
  with a content hash, which is useless for art you address by name.
- **Anything you leave out stays procedural**, and a URL that fails to load
  warns to the console and falls back. A typo degrades; it does not break.
- **Images are rescaled to `TEXTURE_SIZE`** (2048) so every array layer matches.
  Each layer costs about 21 MB of GPU memory per array at that size; drop it to
  1024 if that is too much. The procedural textures are drawn in fixed art
  units (`ART_SIZE`), so changing it sharpens or softens them without changing
  their look.
- **Seamless, tiling textures only.** Everything is sampled with `REPEAT` across
  large surfaces, so a non-tiling photo will show a visible grid.
- **Facades get a window painted on top.** The mesh maps one tile to one storey
  and one window bay, so a plain brick photo would otherwise tile into a blank
  cliff. Set `OVERLAY_WINDOWS_ON_FACADES = false` if your art already has
  windows in it.
- **Buildings also multiply a per-building tint** (`BRICK_TINTS` /
  `PLASTER_TINTS` in `city/layout.ts`). With photographic textures that already
  carry their own colour, you may want to flatten those toward white.
- **`public/` is the only durable place for assets.** `dist/` is build output:
  it is gitignored, and Vite empties it on every build. Keep raw downloads in

### The two asphalt layers

`TextureLayer.Road` and `TextureLayer.Asphalt` are deliberately separate,
because they are mapped in completely different ways.

`Road` is the carriageway. Its texture is mapped **across the width of a street
exactly once**, and repeats only along the direction of travel — so it must be
a road cross-section, with kerb lines on its two vertical edges and a centre
line down the middle. This is the layout ambientCG's road textures already use.
Hand it a plain asphalt swatch and you get an unmarked city, which is fine; hand
it a texture with markings in the wrong place and they will run sideways across
the street.

`Asphalt` is tiled freely, so it wants a seamless swatch with nothing painted on
it. It covers the ground plane: the outskirts, and the half-width streets at the
map edge.

Intersections sample the `Road` texture through `CLEAN_ROAD_UV` in
`city/mesh.ts` — a marking-free window on the image. An intersection is exactly
one tile across and never repeats, so it can crop freely with no seam to match.
If your road texture puts its clean asphalt somewhere else, move that window.
UVs follow GL convention, with v = 0 at the bottom of the image.

### Normal maps

`SURFACE_NORMAL_MAPS` mirrors `SURFACE_TEXTURES`:

```ts
export const SURFACE_NORMAL_MAPS: Partial<Record<TextureLayer, string>> = {
  [TextureLayer.Road]: '/textures/road/Road008B_1K-JPG_NormalGL.jpg',
};
```

Use the **OpenGL** convention, where green points up. Packs that ship both
label them `NormalGL` and `NormalDX`; the DirectX variant has its green channel
inverted and lights every bump from the wrong side. Layers with no entry get a
flat normal and shade exactly as before.

`NORMAL_STRENGTH` scales the effect globally — 1 is the map as authored, 0 is
flat. It defaults to 0.6, because asphalt maps tend to be aggressive and the
roadway is viewed at grazing angles where strong normals read as noise.

Tangent frames are solved per quad from the geometry and UVs
(`tangentFrame` in `city/mesh.ts`), so normal maps work on walls, roofs,
pavements and carriageways without any per-surface setup.

### Custom facades for individual buildings

`SURFACE_TEXTURES` swaps a texture everywhere it is used. To give one building
(or a chosen group) a look of its own, add an entry to `CUSTOM_FACADES` in the
same file:

```ts
export const CUSTOM_FACADES: readonly CustomFacade[] = [
  {
    name: 'granite-grid',
    url: '/textures/facades/granite-grid.jpg',
    span: { bays: 9, storeys: 7 },
    targets: [{ at: { x: 328, z: 327 } }],
  },
];
```

Every entry gets its own texture-array layer, appended after the built-in
ones, so adding a facade never touches the others. The fields:

- **`span`** is how many window bays across and storeys up the image covers.
  Unlike the built-in facades (one bay per tile), a custom facade can be a whole
  photographed wall; the walls are mapped so one bay of the image lands on one
  bay of the building (about 4 m wide, one storey high).
- **`targets`** picks the buildings. `{ at: { x, z } }` is the building
  standing on that ground point — walk up to it and read `x` / `z` off the HUD.
  `{ where: (building, index) => boolean }` takes any predicate, e.g. every
  building taller than 30 m. When two facades target the same building, the
  later entry wins; a target that matches nothing warns in the console.
- **`tint`** defaults to white, because photographs carry their own colour.
- **`normalUrl`** is optional, OpenGL convention, same as `SURFACE_NORMAL_MAPS`.

Preparing the image:

- **Crop it to exactly `bays` x `storeys` bays**, cutting through the middle of
  the wall between windows, so the left edge continues into the right edge and
  the top into the bottom. Otherwise the repeats show a seam or a half window.
- **Shoot it straight on.** Perspective makes the rows drift apart toward one
  edge, and the drift shows up as a jump at every repeat.
- **Prefer JPG / PNG over AVIF / WebP** for safety: decoding goes through the
  browser, and older browsers do not decode every format.
- Images are rescaled to `TEXTURE_SIZE` square like any other layer, so a
  9-bay image gets about a ninth of it per bay. Raise `TEXTURE_SIZE` if that
  is too soft.

If the image fails to load, the building keeps the custom layout but shows
procedural stucco instead, tiled to the same bay grid.

### Using your own sky

The skybox is a cube map. Set `SKY` in `src/city/assets.ts` to one of:

```ts
// Six faces, in GL order: +X, -X, +Y, -Y, +Z, -Z
export const SKY: SkySource = {
  kind: 'faces',
  urls: ['/sky/px.png', '/sky/nx.png', '/sky/py.png', '/sky/ny.png', '/sky/pz.png', '/sky/nz.png'],
  sunDirection: normalize({ x: 0.38, y: 0.42, z: -0.82 }),
  horizonColor: [0.74, 0.76, 0.75],
};

// Or a single equirectangular panorama, resampled into faces on load
export const SKY: SkySource = {
  kind: 'panorama',
  url: '/sky/afternoon.jpg',
  sunDirection: normalize({ x: 0.38, y: 0.42, z: -0.82 }),
  horizonColor: [0.74, 0.76, 0.75],
};
```

`sunDirection` and `horizonColor` are part of the sky config on purpose: the
city's directional lighting and its distance fog are keyed off them. A
photographic sky whose sun sits somewhere else will look wrong until these
match. Point `sunDirection` from the ground toward the sun, and sample
`horizonColor` off the image at eye level.

Sky HDRIs are almost always distributed as equirectangular panoramas rather than
cube maps, which is what the `panorama` mode is for. Prefer a 2K-4K panorama:
conversion happens on the CPU at startup, and an 8K source means a ~134 MB
intermediate buffer. `.hdr` and `.exr` are not supported - use the tonemapped
JPG/PNG that most sites offer alongside them.

### The car

The car is a binary glTF model, set by `VEHICLE` in `src/city/assets.ts`:

```ts
export const VEHICLE: VehicleModelConfig = {
  url: '/models/ambulance.glb',
  scale: 1.4,
  spinPrefix: 'wheel-',
  steerPrefix: 'wheel-front',
};
```

- **Size, wheelbase and wheel radius are measured off the model**, so swapping
  models needs no tuning beyond `scale`, which converts model units to metres.
  Kenney's cars are about 1.5 units wide, so 1.4 gives a 2.1 m wide ambulance.
- **Wheels are found by part name.** Every mesh node whose name starts with
  `spinPrefix` rolls, and those also starting with `steerPrefix` steer. Each
  wheel turns around its own node origin, so that origin has to sit on the
  axle. Kenney's kit names them `wheel-front-left`, `wheel-back-right`, etc.
- **The model faces +Z with +Y up**, the glTF convention.
- **Textures load relative to the model file**, as glTF specifies. A model
  that references `Textures/colormap.png` needs that file next to it in
  `public/models/`. Embedded textures work too.
- If the model fails to load, the game warns in the console and runs without
  a car.

The loader (`gfx/gltf.ts`) reads `.glb` only, and only what a prop needs:
triangle meshes with positions, normals and one UV set, the node hierarchy, and
one base-colour texture per model. It throws with a reason on anything it
cannot honour (Draco compression, external `.bin` files, quantised attributes)
rather than drawing it wrong. Re-export such models from Blender as `.glb`
with compression off.

Handling is a kinematic bicycle model in `vehicle/vehicle.ts`: speed along the
heading, turn rate from steering angle over wheelbase. There is no physics
engine; the car collides as a row of circles down its long axis, and scrapes
along walls it hits at an angle. Tune it with `DEFAULT_HANDLING` (top speed,
acceleration, steering lock and so on).

The kit's other cars (`sedan`, `taxi`, `police`, `truck`, ...) share the same
colour map, so any of them drops in by changing `url`.

### Where to get textures

Already in use: the car is Kenney's
[Car Kit](https://kenney.nl/assets/car-kit) (CC0), and the roadway is ambientCG's
[Road008B](https://ambientcg.com/view?id=Road008B) (CC0). The full pack is kept

All CC0 (public domain, no attribution required):

- [ambientCG](https://ambientcg.com/) - 2000+ PBR materials up to 8K. The best
  fit here: browse the [Bricks](https://ambientcg.com/list?category=Bricks),
  [Concrete](https://ambientcg.com/list?category=Concrete),
  [Asphalt](https://ambientcg.com/list?category=Asphalt) and
  [Paving Stones](https://ambientcg.com/list?category=PavingStones) categories.
  Download the "Color" / albedo map; the normal and roughness maps have nowhere
  to go until the shader grows a material model.
- [Poly Haven](https://polyhaven.com/) - the standard source for skies. See
  [HDRIs > Skies](https://polyhaven.com/hdris/skies), and the
  [Pure Skies](https://polyhaven.com/hdris/pure-skies) set in particular, which
  has the ground removed. Grab the tonemapped JPG and use `panorama` mode.
- [cgbookcase](https://www.cgbookcase.com/textures) and
  [3DTextures.me](https://3dtextures.me/) - smaller CC0 libraries, useful when
  ambientCG has nothing in the style you want.

Needing attribution:

- [Humus' skyboxes on OpenGameArt](https://opengameart.org/content/urban-skyboxes)
  - 13 urban skyboxes, already 6-sided cube maps at 2048x2048, so they drop
    straight into `faces` mode with no conversion. CC-BY 3.0, so credit Emil
    Persson. There are matching
    [field](https://opengameart.org/content/field-skyboxes) and
    [night](https://opengameart.org/content/night-skyboxes) sets.

Worth knowing about but check before shipping:

- [textures.com](https://www.textures.com/) has a large library and a free tier,
  but it is **not** CC0 - there are download limits and redistribution
  restrictions. Read the licence if this becomes more than a personal project.
- [OpenGameArt](https://opengameart.org/) mixes CC0, CC-BY and GPL assets. The
  licence is per-asset, not site-wide.

Licences do change. Verify before relying on any of the above commercially.

## Conventions

- WebGL2 only (`#version 300 es`). No WebGL1 fallback.
- Matrices are column-major `Float32Array(16)`, passed straight to `uniformMatrix4fv`.
- One world unit is one metre.
- Y is up; yaw 0 looks down -Z.
- `strict` TypeScript with `noUncheckedIndexedAccess` — index access is `T | undefined`.
- Surface textures are uploaded with `UNPACK_FLIP_Y_WEBGL`, so v = 0 is the
  bottom row of the image and art stands upright on walls. The sky cube map is
  not flipped; cube faces follow their own convention.
- Textures are uploaded as `RGBA8` and shaded as if they were linear. That is
  not colour-correct for sRGB source art, but it is what the procedural
  textures were authored against. Moving to `SRGB8_ALPHA8` plus an encode on
  output would be more correct and would need the lighting re-tuned.
- Anything under `city/` except `textures.ts` and `sky.ts` is free of DOM and GL
  calls, so layout, meshing, and collision are all unit-testable in Node.
