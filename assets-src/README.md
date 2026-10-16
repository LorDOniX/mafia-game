# assets-src

Raw asset downloads, kept for reference. Nothing here is served or bundled —
only files under `public/` reach the build.

When you take a new texture into use, copy the maps you actually need into
`public/textures/` and leave the rest of the pack here.

## textures/road — ambientCG "Road008B"

Asphalt, 1K JPG. Licence: CC0 (public domain), <https://ambientcg.com/view?id=Road008B>

In use (see `src/city/assets.ts`):

- `Road008B_1K-JPG_Color.jpg` → albedo for `TextureLayer.Road`
- `Road008B_1K-JPG_NormalGL.jpg` → normal map for `TextureLayer.Road`

Deliberately unused for now:

- `_NormalDX.jpg` — DirectX convention, green channel inverted. WebGL needs the
  `NormalGL` variant instead; using this one would light every bump backwards.
- `_Roughness.jpg`, `_AmbientOcclusion.jpg`, `_Displacement.jpg` — no home until
  the shader grows a material model beyond diffuse + normal.
- `.blend`, `.usdc`, `.mtlx`, `.tres` — DCC/engine project files.

## textures/facades — granite-grid

Photograph of a granite-clad facade, 9 x 7 window bays. Cropped to the exact
bay grid into `public/textures/facades/granite-grid.jpg`; the crop command is
in the main README under "Custom facades".

## models/kenney-car-kit — Kenney "Car Kit" 3.1

Licence: CC0 (public domain), <https://kenney.nl/assets/car-kit>. `License.txt`
is the copy shipped with the kit; `ambulance-preview.png` is its preview render.

In use (see `VEHICLE` in `src/city/assets.ts`):

- `public/models/ambulance.glb` + `public/models/Textures/colormap.png`. The
  .glb references the colour map by that relative path, so the two must keep
  that layout. Every model in the kit shares the same `colormap.png`, so any
  other car from it drops in by changing `VEHICLE.url`.
