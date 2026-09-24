#version 300 es

in vec3 a_position;

uniform mat4 u_viewProjNoTranslate;

out vec3 v_dir;

void main() {
  v_dir = a_position;

  // xyww forces w/w == 1.0 after the perspective divide, parking every skybox
  // fragment at the far plane so it only fills pixels nothing else wrote.
  vec4 clip = u_viewProjNoTranslate * vec4(a_position, 1.0);
  gl_Position = clip.xyww;
}
