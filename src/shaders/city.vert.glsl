#version 300 es

in vec3 a_position;
in vec3 a_normal;
/** xyz = směr texturové souřadnice U ve světovém prostoru, w = orientace bitangenty. */
in vec4 a_tangent;
in vec2 a_uv;
in float a_layer;
in vec3 a_tint;
/** x = seed náhodně rozsvícených oken (0 = žádná), y = vrstva noční textury (-1 = žádná). */
in vec2 a_night;

uniform mat4 u_viewProj;

out vec3 v_normal;
out vec4 v_tangent;
out vec2 v_uv;
flat out float v_layer;
out vec3 v_tint;
out vec3 v_worldPos;
flat out vec2 v_night;

void main() {
  v_normal = a_normal;
  v_tangent = a_tangent;
  v_uv = a_uv;
  v_layer = a_layer;
  v_tint = a_tint;
  v_worldPos = a_position;
  v_night = a_night;

  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
