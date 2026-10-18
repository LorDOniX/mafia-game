#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 v_normal;
in vec4 v_tangent;
in vec2 v_uv;
flat in float v_layer;
in vec3 v_tint;
in vec3 v_worldPos;

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

#include "lights.glsl"

out vec4 outColor;

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
