import { fromTRS, identity, multiply, transformPoint, type Mat4 } from '@/math/mat4';
import type { Vec3 } from '@/math/vec3';
import { loadImageBitmap, publicUrl } from './image';

/**
 * Minimalistický loader glTF 2.0, pouze binární (.glb).
 *
 * Čte to, co rekvizita potřebuje, a nic víc: trojúhelníkové meshe s
 * pozicemi, normálami a jednou sadou UV, hierarchii uzlů, základní barvu pro
 * každý materiál a jedinou texturu základní barvy. Žádná animace, skinning, morph
 * targety ani PBR. Cokoli, co nedokáže dodržet, vyhodí chybu s důvodem, místo
 * toho, aby vykreslil něco špatně.
 *
 * Uzly s meshem vycházejí jako samostatné části s klíčem podle názvu uzlu, takže
 * volající může hejbat díly nezávisle — točit koly, otevírat dveře. Uzel, jehož
 * mesh používá více materiálů, se stane více částmi se stejným názvem.
 */

/** pozice(3) + normála(3) + uv(2) */
export const FLOATS_PER_MODEL_VERTEX = 8;

export interface ModelPart {
  name: string;
  /** Transformace uzlu do prostoru modelu, včetně rodičů. */
  matrix: Mat4;
  vertices: Float32Array;
  indices: Uint32Array;
  /** Hranice vlastní geometrie části, před aplikací `matrix`. */
  min: Vec3;
  max: Vec3;
  /** Barva materiálu, násobená přes texturu. */
  baseColor: RGBA;
  /** Světlo, které materiál sám vyzařuje, zobrazené jen při rozsvícených světlech. */
  emissive: RGB;
}

export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];

/** Obrázek typu `uri` je relativní k souboru modelu, jak určuje glTF. */
export type ModelImage =
  | { kind: 'uri'; uri: string }
  | { kind: 'embedded'; bytes: Uint8Array<ArrayBuffer>; mimeType: string };

export interface ModelData {
  parts: ModelPart[];
  /** První textura základní barvy, kterou používá některý materiál. */
  image: ModelImage | null;
  doubleSided: boolean;
}

export interface LoadedModel {
  data: ModelData;
  /** Null, pokud model nemá texturu nebo se ji nepodařilo načíst. */
  image: ImageBitmap | null;
}

/** Nejnižší a nejvyšší bod modelu v klidu, v prostoru modelu. */
export function verticalExtent(model: ModelData): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of model.parts) {
    for (const y of [part.min.y, part.max.y]) {
      const p = transformPoint(part.matrix, { x: part.min.x, y, z: part.min.z });
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minY, maxY };
}

export async function loadModel(url: string): Promise<LoadedModel> {
  const response = await fetch(publicUrl(url));
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);

  // Překlep v cestě vrátí HTML fallback Vite se stavem 200, což kontrola
  // magického čísla v parseGlb převede na srozumitelnou chybu.
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
    const base = new URL(publicUrl(modelUrl), location.href);
    return await loadImageBitmap(new URL(image.uri, base).href);
  } catch (error) {
    console.warn(`Model ${modelUrl}: texture failed to load, drawing it untextured:`, error);
    return null;
  }
}

// Jen ta část schématu glTF, kterou tento loader čte.
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
      baseColorTexture?: {
        index: number;
        extensions?: {
          KHR_texture_transform?: { offset?: number[]; scale?: number[]; rotation?: number };
        };
      };
    };
    emissiveFactor?: number[];
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

/**
 * Povinná rozšíření, která lze bezpečně přejít. Unlit materiály se stínují jako
 * kterékoli jiné, takže postavy zapadnou do osvětlení města; transformace textur
 * se přijímají jen jako identita, což je vše, co Kenneyho kity používají.
 */
const TOLERATED_EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_texture_transform']);

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
    // Délky chunků už zahrnují své 4bajtové zarovnání.
    offset = start + length;
  }

  if (!json) throw new Error('GLB has no JSON chunk');
  return readModel(json, bin);
}

function readModel(gltf: GltfJson, bin: DataView | null): ModelData {
  const unsupported = (gltf.extensionsRequired ?? []).filter((e) => !TOLERATED_EXTENSIONS.has(e));
  if (unsupported.length) {
    // Typicky komprese Draco nebo meshopt; exportujte znovu bez ní.
    throw new Error(`Unsupported required extensions: ${unsupported.join(', ')}`);
  }
  if (gltf.buffers?.some((buffer) => buffer.uri !== undefined)) {
    throw new Error('External .bin buffers are not supported; export as a single .glb');
  }

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene) throw new Error('glTF has no scene');

  const model: ModelData = { parts: [], image: null, doubleSided: false };
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
      const byMaterial = new Map<number | undefined, GltfPrimitive[]>();
      for (const primitive of mesh.primitives) {
        const group = byMaterial.get(primitive.material);
        if (group) group.push(primitive);
        else byMaterial.set(primitive.material, [primitive]);
      }

      for (const [material, primitives] of byMaterial) {
        const { baseColor, emissive } = materialColor(gltf, material);
        model.parts.push(readMesh(gltf, bin, primitives, name, matrix, baseColor, emissive));

        // Jedna textura na model: vyhrává první materiál, který nějakou uvádí.
        if (!materialSeen && material !== undefined) {
          materialSeen = true;
          readMaterial(gltf, bin, material, model);
        }
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
  baseColor: RGBA,
  emissive: RGB,
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
    const source =
      primitive.indices !== undefined
        ? readIndices(gltf, bin, primitive.indices)
        : Uint32Array.from({ length: count }, (_, i) => i);

    // Primitivy často sdílejí jeden vertex buffer; ponecháme jen vrcholy, které používá tento.
    const remap = new Map<number, number>();
    for (const i of source) {
      let mapped = remap.get(i);
      if (mapped === undefined) {
        mapped = vertices.length / FLOATS_PER_MODEL_VERTEX;
        remap.set(i, mapped);

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
      indices.push(mapped);
    }
  }

  return {
    name,
    matrix,
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    min,
    max,
    baseColor,
    emissive,
  };
}

function materialColor(gltf: GltfJson, index: number | undefined): { baseColor: RGBA; emissive: RGB } {
  const material = index !== undefined ? gltf.materials?.[index] : undefined;
  const [r = 1, g = 1, b = 1, a = 1] = material?.pbrMetallicRoughness?.baseColorFactor ?? [];
  const [er = 0, eg = 0, eb = 0] = material?.emissiveFactor ?? [];
  return { baseColor: [r, g, b, a], emissive: [er, eg, eb] };
}

function readMaterial(gltf: GltfJson, bin: DataView | null, index: number, model: ModelData): void {
  const material = gltf.materials?.[index];
  if (!material) return;

  model.doubleSided = material.doubleSided ?? false;

  const transform =
    material.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;
  if (transform && (transform.offset || transform.scale || transform.rotation)) {
    throw new Error('Texture transforms other than the identity are not supported');
  }

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
    // Zkopírováno ven, aby obrázek nedržel naživu celý GLB.
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
  // Accessor bez buffer view obsahuje z definice samé nuly.
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
