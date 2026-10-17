import { createProgram, type Program } from './shader';
import { createMesh, type Mesh } from './mesh';
import { createTextureArray } from './texture';
import { Skybox } from './skybox';
import { ModelPass, type Lighting, type Model, type ModelInstance } from './model';
import type { LoadedModel } from './gltf';
import { LightBuffer, withLights, type SpotLight } from './lights';
import { buildCityMesh } from '@/city/mesh';
import { TEXTURE_SIZE } from '@/city/textures';
import { createNightSkyFaces, NIGHT_HORIZON_COLOR } from '@/city/sky';
import { NORMAL_STRENGTH, type CityAssets } from '@/city/assets';
import type { CityLayout } from '@/city/layout';
import type { Camera } from '@/core/camera';
import type { GLContext } from './context';
import vertexSource from '@/shaders/city.vert.glsl?raw';
import fragmentSource from '@/shaders/city.frag.glsl?raw';

const SUN_COLOR: [number, number, number] = [1.0, 0.94, 0.82];
const AMBIENT: [number, number, number] = [0.42, 0.46, 0.54];
/**
 * Tuned so the far corners of the map dissolve into the skybox horizon while
 * leaving the nearer blocks readable from the air.
 */
const FOG_DENSITY = 0.0016;

/** No sun, and barely any sky light: after dark the lamps and headlights do the work. */
const NIGHT_SUN: [number, number, number] = [0, 0, 0];
const NIGHT_AMBIENT: [number, number, number] = [0.015, 0.018, 0.028];
/** Thicker than by day, so unlit streets sink into the dark. */
const NIGHT_FOG_DENSITY = 0.006;

export interface RenderStats {
  triangles: number;
}

export interface SceneState {
  night: boolean;
  /** Already narrowed to what the shaders can take; see `nearestLights`. Lit by day too. */
  lights: readonly SpotLight[];
}

const DAYTIME: SceneState = { night: false, lights: [] };

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: Program;
  private readonly city: Mesh;
  private readonly atlas: WebGLTexture;
  private readonly normals: WebGLTexture;
  private readonly skybox: Skybox;
  private readonly nightSkybox: Skybox;
  private readonly models: ModelPass;
  private readonly sky: CityAssets['sky'];
  private readonly lights = new LightBuffer();

  readonly stats: RenderStats;

  constructor(
    private readonly ctx: GLContext,
    layout: CityLayout,
    assets: CityAssets,
  ) {
    this.gl = ctx.gl;
    this.sky = assets.sky;
    const { gl } = this;

    this.program = createProgram(gl, vertexSource, withLights(fragmentSource));
    this.atlas = createTextureArray(gl, assets.surfaces, TEXTURE_SIZE);
    this.normals = createTextureArray(gl, assets.normals, TEXTURE_SIZE);

    const data = buildCityMesh(layout);
    this.city = createMesh(gl, data.vertices, data.indices, this.program.attributes, [
      { name: 'a_position', size: 3 },
      { name: 'a_normal', size: 3 },
      { name: 'a_tangent', size: 4 },
      { name: 'a_uv', size: 2 },
      { name: 'a_layer', size: 1 },
      { name: 'a_tint', size: 3 },
    ]);
    this.stats = { triangles: data.indices.length / 3 };

    this.skybox = new Skybox(gl, assets.sky.faces);
    this.nightSkybox = new Skybox(gl, createNightSkyFaces());
    this.models = new ModelPass(gl);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  createModel(loaded: LoadedModel): Model {
    return this.models.createModel(loaded);
  }

  render(
    camera: Camera,
    instances: readonly ModelInstance[] = [],
    scene: SceneState = DAYTIME,
  ): void {
    const { gl } = this;

    if (this.ctx.resize()) {
      camera.aspect = this.ctx.canvas.width / this.ctx.canvas.height;
    }
    camera.update();

    const { night } = scene;
    const sunColor = night ? NIGHT_SUN : SUN_COLOR;
    const ambient = night ? NIGHT_AMBIENT : AMBIENT;
    const fogColor = night ? NIGHT_HORIZON_COLOR : this.sky.horizonColor;
    const fogDensity = night ? NIGHT_FOG_DENSITY : FOG_DENSITY;
    this.lights.set(scene.lights);

    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program.program);

    const u = this.program.uniforms;
    if (u['u_viewProj']) gl.uniformMatrix4fv(u['u_viewProj'], false, camera.viewProjection);
    if (u['u_cameraPos']) {
      gl.uniform3f(u['u_cameraPos'], camera.position.x, camera.position.y, camera.position.z);
    }
    if (u['u_sunDir']) {
      const sun = this.sky.sunDirection;
      gl.uniform3f(u['u_sunDir'], sun.x, sun.y, sun.z);
    }
    if (u['u_sunColor']) gl.uniform3fv(u['u_sunColor'], sunColor);
    if (u['u_ambient']) gl.uniform3fv(u['u_ambient'], ambient);
    if (u['u_fogColor']) gl.uniform3fv(u['u_fogColor'], fogColor);
    if (u['u_fogDensity']) gl.uniform1f(u['u_fogDensity'], fogDensity);
    if (u['u_normalStrength']) gl.uniform1f(u['u_normalStrength'], NORMAL_STRENGTH);
    if (u['u_atlas']) gl.uniform1i(u['u_atlas'], 0);
    if (u['u_normals']) gl.uniform1i(u['u_normals'], 1);
    this.lights.upload(gl, u);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normals);

    this.city.draw();

    const lighting: Lighting = {
      cameraPos: camera.position,
      sunDir: this.sky.sunDirection,
      sunColor,
      ambient,
      fogColor,
      fogDensity,
      lights: this.lights,
      emissiveScale: night ? 1 : 0,
    };
    this.models.render(camera.viewProjection, lighting, instances);

    (night ? this.nightSkybox : this.skybox).render(camera.view, camera.projection);
  }
}
