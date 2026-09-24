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
/** Scales normal-map strength; 0 falls back to the flat geometric normal. */
uniform float u_normalStrength;

out vec4 outColor;

void main() {
  vec3 albedo = texture(u_atlas, vec3(v_uv, v_layer)).rgb * v_tint;

  vec3 geometric = normalize(v_normal);

  // Tangent-space normal map. The bitangent is rebuilt here rather than passed
  // per vertex; the handedness sign is all that cannot be recovered.
  vec3 tangent = normalize(v_tangent.xyz);
  vec3 bitangent = cross(geometric, tangent) * v_tangent.w;
  vec3 sampled = texture(u_normals, vec3(v_uv, v_layer)).xyz * 2.0 - 1.0;

  // Flattening xy toward zero eases the effect off without renormalising the
  // map itself, so one uniform can dial it down globally.
  sampled.xy *= u_normalStrength;
  vec3 n = normalize(mat3(tangent, bitangent, geometric) * sampled);

  float sun = max(dot(n, u_sunDir), 0.0);
  // Cheap sky bounce: up-facing surfaces collect more ambient than down-facing.
  float sky = 0.5 + 0.5 * n.y;

  vec3 lit = albedo * (u_ambient * sky + u_sunColor * sun);

  // Exponential-squared fog, tuned to match the skybox horizon so the city
  // dissolves into the sky instead of ending at a hard edge.
  //
  // Distance is measured per fragment rather than interpolated from the
  // vertices: the roadway is a single map-sized quad, so vertex distances are
  // hundreds of metres even directly under the camera.
  float dist = distance(v_worldPos, u_cameraPos);
  float fog = 1.0 - exp(-pow(dist * u_fogDensity, 2.0));

  outColor = vec4(mix(lit, u_fogColor, fog), 1.0);
}
