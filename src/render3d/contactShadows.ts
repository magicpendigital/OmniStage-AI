/**
 * Phase 7C — soft contact shadows as a framework-free builder (replaces drei's <ContactShadows> in the studio, and is
 * now also used by the OmniStage Player). Each frame `prerender` draws the scene's depth from below into a small
 * render target, blurs it twice, and a transparent ground plane shows the result.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import type { Built3D } from './types';

export interface ContactShadowOptions {
  /** World size of the square shadow area (metres). */
  scale?: number;
  /** How far above the ground objects still cast a shadow. */
  far?: number;
  opacity?: number;
  blur?: number;
  color?: THREE.ColorRepresentation;
  resolution?: number;
  y?: number;
}

export function createContactShadows(opts: ContactShadowOptions = {}): Built3D<THREE.Group> {
  const scale = opts.scale ?? 16;
  const far = opts.far ?? 5;
  const blur = opts.blur ?? 2;
  const res = opts.resolution ?? 512;

  const group = new THREE.Group();
  group.name = 'ContactShadows';
  group.position.y = opts.y ?? 0.012;

  const target = new THREE.WebGLRenderTarget(res, res);
  const targetBlur = new THREE.WebGLRenderTarget(res, res);
  target.texture.generateMipmaps = targetBlur.texture.generateMipmaps = false;

  // Camera under the ground looking up: image right = +x, image top = +z.
  const camera = new THREE.OrthographicCamera(-scale / 2, scale / 2, scale / 2, -scale / 2, 0, far);
  camera.rotation.x = Math.PI / 2;
  group.add(camera);

  const geometry = new THREE.PlaneGeometry(scale, scale).rotateX(-Math.PI / 2);
  // rotateX(-90°) puts v=1 at -z; the shadow image has its top at +z, so flip v.
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const material = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, opacity: opts.opacity ?? 0.55, depthWrite: false });
  const plane = new THREE.Mesh(geometry, material);
  plane.renderOrder = 1;
  group.add(plane);

  // Depth → dark colour with alpha falling off with height.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthTest: false, depthWrite: false });
  const shadowColor = new THREE.Color(opts.color ?? '#000000');
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.ucolor = { value: shadowColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 ucolor;\nvoid main() {')
      .replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );');
  };

  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  hBlur.depthTest = vBlur.depthTest = false;
  const quad = new FullScreenQuad(hBlur);
  const clearColor = new THREE.Color();

  const blurPass = (renderer: THREE.WebGLRenderer, amount: number) => {
    quad.material = hBlur;
    hBlur.uniforms.tDiffuse.value = target.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(targetBlur);
    quad.render(renderer);
    quad.material = vBlur;
    vBlur.uniforms.tDiffuse.value = targetBlur.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  return {
    object: group,
    prerender(renderer, scene) {
      if (!group.visible || !group.parent) return;
      const prevTarget = renderer.getRenderTarget();
      const prevBackground = scene.background;
      const prevOverride = scene.overrideMaterial;
      const prevAlpha = renderer.getClearAlpha();
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      renderer.getClearColor(clearColor);
      group.visible = false;
      scene.background = null;
      scene.overrideMaterial = depthMaterial;
      renderer.shadowMap.autoUpdate = false;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      blurPass(renderer, blur);
      blurPass(renderer, blur * 0.4);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(clearColor, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
      group.visible = true;
    },
    dispose() {
      target.dispose();
      targetBlur.dispose();
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      hBlur.dispose();
      vBlur.dispose();
      quad.dispose();
    },
  };
}
