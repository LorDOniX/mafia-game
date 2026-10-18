type AnisotropyExt = {
  TEXTURE_MAX_ANISOTROPY_EXT: number;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
};

/**
 * Použije nejvyšší anizotropii, kterou ovladač nabízí, pokud rozšíření existuje.
 *
 * Na plochy země se téměř pořád díváme pod ostrým úhlem; bez toho by se silnice
 * a chodník pár metrů před kamerou rozmazaly na kaši.
 */
export function applyMaxAnisotropy(gl: WebGL2RenderingContext, target: number): void {
  const ext = gl.getExtension('EXT_texture_filter_anisotropic') as AnisotropyExt | null;
  if (!ext) return;

  const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
  gl.texParameterf(target, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, 8));
}

const mipLevels = (size: number): number => Math.floor(Math.log2(size)) + 1;

/**
 * Zabalí stejně velké canvasy do TEXTURE_2D_ARRAY.
 *
 * Texture array je tu lepší než klasický atlas: každá vrstva si drží vlastní
 * REPEAT wrap a vlastní řetězec mipmap, takže opakované fasády nemohou prosakovat do
 * sousedů.
 *
 * Canvasy se nahrávají převrácené, takže spodní řádek obrázku leží na v = 0,
 * jak GL očekává. Na stěnách roste v od země nahoru, takže fasády stojí správně
 * a normal mapy v konvenci OpenGL mají zelenou směrem k +v.
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
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

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

  // Stav unpack je globální; cube mapa oblohy nesmí převrácení zdědit.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  applyMaxAnisotropy(gl, gl.TEXTURE_2D_ARRAY);

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return texture;
}

/** Stěny je nutné dodat v pořadí GL: +X, -X, +Y, -Y, +Z, -Z. */
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

  // Obloha je vždy na vzdálené rovině, takže mipmapy by se nikdy nevybraly.
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return texture;
}

/**
 * Obyčejná 2D textura s mipmapami, pro modely.
 *
 * Záměrně nahrávaná nepřevrácená: glTF umísťuje UV (0, 0) do levého horního rohu
 * obrázku, což je přesně tam, kde nepřevrácené nahrání nechá první řádek.
 * `null` dá bílou texturu 1x1, takže se vykreslí i modely bez textury.
 */
export function createTexture2D(
  gl: WebGL2RenderingContext,
  source: TexImageSource | null,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);

  if (source) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    applyMaxAnisotropy(gl, gl.TEXTURE_2D);
  } else {
    const white = new Uint8Array([255, 255, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  }

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}
