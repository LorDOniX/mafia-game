#define MAX_LIGHTS 32

uniform int u_lightCount;
// xyz position, w range in metres.
uniform vec4 u_lightPos[MAX_LIGHTS];
// xyz cone axis, w cosine of the outer half-angle.
uniform vec4 u_lightDir[MAX_LIGHTS];
// rgb colour times intensity, w cosine of the inner half-angle.
uniform vec4 u_lightColor[MAX_LIGHTS];

// Diffuse light from every spot light reaching this point.
vec3 spotLights(vec3 worldPos, vec3 n) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;

    vec3 toLight = u_lightPos[i].xyz - worldPos;
    float dist = length(toLight);
    float range = u_lightPos[i].w;
    if (dist >= range) continue;

    vec3 l = toLight / dist;
    float cone = smoothstep(u_lightDir[i].w, u_lightColor[i].w, dot(-l, u_lightDir[i].xyz));
    // Inverse square, windowed so it reaches exactly zero at the range.
    float window = clamp(1.0 - pow(dist / range, 4.0), 0.0, 1.0);
    float falloff = window * window / (dist * dist + 1.0);

    total += u_lightColor[i].rgb * max(dot(n, l), 0.0) * cone * falloff;
  }
  return total;
}
