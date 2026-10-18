#version 300 es
precision highp float;

in vec3 v_dir;

uniform samplerCube u_sky;
uniform samplerCube u_nightSky;
/** 0 zobrazí denní oblohu, 1 noční, cokoli mezi tím prolínání. */
uniform float u_night;
/** Teplo východu a západu slunce, nejsilnější přímo na obzoru. */
uniform vec3 u_glow;

out vec4 outColor;

void main() {
  vec3 dir = normalize(v_dir);
  vec3 sky = mix(texture(u_sky, dir).rgb, texture(u_nightSky, dir).rgb, u_night);
  float horizon = pow(1.0 - abs(dir.y), 6.0);
  outColor = vec4(sky + u_glow * horizon, 1.0);
}
