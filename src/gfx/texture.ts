type AnisotropyExt = {
  TEXTURE_MAX_ANISOTROPY_EXT: number;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
};

/**
 * Applies the highest anisotropy the driver offers, if the extension exists.
 *
 * Ground planes are viewed at grazing angles almost all the time; without this
 * the road and sidewalk blur into mush a few metres ahead of the camera.
 */
export function applyMaxAnisotropy(gl: WebGL2RenderingContext, target: number): void {
  const ext = gl.getExtension('EXT_texture_filter_anisotropic') as AnisotropyExt | null;
  if (!ext) return;

  const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
  gl.texParameterf(target, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, 8));
}

const mipLevels = (size: number): number => Math.floor(Math.log2(size)) + 1;

/**
 * Packs equally sized canvases into a TEXTURE_2D_ARRAY.
 *
 * An array beats a classic atlas here: every layer keeps its own REPEAT wrap
 * and its own mip chain, so tiled facades cannot bleed into their neighbours.
 */
export function createTextureArray(
  gl: WebGL2RenderingContext,
  sources: HTMLCanvasElement[],
  size: number,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture array');

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels(size), gl.RGBA8, size, size, sources.length);

  sources.forEach((source, layer) => {
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      size,
      size,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );
  });

  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  applyMaxAnisotropy(gl, gl.TEXTURE_2D_ARRAY);

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return texture;
}

/** Faces must be supplied in GL order: +X, -X, +Y, -Y, +Z, -Z. */
export function createCubeMap(
  gl: WebGL2RenderingContext,
  faces: ImageData[],
  size: number,
): WebGLTexture {
  if (faces.length !== 6) throw new Error(`A cube map needs 6 faces, got ${faces.length}`);

  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create cube map');

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, size, size);

  faces.forEach((face, i) => {
    gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, face);
  });

  // The sky is always at the far plane, so mipmaps would never be selected.
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return texture;
}
