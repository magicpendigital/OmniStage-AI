import * as THREE from 'three';

export const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    // Remove camera translation: the sky stays at infinity, including in reflections.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = clip.xyww;
  }
`;

export const skyFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uDuration;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform float uSunStrength;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float cycle = 0.5 - 0.5 * cos(uTime / max(uDuration, 2.0) * 6.283185);
    float elevation = pow(max(direction.y, 0.0), 0.45);
    vec3 horizon = mix(uHorizon, uHorizon * vec3(1.16, 0.82, 0.78), cycle * 0.55);
    vec3 zenith = mix(uZenith, uZenith * vec3(0.72, 0.78, 1.15), cycle * 0.65);
    vec3 color = mix(horizon, zenith, elevation);
    float solar = max(dot(direction, normalize(uSun)), 0.0);
    color += vec3(1.0, 0.65, 0.32) * pow(solar, 18.0) * 0.35 * uSunStrength;
    color += vec3(1.0, 0.9, 0.68) * smoothstep(0.9993, 0.9998, solar) * 2.0 * uSunStrength;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Reflector supplies the projected scene texture; waves and lighting run on GPU. */
export const waterShader = {
  name: 'OmniStageReflectiveWater',
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { color: { value: new THREE.Color('#075d77') }, tDiffuse: { value: null },
      textureMatrix: { value: new THREE.Matrix4() }, uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(18, 24, 14).normalize() },
      uSunColor: { value: new THREE.Color('#fff4d6') } },
  ]),
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vReflection;
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vReflection = textureMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 color;
    uniform float uTime;
    uniform vec3 uSun;
    uniform vec3 uSunColor;
    varying vec4 vReflection;
    varying vec3 vWorld;
    #include <fog_pars_fragment>
    void main() {
      vec2 p = vWorld.xz;
      float a = dot(p, vec2(0.75, 0.42)) + uTime * 1.15;
      float b = dot(p, vec2(-0.38, 1.12)) - uTime * 0.85;
      float c = dot(p, vec2(2.3, 1.7)) + uTime * 1.8;
      vec2 slope = vec2(0.75, 0.42) * cos(a) * 0.08
        + vec2(-0.38, 1.12) * cos(b) * 0.045
        + vec2(2.3, 1.7) * cos(c) * 0.012;
      vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
      vec3 eye = normalize(cameraPosition - vWorld);
      float fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(eye, normal), 0.0), 5.0);
      vec2 uv = vReflection.xy / vReflection.w + slope * 0.018;
      vec3 reflection = texture2D(tDiffuse, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
      float specular = pow(max(dot(reflect(-uSun, normal), eye), 0.0), 180.0);
      float ripple = 0.5 + 0.5 * sin(a) * sin(b);
      vec3 body = color * (0.75 + 0.25 * ripple);
      vec3 outgoing = mix(body, reflection, 0.2 + fresnel * 0.8) + specular * uSunColor * 1.4;
      gl_FragColor = vec4(outgoing, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};
