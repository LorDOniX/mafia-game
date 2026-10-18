import { createProgram, type Program } from './shader';
import { createMesh, type Mesh } from './mesh';
import { stripTranslation, multiply, type Mat4 } from '@/math/mat4';
import { createCubeMap } from './texture';
import { SKY_FACE_SIZE } from '@/city/sky';
import vertexSource from '@/shaders/skybox.vert.glsl?raw';
import fragmentSource from '@/shaders/skybox.frag.glsl?raw';

/** Unit cube centred on the origin; only positions are needed. */
const CUBE_VERTICES = new Float32Array([
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
]);

const CUBE_INDICES = new Uint32Array([
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7,
  0, 7, 4,
]);

export class Skybox {
  private readonly program: Program;
  private readonly mesh: Mesh;
  private readonly day: WebGLTexture;
  private readonly night: WebGLTexture;
  private readonly viewNoTranslate: Mat4 = new Float32Array(16);
  private readonly viewProj: Mat4 = new Float32Array(16);

  constructor(
    private readonly gl: WebGL2RenderingContext,
    dayFaces: ImageData[],
    nightFaces: ImageData[],
  ) {
    this.program = createProgram(gl, vertexSource, fragmentSource);
    this.day = createCubeMap(gl, dayFaces, SKY_FACE_SIZE);
    this.night = createCubeMap(gl, nightFaces, SKY_FACE_SIZE);
    this.mesh = createMesh(gl, CUBE_VERTICES, CUBE_INDICES, this.program.attributes, [
      { name: 'a_position', size: 3 },
    ]);
  }

  /**
   * Draw last, after opaque geometry: the depth test then rejects every sky
   * fragment the city already covers instead of shading it twice.
   *
   * `night` crossfades to the night sky; `glow` is added low on the horizon.
   */
  render(
    view: Mat4,
    projection: Mat4,
    night: number,
    glow: readonly [number, number, number],
  ): void {
    const { gl } = this;

    // Dropping the translation column pins the cube to the camera, so the sky
    // stays infinitely far away however far the player walks.
    stripTranslation(view, this.viewNoTranslate);
    multiply(projection, this.viewNoTranslate, this.viewProj);

    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.program.program);

    const u = this.program.uniforms;
    if (u['u_viewProjNoTranslate'])
      gl.uniformMatrix4fv(u['u_viewProjNoTranslate'], false, this.viewProj);
    if (u['u_sky']) gl.uniform1i(u['u_sky'], 0);
    if (u['u_nightSky']) gl.uniform1i(u['u_nightSky'], 1);
    if (u['u_night']) gl.uniform1f(u['u_night'], night);
    if (u['u_glow']) gl.uniform3fv(u['u_glow'], glow);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.day);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.night);
    gl.activeTexture(gl.TEXTURE0);

    this.mesh.draw();

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
  }
}
