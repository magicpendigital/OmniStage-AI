/**
 * Phase 7 — 3D view of the OmniStage Player: plain Three.js (no React) so exports stay small.
 * Game rules, contacts and the logic graph are the shared runtime (src/runtime); this file only renders:
 * world (sky gradient, terrain height field, water, scatter, weather), actors (GLB with skeletal clips via
 * AnimationMixer, or a procedural stand-in per asset category), camera modes, VFX and burst effects.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { easedSplineProgress } from '../animation/easing';
import { findLogicContacts, RuntimeLogicGraph } from '../runtime/logicGraph';
import { runtimeStore } from '../runtime/host';
import { computeTerrainHeight, SKY_PALETTES } from '../runtime/world';
import type { ActorNode, SceneSpec, VFXNode } from '../types/scene.schema';
import type { InputManager } from './input';

export type QualityLevel = 'low' | 'high';

interface ActorView {
  root: THREE.Group;
  anim: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  activeClip?: string;
  modelKey: string;
}

const gltfCache = new Map<string, Promise<THREE.Group & { animations?: THREE.AnimationClip[] }>>();

function loadGltf(url: string) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      new GLTFLoader().loadAsync(url).then((g) => {
        (g.scene as any).animations = g.animations;
        return g.scene as any;
      })
    );
  }
  return gltfCache.get(url)!;
}

function skyTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(2,6,23,0.8)';
  ctx.beginPath();
  ctx.roundRect(8, 16, 496, 96, 40);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '800 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 22), 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

/** Procedural stand-in when an actor has no GLB: shape by registry category, coloured like the studio asset. */
function proceduralActor(actor: ActorNode): THREE.Object3D {
  const entry = ASSET_REGISTRY[actor.assetId];
  const box = entry?.boundingBox || { width: 1, height: 1.6, depth: 1 };
  const mat = new THREE.MeshStandardMaterial({
    color: actor.primaryColor || entry?.defaultPrimaryColor || '#22D3EE',
    metalness: actor.metalness ?? entry?.defaultMetalness ?? 0.3,
    roughness: actor.roughness ?? entry?.defaultRoughness ?? 0.45,
  });
  const accent = new THREE.MeshStandardMaterial({ color: actor.secondaryColor || entry?.defaultSecondaryColor || '#0F172A', metalness: 0.4, roughness: 0.5 });
  const g = new THREE.Group();
  const role = actor.physicsRole;
  const category = entry?.category;
  if (role === 'collectible' || category === 'collectible') {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(0.25, box.width * 0.45), 0), mat);
    gem.position.y = Math.max(0.5, box.height * 0.6);
    g.add(gem);
  } else if (role === 'hazard') {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(box.width * 0.5, box.height, 6), mat);
    spike.position.y = box.height / 2;
    g.add(spike);
  } else if (category === 'character' || category === 'gltf-rigged' || role === 'player') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(box.width * 0.32, box.height * 0.45, 6, 12), mat);
    body.position.y = box.height * 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(box.width * 0.27, 20, 16), mat);
    head.position.y = box.height * 0.88;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(box.width * 0.36, box.width * 0.12, box.width * 0.1), accent);
    visor.position.set(0, box.height * 0.9, box.width * 0.24);
    g.add(body, head, visor);
  } else if (category === 'vehicle') {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(box.width, box.height * 0.5, box.depth), mat);
    hull.position.y = box.height * 0.45;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(box.width * 0.6, box.height * 0.4, box.depth * 0.5), accent);
    cabin.position.y = box.height * 0.85;
    g.add(hull, cabin);
  } else if (category === 'environment-prop') {
    const prop = new THREE.Mesh(new THREE.DodecahedronGeometry(Math.max(box.width, box.depth) * 0.5, 0), mat);
    prop.position.y = box.height * 0.5;
    g.add(prop);
  } else {
    const product = new THREE.Mesh(new THREE.BoxGeometry(box.width, box.height, box.depth), mat);
    product.position.y = box.height / 2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(box.width * 0.7, box.width * 0.75, 0.12, 32), accent);
    base.position.y = 0.06;
    g.add(base, product);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return g;
}

function matchClip(wanted: string | undefined, names: string[]): string | undefined {
  if (!names.length) return undefined;
  if (!wanted) return names.find((n) => /idle/i.test(n)) || names[0];
  return names.find((n) => n === wanted) || names.find((n) => n.toLowerCase() === wanted.toLowerCase()) || names.find((n) => n.toLowerCase().includes(wanted.toLowerCase())) || names[0];
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
  private vfx = new Map<string, THREE.Object3D>();
  private bursts = new Map<string, { obj: THREE.Points; born: number }>();
  private weather?: THREE.Points;
  private sceneId = '';
  private worldKey = '';
  private lastHit: Record<string, number> = {};
  private raycaster = new THREE.Raycaster();
  private curves: { pos: THREE.CatmullRomCurve3; target: THREE.CatmullRomCurve3 } | null = null;
  private clock = 0;
  private ro: ResizeObserver;

  constructor(private parent: HTMLElement, private runtime: RuntimeLogicGraph, private input: InputManager, private resolveUrl: (url: string) => string, quality: QualityLevel) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'omni-stage omni-stage-3d';
    parent.appendChild(this.canvas);
    this.scene.add(this.world, this.actorsGroup, this.fxGroup);
    this.canvas.addEventListener('pointerdown', this.onPointer);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- world
  private buildWorld(spec: SceneSpec) {
    this.world.clear();
    const env = spec.environment;
    const w = spec.world;
    const palette = w ? SKY_PALETTES[w.skybox] : undefined;
    this.scene.background = palette ? skyTexture(palette[0], palette[1]) : new THREE.Color(env.backgroundColor || '#0B101B');
    this.scene.fog = env.fogFar > env.fogNear ? new THREE.Fog(env.fogColor || env.backgroundColor, env.fogNear, env.fogFar) : null;

    const hemi = new THREE.HemisphereLight(env.keyLightColor || '#FFFBEB', env.groundColor || '#0F172A', env.ambientIntensity ?? 0.75);
    const key = new THREE.DirectionalLight(env.keyLightColor || '#FFFBEB', env.keyLightIntensity ?? 2.2);
    key.position.set(...((w?.sunPosition as [number, number, number]) || [5.5, 8.5, 6]));
    key.castShadow = this.renderer.shadowMap.enabled;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight(env.rimLightColor || '#38BDF8', 1.1);
    rim.position.set(-6, 4, -6);
    this.world.add(hemi, key, rim);

    const terrain = w?.terrain;
    if (!terrain || terrain.type === 'none') {
      if (env.groundGrid) this.world.add(new THREE.GridHelper(40, 40, env.rimLightColor || '#06B6D4', '#1E293B'));
    } else {
      const geo = new THREE.PlaneGeometry(80, 80, 120, 120);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, computeTerrainHeight(terrain.type, pos.getX(i), pos.getZ(i), terrain.elevationScale ?? 1));
      geo.computeVertexNormals();
      const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: terrain.color || env.groundColor || '#1E293B', roughness: 0.92, metalness: 0.02, flatShading: (terrain.roughness ?? 0.5) > 0.6 }));
      ground.receiveShadow = true;
      this.world.add(ground);
      if ((terrain.waterLevel ?? 0) > 0 || terrain.type === 'ocean-island') {
        const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#0EA5E9', transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.3 }));
        water.rotation.x = -Math.PI / 2;
        water.position.y = terrain.waterLevel ?? 0.05;
        water.name = 'water';
        this.world.add(water);
      }
    }

    for (const layer of w?.scatterObjects || []) this.world.add(this.scatter(layer.type, layer.count, layer.spreadRadius, layer.scaleRange, layer.color, terrain?.type, terrain?.elevationScale ?? 1));

    this.weather = undefined;
    const weather = w?.weather;
    if (weather && weather.type !== 'clear' && weather.type !== 'foggy-mist') {
      const count = Math.round(600 + 2400 * Math.min(1, weather.intensity ?? 0.5));
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 40;
        positions[i * 3 + 1] = Math.random() * 18;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const color = weather.type === 'rain' ? '#93C5FD' : weather.type === 'snow' ? '#FFFFFF' : '#F97316';
      this.weather = new THREE.Points(g, new THREE.PointsMaterial({ color, size: weather.type === 'rain' ? 0.06 : 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
      this.weather.userData.kind = weather.type;
      this.world.add(this.weather);
    }
  }

  private scatter(type: string, count: number, radius: number, scaleRange: [number, number], color: string | undefined, terrainType: any, elevation: number) {
    const geometry =
      type === 'pine-trees' ? new THREE.ConeGeometry(0.6, 2.4, 7) :
      type === 'cyber-buildings' ? new THREE.BoxGeometry(1.2, 4, 1.2) :
      type === 'rocks-boulders' ? new THREE.DodecahedronGeometry(0.6, 0) :
      type === 'street-lights' ? new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6) :
      type === 'ancient-pillars' ? new THREE.CylinderGeometry(0.35, 0.4, 3, 10) :
      new THREE.OctahedronGeometry(0.5, 0);
    geometry.translate(0, type === 'rocks-boulders' ? 0.3 : (geometry as any).parameters?.height / 2 || 0.5, 0);
    const defaultColor = type === 'pine-trees' ? '#166534' : type === 'cyber-buildings' ? '#1E293B' : type === 'crystal-clusters' ? '#A78BFA' : '#64748B';
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: color || defaultColor, roughness: 0.8 }), Math.max(1, Math.min(600, count)));
    const m = new THREE.Matrix4();
    let seed = 1337;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < mesh.count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 7 + rand() * Math.max(2, radius - 7); // keep the play area clear
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = scaleRange[0] + rand() * (scaleRange[1] - scaleRange[0]);
      m.compose(new THREE.Vector3(x, computeTerrainHeight(terrainType, x, z, elevation), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------- actors
  private syncActors(spec: SceneSpec, time: number) {
    const live = new Set<string>();
    for (const actor of spec.actors) {
      live.add(actor.id);
      const url = actor.customGlbUrl || actor.modelUrl;
      const modelKey = url || `proc:${actor.assetId}:${actor.primaryColor}:${actor.physicsRole}`;
      let view = this.actors.get(actor.id);
      if (view && view.modelKey !== modelKey) {
        this.actorsGroup.remove(view.root);
        this.actors.delete(actor.id);
        view = undefined;
      }
      if (!view) {
        const root = new THREE.Group();
        const anim = new THREE.Group();
        root.add(anim);
        root.userData.actorId = actor.id;
        view = { root, anim, modelKey };
        this.actors.set(actor.id, view);
        this.actorsGroup.add(root);
        if (url) {
          const target = view;
          const placeholder = proceduralActor(actor);
          anim.add(placeholder);
          loadGltf(this.resolveUrl(url))
            .then((source) => {
              if (this.actors.get(actor.id) !== target) return;
              const model = SkeletonUtils.clone(source) as THREE.Object3D;
              model.traverse((o) => {
                if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
              });
              anim.remove(placeholder);
              const entry = ASSET_REGISTRY[actor.assetId];
              model.scale.setScalar(entry?.defaultScale ?? 1);
              anim.add(model);
              const clips: THREE.AnimationClip[] = (source as any).animations || [];
              if (clips.length) {
                target.mixer = new THREE.AnimationMixer(model);
                target.actions = new Map(clips.map((c) => [c.name, target.mixer!.clipAction(c)]));
              }
            })
            .catch(() => undefined); // keep the procedural stand-in when a model can't load offline
        } else {
          anim.add(proceduralActor(actor));
        }
      }
      // Transform + visibility (game: always; media: within the actor's time window).
      const visible = actor.visible !== false && (spec.mode === 'game' || ((actor.startTime ?? 0) <= time && (actor.endTime ?? Infinity) >= time));
      view.root.visible = visible;
      view.root.position.set(...actor.position);
      view.root.rotation.set(...actor.rotation);
      view.root.scale.set(...actor.scale);
      // Skeletal clip
      if (view.mixer && view.actions) {
        const name = matchClip(actor.activeClip, [...view.actions.keys()]);
        if (name && name !== view.activeClip) {
          const next = view.actions.get(name)!;
          const prev = view.activeClip ? view.actions.get(view.activeClip) : undefined;
          next.reset().fadeIn(0.3).play();
          prev?.fadeOut(0.3);
          view.activeClip = name;
        }
        view.mixer.timeScale = actor.animationSpeed ?? 1;
      } else {
        // Procedural animation types (same intent as the studio ActorRenderer).
        const t = this.clock * (actor.animationSpeed ?? 1);
        const a = view.anim;
        a.position.y = 0;
        a.rotation.y = 0;
        if (actor.activeAnimation === 'bounce') a.position.y = Math.abs(Math.sin(t * 3)) * 0.35;
        else if (actor.activeAnimation === 'spin') a.rotation.y = t * 1.6;
        else if (actor.activeAnimation === 'float') a.position.y = Math.sin(t * 1.6) * 0.18 + 0.15;
        else if (actor.activeAnimation === 'walk') a.position.y = Math.abs(Math.sin(t * 6)) * 0.08;
        if (actor.physicsRole === 'collectible') a.rotation.y = t * 1.8;
      }
    }
    for (const [id, view] of this.actors) {
      if (!live.has(id)) {
        this.actorsGroup.remove(view.root);
        this.actors.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- vfx
  private syncVfx(nodes: VFXNode[], time: number) {
    const live = new Set<string>();
    for (const v of nodes) {
      live.add(v.id);
      let obj = this.vfx.get(v.id);
      if (!obj) {
        obj = this.makeVfx(v);
        this.vfx.set(v.id, obj);
        this.fxGroup.add(obj);
      }
      obj.position.set(...v.position);
      obj.visible = v.visible !== false && (v.startTime ?? 0) <= time && (v.endTime ?? Infinity) >= time;
      if (obj.userData.kind === 'shockwave') obj.scale.setScalar(1 + ((this.clock * 1.4) % 2.5));
      else if (obj.userData.kind === 'sparkles' || obj.userData.kind === 'confetti') obj.rotation.y = this.clock * 0.6;
    }
    for (const [id, obj] of this.vfx) if (!live.has(id)) { this.fxGroup.remove(obj); this.vfx.delete(id); }
  }

  private makeVfx(v: VFXNode): THREE.Object3D {
    const color = v.color || '#FBBF24';
    if (v.type === 'floating-3d-badge') {
      const s = textSprite(v.labelText || v.name, color);
      s.userData.kind = v.type;
      return s;
    }
    if (v.type === 'laser-beam') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      m.rotation.z = Math.PI / 2;
      m.userData.kind = v.type;
      return m;
    }
    if (v.type === 'shockwave') {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.userData.kind = v.type;
      return m;
    }
    const n = Math.round(80 * Math.max(0.3, Math.min(3, v.intensity || 1)));
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 2 * (v.scale || 1);
      p[i * 3 + 1] = Math.random() * 2 * (v.scale || 1);
      p[i * 3 + 2] = (Math.random() - 0.5) * 2 * (v.scale || 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: v.type === 'confetti' ? 0.12 : 0.08, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.userData.kind = v.type;
    return pts;
  }

  private syncBursts(bursts: Array<{ id: string; position: [number, number, number]; color: string }>) {
    const now = this.clock;
    for (const b of bursts) {
      if (this.bursts.has(b.id)) continue;
      const n = 48;
      const p = new Float32Array(n * 3);
      const vel: number[] = [];
      for (let i = 0; i < n; i++) {
        p[i * 3] = b.position[0];
        p[i * 3 + 1] = b.position[1] + 0.8;
        p[i * 3 + 2] = b.position[2];
        vel.push((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: b.color, size: 0.12, transparent: true, depthWrite: false }));
      pts.userData.vel = vel;
      this.fxGroup.add(pts);
      this.bursts.set(b.id, { obj: pts, born: now });
    }
    for (const [id, burst] of this.bursts) {
      const age = now - burst.born;
      if (age > 1.1) {
        this.fxGroup.remove(burst.obj);
        this.bursts.delete(id);
        continue;
      }
      const pos = burst.obj.geometry.attributes.position as THREE.BufferAttribute;
      const vel = burst.obj.userData.vel as number[];
      for (let i = 0; i < pos.count; i++) {
        vel[i * 3 + 1] -= 9.8 * 0.016;
        pos.setXYZ(i, pos.getX(i) + vel[i * 3] * 0.016, pos.getY(i) + vel[i * 3 + 1] * 0.016, pos.getZ(i) + vel[i * 3 + 2] * 0.016);
      }
      pos.needsUpdate = true;
      (burst.obj.material as THREE.PointsMaterial).opacity = 1 - age / 1.1;
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
      if (!actor || !state.isPlaying) return;
      if (this.runtime.emit('actor-click', { actorId: actor.id })) return;
      if (state.sceneSpec.mode === 'game' || actor.onClickAction !== 'none') state.triggerActorInteraction(actor);
      return;
    }
  };

  // ---------------------------------------------------------------- camera (mirrors SceneDirector)
  private updateCamera(spec: SceneSpec, time: number, initial: boolean) {
    const cam = spec.camera;
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
      for (const view of this.actors.values()) this.actorsGroup.remove(view.root);
      this.actors.clear();
      for (const o of this.vfx.values()) this.fxGroup.remove(o);
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
    this.syncActors(state.sceneSpec, state.currentTime);
    this.syncVfx(state.sceneSpec.vfx || [], state.currentTime);
    this.syncBursts(state.burstEffects as any);
    for (const view of this.actors.values()) view.mixer?.update(dt);
    if (this.weather) {
      const pos = this.weather.geometry.attributes.position as THREE.BufferAttribute;
      const kind = this.weather.userData.kind;
      const fall = kind === 'rain' ? 14 : kind === 'snow' ? 1.2 : -1.5;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - fall * dt;
        if (y < 0) y += 18;
        if (y > 18) y -= 18;
        pos.setY(i, y);
        if (kind !== 'rain') pos.setX(i, pos.getX(i) + Math.sin(this.clock + i) * 0.004);
      }
      pos.needsUpdate = true;
    }
    const water = this.world.getObjectByName('water');
    if (water) water.position.y = (state.sceneSpec.world?.terrain.waterLevel ?? 0.05) + Math.sin(this.clock * 0.8) * 0.03;
    this.updateCamera(state.sceneSpec, state.currentTime, sceneChanged);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
