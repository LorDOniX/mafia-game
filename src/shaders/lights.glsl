// CLUSTERS_X/Y/Z a INDEX_WIDTH doplní withLights() z lights.ts.

// Řádek 0: xyz pozice, w dosah; řádek 1: osa kužele, w cos vnějšího poloúhlu;
// řádek 2: barva krát intenzita, w cos vnitřního poloúhlu. Sloupec = světlo.
uniform highp sampler2D u_lightData;
// Pro každý cluster (x = dlaždice, y = hloubkový řez) začátek a počet jeho světel.
uniform highp sampler2D u_lightClusters;
// Indexy světel všech clusterů za sebou, po INDEX_WIDTH na řádek.
uniform highp sampler2D u_lightIndices;
// Třetí řádek view matice: hloubka fragmentu = -(dot(xyz, worldPos) + w).
uniform vec4 u_clusterDepth;
// x, y = 1 / velikost viewportu; z, w = měřítko a posun log(hloubky) na index řezu.
uniform vec4 u_clusterParams;

// Difúzní světlo ze spot lightů, které CPU přiřadilo clusteru tohoto fragmentu.
vec3 spotLights(vec3 worldPos, vec3 n) {
  float depth = -(dot(u_clusterDepth.xyz, worldPos) + u_clusterDepth.w);
  int slice = int(floor(log(max(depth, 1e-4)) * u_clusterParams.z + u_clusterParams.w));
  if (slice >= CLUSTERS_Z) return vec3(0.0);

  ivec2 tile = ivec2(gl_FragCoord.xy * u_clusterParams.xy * vec2(CLUSTERS_X, CLUSTERS_Y));
  tile = clamp(tile, ivec2(0), ivec2(CLUSTERS_X - 1, CLUSTERS_Y - 1));
  ivec2 cell = ivec2(tile.y * CLUSTERS_X + tile.x, max(slice, 0));
  vec2 cluster = texelFetch(u_lightClusters, cell, 0).xy;
  int offset = int(cluster.x);
  int count = int(cluster.y);

  vec3 total = vec3(0.0);
  for (int k = 0; k < count; k++) {
    int at = offset + k;
    int i = int(texelFetch(u_lightIndices, ivec2(at % INDEX_WIDTH, at / INDEX_WIDTH), 0).r);
    vec4 position = texelFetch(u_lightData, ivec2(i, 0), 0);

    vec3 toLight = position.xyz - worldPos;
    // Kvadrát vzdálenosti, aby světla mimo dosah nestála odmocninu.
    float d2 = dot(toLight, toLight);
    float r2 = d2 / (position.w * position.w);
    if (r2 >= 1.0) continue;

    vec3 l = toLight * inversesqrt(d2);
    float facing = dot(n, l);
    if (facing <= 0.0) continue;
    vec4 axis = texelFetch(u_lightData, ivec2(i, 1), 0);
    vec4 color = texelFetch(u_lightData, ivec2(i, 2), 0);
    float cone = smoothstep(axis.w, color.w, dot(-l, axis.xyz));
    if (cone <= 0.0) continue;

    // Inverzní kvadrát s oknem, aby na hranici dosahu klesl přesně na nulu.
    float window = 1.0 - r2 * r2;
    float falloff = window * window / (d2 + 1.0);

    total += color.rgb * facing * cone * falloff;
  }
  return total;
}
