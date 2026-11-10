/**
 * Phase 7B — 3D VFX nodes, collision bursts and canvas badge sprites as plain Three.js, shared by the studio
 * (VFXRenderer.tsx / ActorRenderer.tsx wrappers) and the OmniStage Player.
 */
import * as THREE from 'three';
import type { VFXNode } from '../types/scene.schema';
import { createGpuParticles } from './gpuParticles';
import type { Built3D, FrameContext } from './types';

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function spriteFrom(tex: THREE.Texture, scale: [number, number]): Built3D<THREE.Sprite> {
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale[0], scale[1], 1);
  sprite.renderOrder = 10;
  return { object: sprite, dispose: () => { tex.dispose(); material.dispose(); } };
}

/** Small mono badge above an actor (selection info / "TAP TO UNBOX"). */
export function createActorBadge(text: string, borderColor = '#06B6D4', textColor = '#67E8F9') {
  const tex = canvasTexture(512, 72, (ctx) => {
    ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(6, 6, 500, 60, 14);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 22px "JetBrains Mono", monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 38), 256, 37);
  });
  return spriteFrom(tex, [2.6, 0.36]);
}

/** Marketing call-out badge (`floating-3d-badge` VFX). */
export function createPromoBadge(labelText: string, accentColor: string) {
  const tex = canvasTexture(640, 96, (ctx) => {
    ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
    ctx.strokeStyle = accentColor || '#F59E0B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(8, 8, 624, 80, 18);
    ctx.fill();
    ctx.stroke();
    ctx.font = '800 28px "Space Grotesk", Inter, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ ${labelText.toUpperCase()}`.slice(0, 34), 320, 50);
  });
  return spriteFrom(tex, [3.4, 0.52]);
}

function ringMesh(inner: number, outer: number, color: string, opacity: number) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o: any) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });
}

/** A SceneSpec VFX node. `update` animates it from the timeline (only while `playing`). */
export function createVfx(vfx: VFXNode): Built3D & { setPlaying(playing: boolean): void } {
  const group = new THREE.Group();
  group.name = `VFX-${vfx.id}`;
  group.position.set(vfx.position[0], vfx.type === 'shockwave' ? Math.max(0.03, vfx.position[1]) : vfx.position[1], vfx.position[2]);
  const color = vfx.color || '#38BDF8';
  const children: Built3D[] = [];
  let animate: ((t: number) => void) | undefined;
  let playing = true;

  switch (vfx.type) {
    case 'sparkles':
      children.push(createGpuParticles({ kind: 'sparkles', count: 96, spread: 3.6, scale: vfx.scale ?? 1,
        size: 0.09 * Math.max(0, vfx.intensity ?? 1), color: vfx.color || '#38BDF8', startTime: vfx.startTime }));
      break;
    case 'confetti':
      children.push(createGpuParticles({ kind: 'confetti', count: Math.floor(160 * Math.max(0, vfx.intensity ?? 1)),
        spread: 3.6, scale: vfx.scale ?? 1, size: 0.22, color: vfx.color || '#fbbf24', startTime: vfx.startTime }));
      break;
    case 'shockwave': {
      const r1 = ringMesh(0.7, 0.85, color, 0.75);
      const r2 = ringMesh(0.7, 0.82, color, 0.5);
      group.add(r1, r2);
      animate = (t) => {
        const s = vfx.scale ?? 1;
        const p1 = (t * 0.85) % 1;
        const p2 = (t * 0.85 + 0.5) % 1;
        r1.scale.set(0.5 + p1 * 3.2 * s, 0.5 + p1 * 3.2 * s, 1);
        r2.scale.set(0.5 + p2 * 3.2 * s, 0.5 + p2 * 3.2 * s, 1);
        (r1.material as THREE.MeshBasicMaterial).opacity = (1 - p1) * 0.85;
        (r2.material as THREE.MeshBasicMaterial).opacity = (1 - p2) * 0.7;
      };
      break;
    }
    case 'laser-beam': {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.28, 6.4, 24, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.y = 3.2;
      const light = new THREE.PointLight(color, 2.5, 6);
      light.position.y = 1.5;
      group.add(beam, light);
      animate = (t) => {
        const pulse = 0.85 + Math.sin(t * 6) * 0.25;
        beam.scale.set(pulse, 1, pulse);
      };
      break;
    }
    case 'floating-3d-badge':
      children.push(createPromoBadge(vfx.labelText || 'LIMITED DROP · 50% OFF', vfx.color || '#F59E0B'));
      break;
    default:
      break;
  }
  for (const c of children) group.add(c.object);

  return {
    object: group,
    setPlaying(p: boolean) { playing = p; },
    update(ctx: FrameContext) {
      for (const c of children) c.update?.(ctx);
      if (playing && animate) animate(Math.max(0, ctx.time - (vfx.startTime ?? 0)) * (vfx.intensity ?? 1));
    },
    dispose() {
      for (const c of children) c.dispose();
      disposeTree(group);
    },
  };
}

/** Transient pickup / collision burst: GPU sparks + expanding ring, 600 ms lifetime from `createdAt`. */
export function createBurst(burst: { position: [number, number, number]; color: string; createdAt: number }): Built3D & { done(nowMs: number): boolean } {
  const group = new THREE.Group();
  group.position.set(...burst.position);
  const sparks = createGpuParticles({ kind: 'burst', count: 72, size: 0.13, spread: 1, color: burst.color, createdAt: burst.createdAt });
  const ring = ringMesh(0.45, 0.65, burst.color, 0.9);
  ring.position.y = 0.15;
  group.add(sparks.object, ring);
  return {
    object: group,
    done: (nowMs) => (nowMs - burst.createdAt) / 600 > 1,
    update(ctx) {
      sparks.update?.(ctx);
      const age = (ctx.nowMs - burst.createdAt) / 600;
      ring.visible = age <= 1;
      const s = 0.4 + Math.max(0, age) * 2.6;
      ring.scale.set(s, s, 1);
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - age) * 0.9);
    },
    dispose() {
      sparks.dispose();
      disposeTree(ring);
    },
  };
}
