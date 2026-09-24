export interface AttributeSpec {
  location: number;
  size: number;
  type?: number;
  normalized?: boolean;
  stride?: number;
  offset?: number;
}

export function createBuffer(
  gl: WebGL2RenderingContext,
  data: AllowSharedBufferSource,
  target: number = gl.ARRAY_BUFFER,
  usage: number = gl.STATIC_DRAW,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Failed to create buffer');

  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  gl.bindBuffer(target, null);
  return buffer;
}

/** Creates a VAO with the given attributes bound to `buffer`. */
export function createVertexArray(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  attributes: AttributeSpec[],
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create vertex array');

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  for (const attr of attributes) {
    if (attr.location < 0) continue;
    gl.enableVertexAttribArray(attr.location);
    gl.vertexAttribPointer(
      attr.location,
      attr.size,
      attr.type ?? gl.FLOAT,
      attr.normalized ?? false,
      attr.stride ?? 0,
      attr.offset ?? 0,
    );
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}
