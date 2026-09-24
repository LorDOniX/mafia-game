import { createBuffer } from './buffer';

export interface AttributeLayout {
  /** Attribute name as declared in the vertex shader. */
  name: string;
  /** Component count (1–4). */
  size: number;
}

/** An indexed, static mesh: one VAO, one element buffer, one draw call. */
export class Mesh {
  private readonly indexCount: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly vao: WebGLVertexArrayObject,
    indexCount: number,
  ) {
    this.indexCount = indexCount;
  }

  draw(): void {
    const { gl } = this;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}

/**
 * Uploads interleaved vertex data described by `layout`, in declaration order.
 * Attributes the shader optimised away are skipped rather than treated as an
 * error, so unused fields in the vertex format stay harmless.
 */
export function createMesh(
  gl: WebGL2RenderingContext,
  vertices: Float32Array,
  indices: Uint32Array,
  attributes: Record<string, number>,
  layout: AttributeLayout[],
): Mesh {
  const stride = layout.reduce((total, attr) => total + attr.size, 0) * 4;

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create vertex array');

  const vertexBuffer = createBuffer(gl, vertices);
  const indexBuffer = createBuffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER);

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  let offset = 0;
  for (const attr of layout) {
    const location = attributes[attr.name];
    if (location !== undefined && location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attr.size, gl.FLOAT, false, stride, offset);
    }
    offset += attr.size * 4;
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return new Mesh(gl, vao, indices.length);
}
