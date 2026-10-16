import { fromTRS, identity, multiply, type Mat4 } from '@/math/mat4';
import type { Vec3 } from '@/math/vec3';
import { loadImageBitmap } from './image';

/**
 * A minimal glTF 2.0 loader, binary (.glb) only.
 *
 * It reads what a vehicle prop needs and nothing more: triangle meshes with
 * positions, normals and one UV set, the node hierarchy, and a single
 * base-colour texture. No animation, skinning, morph targets or PBR. Anything
 * it cannot honour throws with a reason, rather than drawing something wrong.
 *
 * Mesh nodes come out as separate parts, keyed by node name, so a caller can
 * move pieces independently — spin wheels, open doors.
 */

/** position(3) + normal(3) + uv(2) */
export const FLOATS_PER_MODEL_VERTEX = 8;

export interface ModelPart {
  name: string;
  /** The node's transform into model space, parents included. */
  matrix: Mat4;
  vertices: Float32Array;
  indices: Uint32Array;
  /** Bounds of the part's own geometry, before `matrix`. */
  min: Vec3;
  max: Vec3;
}

/** A `uri` image is relative to the model file, as glTF specifies. */
export type ModelImage =
  | { kind: 'uri'; uri: string }
  | { kind: 'embedded'; bytes: Uint8Array<ArrayBuffer>; mimeType: string };

export interface ModelData {
  parts: ModelPart[];
  /** The first base-colour texture any material uses. */
  image: ModelImage | null;
  /** Multiplied over the texture. */
  baseColor: [number, number, number, number];
  doubleSided: boolean;
}

export interface LoadedModel {
  data: ModelData;
  /** Null when the model has no texture or it failed to load. */
  image: ImageBitmap | null;
}

export async function loadModel(url: string): Promise<LoadedModel> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);

  // A mistyped path gets Vite's HTML fallback with a 200, which the magic
  // number check in parseGlb turns into a clear error.
  const data = parseGlb(await response.arrayBuffer());
  return { data, image: await loadModelImage(url, data.image) };
}

async function loadModelImage(
  modelUrl: string,
  image: ModelImage | null,
): Promise<ImageBitmap | null> {
  if (!image) return null;

  try {
    if (image.kind === 'embedded') {
      return await createImageBitmap(new Blob([image.bytes], { type: image.mimeType }));
    }
    const base = new URL(modelUrl, location.href);
    return await loadImageBitmap(new URL(image.uri, base).href);
  } catch (error) {
    console.warn(`Model ${modelUrl}: texture failed to load, drawing it untextured:`, error);
    return null;
  }
}

// Only the slice of the glTF schema this loader reads.
interface GltfJson {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  accessors?: GltfAccessor[];
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  buffers?: Array<{ byteLength: number; uri?: string }>;
  materials?: Array<{
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
    doubleSided?: boolean;
  }>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ uri?: string; bufferView?: number; mimeType?: string }>;
  extensionsRequired?: string[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const FLOAT = 5126;
const INDEX_SIZES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4 };
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TRIANGLES = 4;

export function parseGlb(buffer: ArrayBuffer): ModelData {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a binary glTF (.glb) file');
  }

  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported glTF version ${version}`);

  let json: GltfJson | null = null;
  let bin: DataView | null = null;

  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;

    if (type === CHUNK_JSON) {
      json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, start, length)),
      ) as GltfJson;
    } else if (type === CHUNK_BIN) {
      bin = new DataView(buffer, start, length);
    }
    // Chunk lengths already include their 4-byte padding.
    offset = start + length;
  }

  if (!json) throw new Error('GLB has no JSON chunk');
  return readModel(json, bin);
}

function readModel(gltf: GltfJson, bin: DataView | null): ModelData {
  if (gltf.extensionsRequired?.length) {
    // Typically Draco or meshopt compression; re-export without it.
    throw new Error(`Unsupported required extensions: ${gltf.extensionsRequired.join(', ')}`);
  }
  if (gltf.buffers?.some((buffer) => buffer.uri !== undefined)) {
    throw new Error('External .bin buffers are not supported; export as a single .glb');
  }

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene) throw new Error('glTF has no scene');

  const model: ModelData = { parts: [], image: null, baseColor: [1, 1, 1, 1], doubleSided: false };
  let materialSeen = false;

  const visit = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index];
    if (!node) throw new Error(`Missing node ${index}`);

    const local = node.matrix
      ? Float32Array.from(node.matrix)
      : fromTRS(
          node.translation ?? [0, 0, 0],
          node.rotation ?? [0, 0, 0, 1],
          node.scale ?? [1, 1, 1],
        );
    const matrix = multiply(parent, local);

    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) throw new Error(`Missing mesh ${node.mesh}`);

      const name = node.name ?? mesh.name ?? `node-${index}`;
      model.parts.push(readMesh(gltf, bin, mesh.primitives, name, matrix));

      // One texture per model: the first material that names one wins.
      for (const primitive of mesh.primitives) {
        if (materialSeen || primitive.material === undefined) continue;
        materialSeen = true;
        readMaterial(gltf, bin, primitive.material, model);
      }
    }

    for (const child of node.children ?? []) visit(child, matrix);
  };

  for (const root of scene.nodes ?? []) visit(root, identity());
  return model;
}

function readMesh(
  gltf: GltfJson,
  bin: DataView | null,
  primitives: GltfPrimitive[],
  name: string,
  matrix: Mat4,
): ModelPart {
  const vertices: number[] = [];
  const indices: number[] = [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const primitive of primitives) {
    if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) {
      throw new Error(`Mesh "${name}": only triangle lists are supported`);
    }

    const { POSITION, NORMAL, TEXCOORD_0 } = primitive.attributes;
    if (POSITION === undefined) throw new Error(`Mesh "${name}" has no positions`);
    if (NORMAL === undefined) throw new Error(`Mesh "${name}" has no normals; export with normals`);

    const positions = readFloats(gltf, bin, POSITION, 'VEC3');
    const normals = readFloats(gltf, bin, NORMAL, 'VEC3');
    const uvs = TEXCOORD_0 !== undefined ? readFloats(gltf, bin, TEXCOORD_0, 'VEC2') : null;
    const count = positions.length / 3;
    const base = vertices.length / FLOATS_PER_MODEL_VERTEX;

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] ?? 0;
      const y = positions[i * 3 + 1] ?? 0;
      const z = positions[i * 3 + 2] ?? 0;
      vertices.push(
        x,
        y,
        z,
        normals[i * 3] ?? 0,
        normals[i * 3 + 1] ?? 0,
        normals[i * 3 + 2] ?? 0,
        uvs?.[i * 2] ?? 0,
        uvs?.[i * 2 + 1] ?? 0,
      );

      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }

    if (primitive.indices !== undefined) {
      for (const index of readIndices(gltf, bin, primitive.indices)) indices.push(base + index);
    } else {
      for (let i = 0; i < count; i++) indices.push(base + i);
    }
  }

  return {
    name,
    matrix,
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    min,
    max,
  };
}

function readMaterial(gltf: GltfJson, bin: DataView | null, index: number, model: ModelData): void {
  const material = gltf.materials?.[index];
  if (!material) return;

  model.doubleSided = material.doubleSided ?? false;

  const [r = 1, g = 1, b = 1, a = 1] = material.pbrMetallicRoughness?.baseColorFactor ?? [];
  model.baseColor = [r, g, b, a];

  const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
  if (textureIndex === undefined) return;

  const source = gltf.textures?.[textureIndex]?.source;
  const image = source !== undefined ? gltf.images?.[source] : undefined;
  if (!image) return;

  if (image.uri !== undefined) {
    model.image = { kind: 'uri', uri: image.uri };
  } else if (image.bufferView !== undefined && image.mimeType) {
    const { start, length } = viewRange(gltf, bin, image.bufferView);
    if (!bin) throw new Error('Embedded image but no binary chunk');
    // Copied out, so the image does not keep the whole GLB alive.
    const bytes = new Uint8Array(bin.buffer, bin.byteOffset + start, length).slice();
    model.image = { kind: 'embedded', bytes, mimeType: image.mimeType };
  }
}

function viewRange(
  gltf: GltfJson,
  bin: DataView | null,
  index: number,
): { start: number; length: number; stride: number | undefined } {
  const view = gltf.bufferViews?.[index];
  if (!view) throw new Error(`Missing buffer view ${index}`);
  if (view.buffer !== 0 || !bin) throw new Error(`Buffer view ${index} is outside the GLB`);

  return { start: view.byteOffset ?? 0, length: view.byteLength, stride: view.byteStride };
}

function accessorAt(gltf: GltfJson, index: number): GltfAccessor {
  const accessor = gltf.accessors?.[index];
  if (!accessor) throw new Error(`Missing accessor ${index}`);
  if (accessor.sparse) throw new Error(`Accessor ${index}: sparse accessors are not supported`);
  return accessor;
}

function readFloats(
  gltf: GltfJson,
  bin: DataView | null,
  index: number,
  type: string,
): Float32Array {
  const accessor = accessorAt(gltf, index);
  const components = COMPONENTS[type] ?? 1;

  if (accessor.type !== type) {
    throw new Error(`Accessor ${index}: expected ${type}, got ${accessor.type}`);
  }
  if (accessor.componentType !== FLOAT) {
    throw new Error(`Accessor ${index}: only float attributes are supported; export unquantised`);
  }

  const out = new Float32Array(accessor.count * components);
  // An accessor with no buffer view is all zeros by definition.
  if (accessor.bufferView === undefined || !bin) return out;

  const { start, stride = components * 4 } = viewRange(gltf, bin, accessor.bufferView);
  const base = start + (accessor.byteOffset ?? 0);

  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      out[i * components + c] = bin.getFloat32(base + i * stride + c * 4, true);
    }
  }
  return out;
}

function readIndices(gltf: GltfJson, bin: DataView | null, index: number): Uint32Array {
  const accessor = accessorAt(gltf, index);
  const size = INDEX_SIZES[accessor.componentType];
  if (!size) throw new Error(`Accessor ${index}: unsupported index type ${accessor.componentType}`);
  if (accessor.bufferView === undefined || !bin) {
    throw new Error(`Accessor ${index}: indices without data`);
  }

  const { start, stride = size } = viewRange(gltf, bin, accessor.bufferView);
  const base = start + (accessor.byteOffset ?? 0);
  const out = new Uint32Array(accessor.count);

  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride;
    out[i] =
      size === 1
        ? bin.getUint8(at)
        : size === 2
          ? bin.getUint16(at, true)
          : bin.getUint32(at, true);
  }
  return out;
}
