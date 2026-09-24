import { describe, expect, it } from 'vitest';
import { directionToEquirectUV, faceDirection, panoramaToSkyFaces } from '@/city/sky';
import { sampleBilinear } from '@/gfx/image';
import { normalize } from '@/math/vec3';

/**
 * Minimal stand-in for the browser class. The resampling code only needs
 * `width`, `height` and `data`, so this avoids pulling in a DOM environment.
 */
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class {
    readonly data: Uint8ClampedArray;
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  } as unknown as typeof ImageData;
}

/** Builds a panorama from a function of normalised (u, v). */
function makePanorama(
  width: number,
  height: number,
  shade: (u: number, v: number) => [number, number, number],
): ImageData {
  const image = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = shade((x + 0.5) / width, (y + 0.5) / height);
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }

  return image;
}

describe('faceDirection', () => {
  it('points each cube face along its own axis', () => {
    // The centre texel of every face must look straight down that face's axis.
    expect(faceDirection(0, 0, 0)).toEqual({ x: 1, y: -0, z: -0 });
    expect(faceDirection(1, 0, 0)).toEqual({ x: -1, y: -0, z: 0 });
    expect(faceDirection(2, 0, 0)).toEqual({ x: 0, y: 1, z: 0 });
    expect(faceDirection(3, 0, 0)).toEqual({ x: 0, y: -1, z: -0 });
    expect(faceDirection(4, 0, 0)).toEqual({ x: 0, y: -0, z: 1 });
    expect(faceDirection(5, 0, 0)).toEqual({ x: -0, y: -0, z: -1 });
  });

  it('spans the full face without leaving gaps at the edges', () => {
    // Corner texels must reach the cube's corners, i.e. all components +-1.
    const corner = faceDirection(0, 1, 1);
    expect(Math.abs(corner.x)).toBeCloseTo(1);
    expect(Math.abs(corner.y)).toBeCloseTo(1);
    expect(Math.abs(corner.z)).toBeCloseTo(1);
  });
});

describe('directionToEquirectUV', () => {
  it('puts the -Z meridian at the centre of the panorama', () => {
    expect(directionToEquirectUV({ x: 0, y: 0, z: -1 }).u).toBeCloseTo(0.5);
  });

  it('wraps longitude a quarter turn at a time', () => {
    expect(directionToEquirectUV({ x: -1, y: 0, z: 0 }).u).toBeCloseTo(0.25);
    expect(directionToEquirectUV({ x: 1, y: 0, z: 0 }).u).toBeCloseTo(0.75);
  });

  it('maps up to the top edge and down to the bottom edge', () => {
    expect(directionToEquirectUV({ x: 0, y: 1, z: 0 }).v).toBeCloseTo(0);
    expect(directionToEquirectUV({ x: 0, y: -1, z: 0 }).v).toBeCloseTo(1);
    expect(directionToEquirectUV({ x: 0, y: 0, z: -1 }).v).toBeCloseTo(0.5);
  });

  it('stays in range for directions slightly off the unit sphere', () => {
    const { u, v } = directionToEquirectUV(normalize({ x: 0.3, y: 1.4, z: -0.2 }));
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('panoramaToSkyFaces', () => {
  it('returns six square faces', () => {
    const panorama = makePanorama(64, 32, () => [10, 20, 30]);
    const faces = panoramaToSkyFaces(panorama, 8);

    expect(faces).toHaveLength(6);
    for (const face of faces) {
      expect(face.width).toBe(8);
      expect(face.height).toBe(8);
      expect(face.data[3]).toBe(255);
    }
  });

  /**
   * The +Y and -Y faces sample opposite poles of the panorama, so a
   * top/bottom split is the cleanest way to catch a flipped vertical axis.
   */
  it('sends the top of the panorama to the +Y face and the bottom to -Y', () => {
    const panorama = makePanorama(128, 64, (_u, v) => (v < 0.5 ? [255, 0, 0] : [0, 0, 255]));
    const faces = panoramaToSkyFaces(panorama, 8);

    const up = faces[2];
    const down = faces[3];
    if (!up || !down) throw new Error('expected six faces');

    expect(up.data[0]).toBeGreaterThan(200);
    expect(up.data[2]).toBeLessThan(55);
    expect(down.data[0]).toBeLessThan(55);
    expect(down.data[2]).toBeGreaterThan(200);
  });

  it('keeps longitude oriented so +X and -X land on opposite halves', () => {
    // Left half of the panorama red, right half green.
    const panorama = makePanorama(128, 64, (u) => (u < 0.5 ? [255, 0, 0] : [0, 255, 0]));
    const faces = panoramaToSkyFaces(panorama, 4);

    const plusX = faces[0];
    const minusX = faces[1];
    if (!plusX || !minusX) throw new Error('expected six faces');

    // +X sits at u = 0.75 (green half), -X at u = 0.25 (red half).
    expect(plusX.data[1]).toBeGreaterThan(plusX.data[0] ?? 0);
    expect(minusX.data[0]).toBeGreaterThan(minusX.data[1] ?? 0);
  });
});

describe('sampleBilinear', () => {
  const out: [number, number, number] = [0, 0, 0];

  it('reads back an exact texel centre', () => {
    const image = makePanorama(4, 4, (u) => [Math.round(u * 200), 0, 0]);
    sampleBilinear(image, 0.625, 0.5, out);
    expect(out[0]).toBeCloseTo(125, 0);
  });

  it('blends between neighbouring texels', () => {
    const image = makePanorama(2, 1, (u) => (u < 0.5 ? [0, 0, 0] : [200, 0, 0]));
    sampleBilinear(image, 0.5, 0.5, out);
    expect(out[0]).toBeGreaterThan(50);
    expect(out[0]).toBeLessThan(150);
  });

  it('wraps across the horizontal seam instead of clamping', () => {
    const image = makePanorama(4, 1, (u) => (u < 0.25 ? [255, 0, 0] : [0, 0, 0]));
    // Just left of u=0 should pick up the red column that wraps around.
    sampleBilinear(image, 0.999, 0.5, out);
    expect(out[0]).toBeGreaterThan(0);
  });
});
