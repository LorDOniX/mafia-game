#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 v_normal;
in vec4 v_tangent;
in vec2 v_uv;
flat in float v_layer;
in vec3 v_tint;
in vec3 v_worldPos;
flat in vec2 v_night;

uniform sampler2DArray u_atlas;
uniform sampler2DArray u_normals;
uniform vec3 u_cameraPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_ambient;
uniform vec3 u_fogColor;
uniform float u_fogDensity;
/** Škáluje sílu normal mapy; 0 se vrací k ploché geometrické normále. */
uniform float u_normalStrength;
/** Jak moc jsou rozsvícená okna, 0 ve dne a 1 v noci. */
uniform float u_night;

#include "lights.glsl"

out vec4 outColor;

/** Podíl oken, ve kterých se v noci svítí. */
const float LIT_SHARE = 0.35;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

/** Záře skla procedurálního okna; jedna dlaždice = jedno okno, viz drawWindow v textures.ts. */
vec3 windowGlow(vec2 uv, float seed) {
  vec2 f = fract(uv);
  // Sklo bez rámu a příčlí, v = 0 dole.
  if (f.x < 0.29 || f.x > 0.71 || f.y < 0.3 || f.y > 0.8) return vec3(0.0);
  if (abs(f.x - 0.5) < 0.004 || abs(f.y - 0.575) < 0.004) return vec3(0.0);

  vec2 cell = floor(uv);
  float pick = hash(vec3(cell, seed * 113.0));
  if (pick > LIT_SHARE) return vec3(0.0);
  float shade = hash(vec3(cell.yx, seed * 71.0 + 5.0));
  vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.86, 0.6), shade);
  // Horní okraj tabule je u stropu místnosti o kousek tmavší.
  return warm * (0.55 + 0.45 * shade) * mix(1.0, 0.75, smoothstep(0.55, 0.8, f.y));
}

void main() {
  vec3 albedo = texture(u_atlas, vec3(v_uv, v_layer)).rgb * v_tint;

  vec3 geometric = normalize(v_normal);

  // Normal mapa v tangent space. Bitangenta se zde rekonstruuje místo předávání
  // pro každý vertex; jediné, co nelze získat zpět, je znaménko orientace.
  vec3 tangent = normalize(v_tangent.xyz);
  vec3 bitangent = cross(geometric, tangent) * v_tangent.w;
  vec3 sampled = texture(u_normals, vec3(v_uv, v_layer)).xyz * 2.0 - 1.0;

  // Zploštění xy směrem k nule efekt zmírní bez renormalizace samotné mapy,
  // takže jeden uniform ho může globálně ztlumit.
  sampled.xy *= u_normalStrength;
  vec3 n = normalize(mat3(tangent, bitangent, geometric) * sampled);

  float sun = max(dot(n, u_sunDir), 0.0);
  // Levný odraz od oblohy: plochy obrácené nahoru sbírají víc ambientu než ty dolů.
  float sky = 0.5 + 0.5 * n.y;

  vec3 lit = albedo * (u_ambient * sky + u_sunColor * sun + spotLights(v_worldPos, n));

  // Derivace mimo větvení, aby mipmapy noční textury fungovaly i uvnitř podmínky.
  vec2 uvDx = dFdx(v_uv);
  vec2 uvDy = dFdy(v_uv);
  if (u_night > 0.0) {
    // Noční fotka už osvětlení obsahuje, takže se přičítá jako emise.
    if (v_night.y >= 0.0) {
      lit += textureGrad(u_atlas, vec3(v_uv, v_night.y), uvDx, uvDy).rgb * u_night;
    } else if (v_night.x > 0.0) {
      lit += windowGlow(v_uv, v_night.x) * u_night;
    }
  }

  // Exponenciálně-kvadratická mlha naladěná na obzor skyboxu, aby se město
  // rozplynulo v obloze místo končení ostrou hranou.
  //
  // Vzdálenost se měří pro každý fragment, ne interpolací z vertexů: vozovka je
  // jediný quad velikosti mapy, takže vzdálenosti vertexů jsou stovky metrů
  // i přímo pod kamerou.
  float dist = distance(v_worldPos, u_cameraPos);
  float fog = 1.0 - exp(-pow(dist * u_fogDensity, 2.0));

  outColor = vec4(mix(lit, u_fogColor, fog), 1.0);
}
