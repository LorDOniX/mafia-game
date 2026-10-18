#version 300 es

in vec3 a_position;

uniform mat4 u_viewProjNoTranslate;

out vec3 v_dir;

void main() {
  v_dir = a_position;

  // xyww vynutí w/w == 1.0 po perspektivním dělení, čímž umístí každý fragment
  // skyboxu na vzdálenou rovinu, takže vyplní jen pixely, kam nic jiného nezapsalo.
  vec4 clip = u_viewProjNoTranslate * vec4(a_position, 1.0);
  gl_Position = clip.xyww;
}
