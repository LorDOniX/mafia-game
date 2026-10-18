import { createBuffer } from './buffer';

export interface AttributeLayout {
  /** Název atributu, jak je deklarován ve vertex shaderu. */
  name: string;
  /** Počet složek (1–4). */
  size: number;
}

/** Indexovaný statický mesh: jeden VAO, jeden element buffer, jeden draw call. */
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
 * Nahraje prokládaná vertexová data popsaná `layout` v pořadí deklarace.
 * Atributy, které shader vyoptimalizoval, se přeskočí místo hlášení chyby,
 * takže nepoužitá pole ve formátu vertexu zůstávají neškodná.
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
