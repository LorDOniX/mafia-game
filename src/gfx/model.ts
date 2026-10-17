import { createProgram, type Program } from './shader';
import { createMesh, type Mesh } from './mesh';
import { createTexture2D } from './texture';
import type { LoadedModel, RGBA } from './gltf';
import { multiply, type Mat4 } from '@/math/mat4';
import type { Vec3 } from '@/math/vec3';
import vertexSource from '@/shaders/model.vert.glsl?raw';
import fragmentSource from '@/shaders/model.frag.glsl?raw';

/** A model uploaded to the GPU: one mesh per part, sharing one texture. */
export interface Model {
  parts: Array<{ name: string; matrix: Mat4; mesh: Mesh; baseColor: RGBA }>;
  texture: WebGLTexture;
  doubleSided: boolean;
}

/** One placement of a model in the world. */
export interface ModelInstance {
  model: Model;
  /** Model to world. */
  transform: Mat4;
  /**
   * Extra transform per part, applied in the part's own space — around its
   * node origin, which is where a wheel's axle sits. Null leaves it at rest.
   */
  pose?: (part: string) => Mat4 | null;
}

type RGB = readonly [number, number, number];

/** Light and fog shared with the city pass, so models match their surroundings. */
export interface Lighting {
  cameraPos: Vec3;
  sunDir: Vec3;
  sunColor: RGB;
  ambient: RGB;
  fogColor: RGB;
  fogDensity: number;
}

export class ModelPass {
  private readonly program: Program;
  private readonly partMatrix: Mat4 = new Float32Array(16);
  private readonly posedMatrix: Mat4 = new Float32Array(16);

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, vertexSource, fragmentSource);
  }

  createModel({ data, image }: LoadedModel): Model {
    const { gl } = this;

    return {
      parts: data.parts.map((part) => ({
        name: part.name,
        matrix: part.matrix,
        baseColor: part.baseColor,
        mesh: createMesh(gl, part.vertices, part.indices, this.program.attributes, [
          { name: 'a_position', size: 3 },
          { name: 'a_normal', size: 3 },
          { name: 'a_uv', size: 2 },
        ]),
      })),
      texture: createTexture2D(gl, image),
      doubleSided: data.doubleSided,
    };
  }

  render(viewProj: Mat4, lighting: Lighting, instances: readonly ModelInstance[]): void {
    if (instances.length === 0) return;

    const { gl } = this;
    const u = this.program.uniforms;

    gl.useProgram(this.program.program);
    if (u['u_viewProj']) gl.uniformMatrix4fv(u['u_viewProj'], false, viewProj);
    if (u['u_cameraPos']) {
      const { x, y, z } = lighting.cameraPos;
      gl.uniform3f(u['u_cameraPos'], x, y, z);
    }
    if (u['u_sunDir']) {
      const { x, y, z } = lighting.sunDir;
      gl.uniform3f(u['u_sunDir'], x, y, z);
    }
    if (u['u_sunColor']) gl.uniform3fv(u['u_sunColor'], lighting.sunColor);
    if (u['u_ambient']) gl.uniform3fv(u['u_ambient'], lighting.ambient);
    if (u['u_fogColor']) gl.uniform3fv(u['u_fogColor'], lighting.fogColor);
    if (u['u_fogDensity']) gl.uniform1f(u['u_fogDensity'], lighting.fogDensity);
    if (u['u_texture']) gl.uniform1i(u['u_texture'], 0);
    gl.activeTexture(gl.TEXTURE0);

    for (const { model, transform, pose } of instances) {
      if (model.doubleSided) gl.disable(gl.CULL_FACE);
      gl.bindTexture(gl.TEXTURE_2D, model.texture);

      for (const part of model.parts) {
        multiply(transform, part.matrix, this.partMatrix);
        const extra = pose?.(part.name);
        const world = extra ? multiply(this.partMatrix, extra, this.posedMatrix) : this.partMatrix;

        if (u['u_model']) gl.uniformMatrix4fv(u['u_model'], false, world);
        if (u['u_baseColor']) gl.uniform4fv(u['u_baseColor'], part.baseColor);
        part.mesh.draw();
      }

      if (model.doubleSided) gl.enable(gl.CULL_FACE);
    }
  }
}
