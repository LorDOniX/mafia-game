#version 300 es
precision highp float;

in vec3 v_dir;

uniform samplerCube u_sky;

out vec4 outColor;

void main() {
  outColor = vec4(texture(u_sky, normalize(v_dir)).rgb, 1.0);
}
