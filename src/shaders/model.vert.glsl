#version 300 es

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;

uniform mat4 u_viewProj;
/** Z dílu do světa. Jen tuhý pohyb a uniformní měřítko, takže lze přenést i normály. */
uniform mat4 u_model;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  // Uniformní měřítko zachová směry až na délku, kterou fragment shader
  // znormalizuje; inverzní transpozice není potřeba.
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;

  gl_Position = u_viewProj * world;
}
