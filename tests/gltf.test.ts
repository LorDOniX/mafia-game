import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLOATS_PER_MODEL_VERTEX, parseGlb } from '@/gfx/gltf';

const glb = readFileSync(fileURLToPath(new URL('../public/models/ambulance.glb', import.meta.url)));
const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;

describe('parseGlb', () => {
  const model = parseGlb(buffer);

  it('keeps every mesh node as a named part', () => {
    expect(model.parts.map((part) => part.name)).toEqual([
      'body',
      'wheel-front-right',
      'wheel-front-left',
      'wheel-back-right',
      'wheel-back-left',
      'door-right',
      'door-left',
    ]);
  });

  it('emits well-formed indexed triangles', () => {
    for (const part of model.parts) {
      const vertexCount = part.vertices.length / FLOATS_PER_MODEL_VERTEX;
      expect(Number.isInteger(vertexCount)).toBe(true);
      expect(part.indices.length % 3).toBe(0);
      for (const index of part.indices) expect(index).toBeLessThan(vertexCount);
    }
  });

  it('reads unit normals and UVs inside the colour map', () => {
    for (const part of model.parts) {
      for (let o = 0; o < part.vertices.length; o += FLOATS_PER_MODEL_VERTEX) {
        const [nx = 0, ny = 0, nz = 0, u = 0, v = 0] = part.vertices.subarray(o + 3, o + 8);
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 3);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('places parts by their node transforms', () => {
    const wheel = model.parts.find((part) => part.name === 'wheel-front-left');
    expect(wheel?.matrix[12]).toBeCloseTo(0.3);
    expect(wheel?.matrix[13]).toBeCloseTo(0.3);
    expect(wheel?.matrix[14]).toBeCloseTo(1.01);
    expect(wheel?.max.y).toBeCloseTo(0.3);
  });

  it('finds the external colour map and the material flags', () => {
    expect(model.image).toEqual({ kind: 'uri', uri: 'Textures/colormap.png' });
    expect(model.baseColor).toEqual([1, 1, 1, 1]);
    expect(model.doubleSided).toBe(true);
  });

  it('rejects files that are not GLB', () => {
    const html = new TextEncoder().encode('<!doctype html><html></html>');
    expect(() => parseGlb(html.buffer)).toThrow(/Not a binary glTF/);
  });
});
