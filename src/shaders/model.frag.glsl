#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_worldPos;

uniform sampler2D u_texture;
uniform vec4 u_baseColor;
uniform vec3 u_cameraPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_ambient;
uniform vec3 u_fogColor;
uniform float u_fogDensity;
/** Záře, která nepotřebuje světlo: sklo lampy v noci. */
uniform vec3 u_emissive;

#include "lights.glsl"

out vec4 outColor;

// Osvětlení a mlha odpovídají city.frag, takže modely stojí ve stejném světle
// jako okolní budovy.
void main() {
  vec3 albedo = texture(u_texture, v_uv).rgb * u_baseColor.rgb;

  // Oboustranné materiály se kreslí bez cullingu; zadní stěnu osvětlit jako
  // stranu, kterou pozorovatel skutečně vidí.
  vec3 n = normalize(v_normal) * (gl_FrontFacing ? 1.0 : -1.0);

  float sun = max(dot(n, u_sunDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 lit = albedo * (u_ambient * sky + u_sunColor * sun + spotLights(v_worldPos, n));

  float dist = distance(v_worldPos, u_cameraPos);
  float fog = 1.0 - exp(-pow(dist * u_fogDensity, 2.0));

  // Zářící části pronikají oparem dál než osvětlené.
  outColor = vec4(mix(lit, u_fogColor, fog) + u_emissive * (1.0 - fog * 0.6), 1.0);
}
