#define MAX_LIGHTS 32

uniform int u_lightCount;
// xyz pozice, w dosah v metrech.
uniform vec4 u_lightPos[MAX_LIGHTS];
// xyz osa kužele, w kosinus vnějšího poloúhlu.
uniform vec4 u_lightDir[MAX_LIGHTS];
// rgb barva krát intenzita, w kosinus vnitřního poloúhlu.
uniform vec4 u_lightColor[MAX_LIGHTS];

// Difúzní světlo ze všech spot lightů, které dosahují do tohoto bodu.
vec3 spotLights(vec3 worldPos, vec3 n) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;

    vec3 toLight = u_lightPos[i].xyz - worldPos;
    float range = u_lightPos[i].w;
    // Kvadrát vzdálenosti, aby vzdálená světla nestála odmocninu.
    float d2 = dot(toLight, toLight);
    float r2 = d2 / (range * range);
    if (r2 >= 1.0) continue;

    vec3 l = toLight * inversesqrt(d2);
    float facing = dot(n, l);
    if (facing <= 0.0) continue;
    float cone = smoothstep(u_lightDir[i].w, u_lightColor[i].w, dot(-l, u_lightDir[i].xyz));
    if (cone <= 0.0) continue;

    // Inverzní kvadrát s oknem, aby na hranici dosahu klesl přesně na nulu.
    float window = 1.0 - r2 * r2;
    float falloff = window * window / (d2 + 1.0);

    total += u_lightColor[i].rgb * facing * cone * falloff;
  }
  return total;
}
