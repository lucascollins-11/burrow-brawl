import * as THREE from "three";

/** Triplanar toy-clay: procedural fine grain (no textures), blended by normal, with soft wrap lighting. */
export function makeClayMaterial(color: number = 0xd9a066): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSun: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uScale: { value: 0.35 },
    },
    vertexShader: `
      varying vec3 vPos; varying vec3 vNormal;
      void main() { vPos = position; vNormal = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uSun; uniform float uScale;
      varying vec3 vPos; varying vec3 vNormal;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float grain(vec2 p) { return vn(p) * 0.6 + vn(p * 2.3) * 0.4; }
      void main() {
        vec3 n = normalize(vNormal);
        vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
        vec3 p = vPos * uScale * 4.0;
        float g = grain(p.zy) * w.x + grain(p.xz) * w.y + grain(p.xy) * w.z;
        float wrap = clamp((dot(n, uSun) + 0.5) / 1.5, 0.0, 1.0);
        float top = smoothstep(0.55, 0.95, n.y);
        vec3 base = mix(uColor * 0.82, uColor * 1.08, top);
        vec3 col = base * (0.88 + 0.24 * g) * (0.45 + 0.75 * wrap);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
