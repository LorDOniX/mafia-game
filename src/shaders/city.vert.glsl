#version 300 es

in vec3 a_position;
in vec3 a_normal;
/** xyz = texture U direction in world space, w = bitangent handedness. */
in vec4 a_tangent;
in vec2 a_uv;
in float a_layer;
in vec3 a_tint;

uniform mat4 u_viewProj;

out vec3 v_normal;
out vec4 v_tangent;
out vec2 v_uv;
flat out float v_layer;
out vec3 v_tint;
out vec3 v_worldPos;

void main() {
  v_normal = a_normal;
  v_tangent = a_tangent;
  v_uv = a_uv;
  v_layer = a_layer;
  v_tint = a_tint;
  v_worldPos = a_position;

  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
