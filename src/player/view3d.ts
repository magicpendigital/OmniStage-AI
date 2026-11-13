/**
 * Phase 7 — 3D view of the OmniStage Player: plain Three.js (no React) so exports stay small.
 * Game rules, contacts and the logic graph are the shared runtime (src/runtime). Phase 7B: every visual is built by the
 * same framework-free builders the studio viewport uses (src/render3d): lighting rig, shader sky, terrain, planar-reflection
 * water, clouds, GPU weather / VFX / bursts, scatter props, procedural composite actors and their motion. This file only
 * adds what the studio gets from R3F/drei: GLB loading + skeletal clips, HDRI, camera modes and the frame loop.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { easedSplineProgress } from '../animation/easing';
import { findLogicContacts, RuntimeLogicGraph } from '../runtime/logicGraph';
import { runtimeStore } from '../runtime/host';
import { buildCompositeActor } from '../render3d/compositeActors';
import { actorBadgeText, actorInTimeline, actorMotion, damp } from '../render3d/actorMotion';
import { disposeObject } from '../render3d/h';
import { createWorld } from '../render3d/world3d';
import { trackLoad } from './loading';
import { clickRunsBuiltIn } from '../runtime/gameSlice';
import { matchClipName, performedActor, resolveShot } from '../runtime/cinematics';
import { createContactShadows } from '../render3d/contactShadows';
import { createBloom, PostFx } from '../render3d/postfx';
import { applyBackgroundAndFog, applyStudioEnvironment, configureRenderer, createAmbientDust, createGroundGrid, createLightingRig, createPedestal } from '../render3d/stage3d';
import { createActorBadge, createBurst, createVfx } from '../render3d/vfx3d';
import type { Built3D, FrameContext } from '../render3d/types';
import type { ActorNode, SceneSpec, VFXNode } from '../types/scene.schema';
import type { InputManager } from './input';

/** low = phones (DPR 1, no shadows, cheap water); high = default; ultra = high + bloom (studio "Ultra"). */
export type QualityLevel = 'low' | 'high' | 'ultra';

interface ActorView {
  root: THREE.Group;
  anim: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  activeClip?: string;
  modelKey: string;
  hasRig: boolean;
  /** Procedural composite currently shown (rebuilt when unbox taps change). */
  composite?: THREE.Object3D;
  compositeKey?: string;
  badge?: Built3D<THREE.Sprite>;
  badgeText?: string;
  clickPulse: number;
}

const compositeKeyFor = (a: ActorNode, taps: number) => [a.assetId, a.primaryColor, a.secondaryColor, a.metalness, a.roughness, taps].join('|');

const gltfCache = new Map<string, Promise<THREE.Group & { animations?: THREE.AnimationClip[] }>>();

function loadGltf(url: string) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      trackLoad(new GLTFLoader().loadAsync(url)).then((g) => {
        (g.scene as any).animations = g.animations;
        return g.scene as any;
      })
    );
  }
  return gltfCache.get(url)!;
}


export class View3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400);
  private camTarget = new THREE.Vector3(0, 1, 0);
  private world = new THREE.Group();
  private actorsGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private actors = new Map<string, ActorView>();
  private vfx = new Map<string, { built: ReturnType<typeof createVfx>; key: VFXNode }>();
  private bursts = new Map<string, ReturnType<typeof createBurst>>();
  private worldParts: Built3D[] = [];
  private disposeEnv?: () => void;
  private hdriTexture?: THREE.Texture;
  private quality: QualityLevel;
  private sceneId = '';
  private worldKey = '';
  private lastHit: Record<string, number> = {};
  private raycaster = new THREE.Raycaster();
  private curves: { pos: THREE.CatmullRomCurve3; target: THREE.CatmullRomCurve3 } | null = null;
  private clock = 0;
  private ro: ResizeObserver;
  private bloom?: PostFx;

  constructor(private parent: HTMLElement, private runtime: RuntimeLogicGraph, private input: InputManager, private resolveUrl: (url: string) => string, quality: QualityLevel) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality !== 'low' ? 2 : 1));
    this.renderer.shadowMap.enabled = quality !== 'low';
    configureRenderer(this.renderer);
    this.quality = quality;
    this.disposeEnv = applyStudioEnvironment(this.renderer, this.scene);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'omni-stage omni-stage-3d';
    parent.appendChild(this.canvas);
    if (quality === 'ultra') this.bloom = createBloom(this.renderer, this.scene, this.camera);
    this.scene.add(this.world, this.actorsGroup, this.fxGroup);
    this.canvas.addEventListener('pointerdown', this.onPointer);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
  }

  /** Phase 10A: live actor poses + camera (E2E tests / debugging). */
  inspect() {
    const actors: Record<string, { position: number[]; yaw: number; clip?: string }> = {};
    for (const [id, v] of this.actors) actors[id] = { position: v.root.position.toArray(), yaw: v.root.rotation.y, clip: v.activeClip };
    // Phase 10B: named world parts (water landmarks, scatter layers) for E2E checks.
    const world: string[] = [];
    this.world.traverse((o) => {
      if (/^(WaterFeature|ScatterLayer)-/.test(o.name)) world.push(o.name);
    });
    return { actors, camera: { position: this.camera.position.toArray(), fov: this.camera.fov }, world };
  }

  private resize() {
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloom?.setSize(w, h, this.renderer.getPixelRatio());
  }

  // ---------------------------------------------------------------- world
  private buildWorld(spec: SceneSpec) {
    for (const part of this.worldParts) part.dispose();
    this.worldParts = [];
    this.world.clear();
    const env = spec.environment;
    applyBackgroundAndFog(this.scene, env, spec.world);
    const parts: Built3D[] = [createLightingRig(env, this.renderer.shadowMap.enabled)];
    if (env.reflectivePedestal) parts.push(createPedestal(env));
    if (env.groundGrid) parts.push(createGroundGrid(env));
    parts.push(createAmbientDust(env));
    if (this.quality !== 'low') parts.push(createContactShadows({ scale: 16, far: 5, opacity: 0.55, blur: 2 }));
    const w = spec.world;
    const hdri = w?.hdri?.url ? w.hdri : undefined;
    if (w) parts.push(createWorld(w, { quality: this.quality === 'low' ? 'low' : 'high', reflectionSize: this.quality !== 'low' ? 512 : 256, hdriBackground: Boolean(hdri?.showBackground) }));
    for (const part of parts) this.world.add(part.object);
    this.worldParts = parts;
    this.loadHdri(hdri);
  }

  /** HDRI image lighting (studio uses drei <Environment>); embedded as a data URI when it fits the budget. */
  private loadHdri(hdri: { url: string; intensity?: number; showBackground?: boolean } | undefined) {
    this.hdriTexture?.dispose();
    this.hdriTexture = undefined;
    if (!hdri) return;
    const sceneId = this.sceneId;
    trackLoad(new RGBELoader().loadAsync(this.resolveUrl(hdri.url))).then((tex) => {
      if (this.sceneId !== sceneId) return tex.dispose();
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.hdriTexture = tex;
      this.scene.environment = tex;
      this.scene.environmentIntensity = hdri.intensity ?? 1;
      if (hdri.showBackground) {
        this.scene.background = tex;
        this.scene.backgroundIntensity = hdri.intensity ?? 1;
      }
    }).catch(() => undefined); // offline without the HDRI: keep the studio room environment
  }

  // ---------------------------------------------------------------- actors
  private syncActors(spec: SceneSpec, time: number, dt: number) {
    const live = new Set<string>();
    const taps = runtimeStore.getState().unboxTapCounts || {};
    for (const baseActor of spec.actors) {
      // Phase 10A: performance (walk paths, clip changes, facing) — same maths as the studio.
      const actor = performedActor(baseActor, spec, time);
      live.add(actor.id);
      const url = actor.customGlbUrl || actor.modelUrl || ASSET_REGISTRY[actor.assetId]?.modelUrl;
      const modelKey = url || 'composite';
      let view = this.actors.get(actor.id);
      if (view && view.modelKey !== modelKey) {
        this.removeActor(actor.id);
        view = undefined;
      }
      const tapCount = taps[actor.id] || 0;
      if (!view) {
        const root = new THREE.Group();
        const anim = new THREE.Group();
        root.add(anim);
        root.userData.actorId = actor.id;
        view = { root, anim, modelKey, hasRig: false, clickPulse: 0 };
        this.actors.set(actor.id, view);
        this.actorsGroup.add(root);
        if (url) {
          const target = view;
          loadGltf(this.resolveUrl(url))
            .then((source) => {
              if (this.actors.get(actor.id) !== target) return;
              const model = SkeletonUtils.clone(source) as THREE.Object3D;
              model.traverse((o) => {
                if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
              });
              this.setComposite(target, undefined);
              const entry = ASSET_REGISTRY[actor.assetId];
              model.scale.setScalar(entry?.defaultScale ?? 1);
              anim.add(model);
              target.hasRig = true;
              const clips: THREE.AnimationClip[] = (source as any).animations || [];
              if (clips.length) {
                target.mixer = new THREE.AnimationMixer(model);
                target.actions = new Map(clips.map((c) => [c.name, target.mixer!.clipAction(c)]));
              }
            })
            .catch(() => undefined); // keep the procedural composite when a model can't load offline
        }
      }
      // Procedural composite (studio fallback mesh) until / unless a GLB is shown; rebuilt when unbox taps change.
      if (!view.hasRig) {
        const key = compositeKeyFor(actor, tapCount);
        if (key !== view.compositeKey) {
          this.setComposite(view, buildCompositeActor(actor, tapCount));
          view.compositeKey = key;
        }
      }
      // Badge above the gift box ("TAP TO UNBOX (n/3)") — same sprite as the studio.
      const badgeText = actor.assetId === 'mystery-gift-box' ? actorBadgeText(actor, tapCount) : undefined;
      if (badgeText !== view.badgeText) {
        if (view.badge) { view.root.remove(view.badge.object); view.badge.dispose(); view.badge = undefined; }
        if (badgeText) {
          view.badge = createActorBadge(badgeText);
          view.badge.object.position.set(0, 2.75, 0);
          view.root.add(view.badge.object);
        }
        view.badgeText = badgeText;
      }
      view.root.visible = actorInTimeline(actor, spec.mode, time);
      view.root.position.set(...actor.position);
      view.root.rotation.set(...actor.rotation);
      view.root.scale.set(...actor.scale);
      // Skeletal clip
      if (view.mixer && view.actions) {
        const name = matchClipName(actor.activeClip || (actor.activeAnimation !== 'idle' ? actor.activeAnimation : undefined), [...view.actions.keys()]);
        if (name && name !== view.activeClip) {
          const next = view.actions.get(name)!;
          const prev = view.activeClip ? view.actions.get(view.activeClip) : undefined;
          next.reset().fadeIn(0.3).play();
          prev?.fadeOut(0.3);
          view.activeClip = name;
        }
        view.mixer.timeScale = actor.animationSpeed ?? 1;
      }
      // Procedural motion + click pulse: the studio ActorRenderer's exact maths (src/render3d/actorMotion).
      const motion = actorMotion(actor, spec.mode, time, view.hasRig, view.clickPulse, this.clock);
      view.clickPulse = Math.max(0, view.clickPulse - dt * 3);
      const a = view.anim;
      a.position.set(damp(a.position.x, motion.offset[0], 10, dt), damp(a.position.y, motion.offset[1], 10, dt), damp(a.position.z, motion.offset[2], 10, dt));
      a.rotation.set(damp(a.rotation.x, motion.rotation[0], 10, dt), damp(a.rotation.y, motion.rotation[1], 10, dt), damp(a.rotation.z, motion.rotation[2], 10, dt));
      a.scale.setScalar(damp(a.scale.x, motion.scale, 10, dt));
    }
    for (const id of [...this.actors.keys()]) if (!live.has(id)) this.removeActor(id);
  }

  private setComposite(view: ActorView, next: THREE.Object3D | undefined) {
    if (view.composite) {
      view.anim.remove(view.composite);
      disposeObject(view.composite);
    }
    view.composite = next;
    if (next) {
      next.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      view.anim.add(next);
    }
  }

  private removeActor(id: string) {
    const view = this.actors.get(id);
    if (!view) return;
    this.actorsGroup.remove(view.root);
    this.setComposite(view, undefined);
    view.badge?.dispose();
    view.mixer?.stopAllAction();
    this.actors.delete(id);
  }

  // ---------------------------------------------------------------- vfx
  private syncVfx(nodes: VFXNode[], spec: SceneSpec, ctx: FrameContext, playing: boolean) {
    const live = new Set<string>();
    for (const v of nodes) {
      live.add(v.id);
      let entry = this.vfx.get(v.id);
      if (entry && entry.key !== v) {
        this.fxGroup.remove(entry.built.object);
        entry.built.dispose();
        entry = undefined;
      }
      if (!entry) {
        entry = { built: createVfx(v), key: v };
        this.vfx.set(v.id, entry);
        this.fxGroup.add(entry.built.object);
      }
      const inWindow = spec.mode === 'game' || ((v.startTime === undefined || ctx.time >= v.startTime) && (v.endTime === undefined || ctx.time <= v.endTime));
      entry.built.object.visible = v.visible !== false && inWindow;
      entry.built.setPlaying(playing);
      entry.built.update?.(ctx);
    }
    for (const [id, entry] of this.vfx) {
      if (live.has(id)) continue;
      this.fxGroup.remove(entry.built.object);
      entry.built.dispose();
      this.vfx.delete(id);
    }
  }

  private syncBursts(bursts: Array<{ id: string; position: [number, number, number]; color: string; createdAt: number }>, ctx: FrameContext) {
    const live = new Set(bursts.map((b) => b.id));
    for (const b of bursts) {
      if (this.bursts.has(b.id)) continue;
      const built = createBurst(b);
      this.bursts.set(b.id, built);
      this.fxGroup.add(built.object);
    }
    for (const [id, built] of this.bursts) {
      if (!live.has(id) || built.done(ctx.nowMs)) {
        this.fxGroup.remove(built.object);
        built.dispose();
        this.bursts.delete(id);
        continue;
      }
      built.update?.(ctx);
    }
  }

  // ---------------------------------------------------------------- input / interaction
  private onPointer = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.actorsGroup.children, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.actorId) o = o.parent;
      if (!o?.visible) continue;
      const state = runtimeStore.getState();
      const actor = state.sceneSpec.actors.find((a) => a.id === o!.userData.actorId);
      if (!actor) return;
      const view = this.actors.get(actor.id);
      if (view) view.clickPulse = 1;
      if (!state.isPlaying) return;
      const graphHandled = this.runtime.emit('actor-click', { actorId: actor.id });
      if (clickRunsBuiltIn(actor, state.sceneSpec.mode, graphHandled)) runtimeStore.getState().triggerActorInteraction(actor);
      return;
    }
  };

  // ---------------------------------------------------------------- camera (mirrors SceneDirector)
  private updateCamera(spec: SceneSpec, time: number, initial: boolean) {
    const cam = spec.camera;
    // Phase 10A: shot list (same maths as the studio) — exact, so cuts are hard cuts.
    const shot = spec.mode === 'media' ? resolveShot(spec, time) : null;
    if (shot) {
      if (Math.abs(this.camera.fov - shot.fov) > 0.01) {
        this.camera.fov = shot.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.position.set(...shot.position);
      this.camTarget.set(...shot.target);
      this.camera.lookAt(this.camTarget);
      return;
    }
    if (Math.abs(this.camera.fov - (cam.fov || 45)) > 0.01) {
      this.camera.fov = cam.fov || 45;
      this.camera.updateProjectionMatrix();
    }
    const duration = Math.max(2, spec.durationSeconds || 8);
    const progress = Math.min(1, Math.max(0, time / duration));
    const pos = new THREE.Vector3(...cam.position);
    const target = new THREE.Vector3(...cam.target);
    const cinematic = spec.mode === 'media' || this.runtime.controlsCamera;
    const followId = cam.followActorId;
    const follow = spec.actors.find((a) => a.id === followId) || spec.actors.find((a) => a.physicsRole === 'player') || spec.actors[0];
    const mode = cam.mode;
    if ((mode === 'follow-target' || mode === 'first-person-follow') && follow) {
      pos.set(follow.position[0], follow.position[1] + 2.2, follow.position[2] + 3.8);
      target.set(follow.position[0], follow.position[1] + 1.2, follow.position[2]);
    } else if (mode === 'top-down-isometric' || mode === 'isometric-game') {
      pos.set(0, 6.2, 8.2);
      target.set(0, 0.9, 0);
    } else if (cinematic && mode === 'orbit-360') {
      const angle = progress * Math.PI * 2;
      pos.set(Math.sin(angle) * 6.2, 2.45, Math.cos(angle) * 6.2);
      target.set(0, 1.15, 0);
    } else if (cinematic && mode === 'dolly-zoom-in') {
      pos.set(Math.sin(progress * 0.8) * 1.1, THREE.MathUtils.lerp(2.7, 1.65, progress), THREE.MathUtils.lerp(6.8, 3.6, progress));
      target.set(0, 1.1, 0);
    } else if (cinematic && mode === 'crane-reveal') {
      pos.set(THREE.MathUtils.lerp(-2.6, 2.6, progress), THREE.MathUtils.lerp(0.85, 4.4, progress), 5.8);
      target.set(0, 1.3, 0);
    } else if (cinematic && mode === 'cinematic-flythrough' && cam.keyframes?.length >= 2) {
      if (!this.curves) {
        const sorted = [...cam.keyframes].sort((a, b) => a.time - b.time);
        this.curves = {
          pos: new THREE.CatmullRomCurve3(sorted.map((k) => new THREE.Vector3(...k.position))),
          target: new THREE.CatmullRomCurve3(sorted.map((k) => new THREE.Vector3(...k.target))),
        };
      }
      const u = easedSplineProgress(cam.keyframes, time);
      this.curves.pos.getPoint(u, pos);
      this.curves.target.getPoint(u, target);
    }
    if (initial) {
      this.camera.position.copy(pos);
      this.camTarget.copy(target);
    } else {
      this.camera.position.lerp(pos, 0.08);
      this.camTarget.lerp(target, 0.08);
    }
    this.camera.lookAt(this.camTarget);
  }

  // ---------------------------------------------------------------- frame
  frame(dt: number) {
    this.clock += dt;
    // Shared runtime: logic graph + timeline (advanceTimeline lives in the shared game slice).
    this.runtime.advance(dt);
    let state = runtimeStore.getState();
    const spec = state.sceneSpec;
    const sceneChanged = spec.id !== this.sceneId;
    if (sceneChanged) {
      this.sceneId = spec.id;
      this.curves = null;
      this.lastHit = {};
      for (const id of [...this.actors.keys()]) this.removeActor(id);
      for (const entry of this.vfx.values()) { this.fxGroup.remove(entry.built.object); entry.built.dispose(); }
      this.vfx.clear();
    }
    const worldKey = JSON.stringify([spec.id, spec.world, spec.environment]);
    if (worldKey !== this.worldKey) {
      this.worldKey = worldKey;
      this.buildWorld(spec);
    }

    // Game loop: WASD movement + contacts (same rules as the studio SceneDirector).
    if (spec.mode === 'game' && state.isPlaying && !state.gameEnded) {
      const keys = this.input.keys;
      const speed = 4.2 * dt;
      let dx = 0;
      let dz = 0;
      if (keys.has('w') || keys.has('arrowup')) dz -= speed;
      if (keys.has('s') || keys.has('arrowdown')) dz += speed;
      if (keys.has('a') || keys.has('arrowleft')) dx -= speed;
      if (keys.has('d') || keys.has('arrowright')) dx += speed;
      if (dx || dz) state.movePlayerActor(dx, dz);
    }
    state = runtimeStore.getState();
    if (state.isPlaying) {
      const live = state.sceneSpec;
      const pairs = findLogicContacts(live);
      const handled = this.runtime.collisions(pairs);
      const now = performance.now();
      for (const [id, otherId] of pairs) {
        if (handled.has(otherId) || !live.actors.some((a) => a.id === id && a.physicsRole === 'player')) continue;
        if (now - (this.lastHit[otherId] ?? -Infinity) > 450) {
          this.lastHit[otherId] = now;
          runtimeStore.getState().handlePlayerCollision(otherId);
        }
      }
    }

    state = runtimeStore.getState();
    const ctx: FrameContext = {
      time: state.currentTime,
      duration: Math.max(2, state.sceneSpec.durationSeconds || 8),
      nowMs: Date.now(),
      clock: this.clock,
      viewportHeight: this.renderer.domElement.height,
    };
    this.syncActors(state.sceneSpec, state.currentTime, dt);
    this.syncVfx(state.sceneSpec.vfx || [], state.sceneSpec, ctx, state.isPlaying);
    this.syncBursts(state.burstEffects as any, ctx);
    for (const view of this.actors.values()) view.mixer?.update(dt);
    for (const part of this.worldParts) part.update?.(ctx);
    this.updateCamera(state.sceneSpec, state.currentTime, sceneChanged);
    for (const part of this.worldParts) part.prerender?.(this.renderer, this.scene);
    if (this.bloom) this.bloom.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const part of this.worldParts) part.dispose();
    for (const id of [...this.actors.keys()]) this.removeActor(id);
    for (const entry of this.vfx.values()) entry.built.dispose();
    for (const b of this.bursts.values()) b.dispose();
    this.hdriTexture?.dispose();
    this.disposeEnv?.();
    this.bloom?.dispose();
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
