#version 300 es

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;

uniform mat4 u_viewProj;
/** Part to world. Rigid motion plus uniform scale only, so it can carry normals too. */
uniform mat4 u_model;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  // Uniform scale leaves directions intact up to length, which the fragment
  // shader normalises away; no inverse-transpose needed.
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;

  gl_Position = u_viewProj * world;
}
