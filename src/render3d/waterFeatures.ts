/**
 * Phase 10B — animated water landmarks (waterfall with cliff, pool, foam and mist; river; pond) as plain Three.js,
 * shared by the studio world and the OmniStage Player. Motion reads `ctx.time`, so pause / scrub / frame-stepped
 * exports stay deterministic. Textures are drawn procedurally (seeded), no image files.
 */
import * as THREE from 'three';
import type { TerrainType, WorldFeatureSpec } from '../types/scene.schema';
import { computeTerrainHeight } from '../runtime/world';
import { disposeObject } from './h';
import type { Built3D } from './types';

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Vertical streaks of falling / flowing water (tileable in v). */
function streakTexture(seed: number, base: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const r = seeded(seed);
  for (let i = 0; i < 260; i++) {
    const x = r() * c.width;
    const y = r() * c.height;
    const len = 20 + r() * 90;
    const light = r() < 0.7;
    g.strokeStyle = light ? `rgba(255,255,255,${0.25 + r() * 0.5})` : `rgba(10,60,90,${0.15 + r() * 0.25})`;
    g.lineWidth = 0.6 + r() * 2.2;
    for (const dy of [0, -c.height, c.height]) {
      g.beginPath();
      g.moveTo(x, y + dy);
      g.lineTo(x + (r() - 0.5) * 3, y + len + dy);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(240,250,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const waterSurface = (map?: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ color: '#3a9cc4', map, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.9, emissive: '#0d4a66', emissiveIntensity: 0.35 });

/** A flat water disc at the lowest ground under it (a pond fills the dip; higher ground covers its edge naturally). */
function pool(cx: number, cz: number, radius: number, terrain: TerrainType, elevation: number, map: THREE.Texture) {
  let low = Infinity;
  for (let a = 0; a < 12; a++) {
    for (const rr of [0, radius * 0.5, radius * 0.9]) {
      const x = cx + Math.cos((a / 12) * Math.PI * 2) * rr;
      const z = cz + Math.sin((a / 12) * Math.PI * 2) * rr;
      low = Math.min(low, computeTerrainHeight(terrain, x, z, elevation));
    }
  }
  const geo = new THREE.CircleGeometry(radius, 48);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, waterSurface(map));
  mesh.position.set(cx, low + 0.06, cz);
  mesh.receiveShadow = true;
  return mesh;
}

function waterfall(f: WorldFeatureSpec, terrain: TerrainType, elevation: number): Built3D {
  const s = Math.max(0.3, f.size || 1);
  const [fx, , fz] = f.position;
  const yaw = ((f.rotationDeg || 0) * Math.PI) / 180;
  const group = new THREE.Group();
  group.name = `WaterFeature-${f.id}`;
  const ground = computeTerrainHeight(terrain, fx, fz, elevation);
  group.position.set(fx, ground, fz);
  group.rotation.y = yaw;
  const H = 5.2 * s;

  // cliff: a stack of rough boulders behind the fall
  const rock = new THREE.MeshStandardMaterial({ color: '#6b6f76', roughness: 0.95, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: '#4d6b35', roughness: 0.95, flatShading: true });
  const r = seeded(97 + Math.round(fx * 13 + fz * 7));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(7.5 * s, H + 0.6, 3 * s), rock);
  wall.position.set(0, H / 2 - 0.2, -2.1 * s);
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);
  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const size = (0.7 + r() * 1.1) * s;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), i % 4 === 0 ? moss : rock);
    const onTop = i >= 10;
    m.position.set(onTop ? (r() - 0.5) * 6 * s : side * (1.7 + r() * 2.2) * s, onTop ? H + 0.1 : r() * H * 0.95, onTop ? -1.8 * s : (-0.9 + r() * 0.6) * s);
    m.rotation.set(r() * 3, r() * 3, r() * 3);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // falling sheet: bulges out at the lip, scrolls downward
  const fallMap = streakTexture(31, '#9fd8f0');
  fallMap.repeat.set(1.5, 1.4);
  const sheetGeo = new THREE.PlaneGeometry(2.6 * s, H, 1, 24);
  const pos = sheetGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getY(i) + H / 2) / H; // 0 bottom .. 1 top
    pos.setZ(i, 0.55 * s * Math.sin(u * Math.PI * 0.5) * (u > 0.85 ? 1 : 0.85 + u * 0.15));
  }
  sheetGeo.computeVertexNormals();
  const sheetMat = new THREE.MeshStandardMaterial({ map: fallMap, color: '#e8f8ff', transparent: true, opacity: 0.92, roughness: 0.2, emissive: '#5fb7d9', emissiveIntensity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.position.set(0, H / 2, -0.55 * s);
  group.add(sheet);

  // pool at the foot
  const poolMap = streakTexture(57, '#3a9cc4');
  poolMap.repeat.set(3, 3);
  const basin = pool(0, 0, 3.4 * s, 'flat-grid', 0, poolMap);
  basin.position.set(0, 0.06, 1.4 * s);
  group.add(basin);

  // foam + mist sprites
  const dot = softDot();
  const foam: THREE.Sprite[] = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0.7, color: '#ffffff' });
    const sp = new THREE.Sprite(mat);
    sp.position.set((i / 11 - 0.5) * 2.8 * s, 0.35 * s, (0.1 + (i % 3) * 0.35) * s);
    foam.push(sp);
    group.add(sp);
  }
  const mistMat = new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0.35 });
  const mist = new THREE.Sprite(mistMat);
  mist.position.set(0, 1.1 * s, 0.6 * s);
  mist.scale.set(6 * s, 3 * s, 1);
  group.add(mist);

  return {
    object: group,
    update(ctx) {
      fallMap.offset.y = ctx.time * 1.6;
      poolMap.offset.set(ctx.time * 0.05, ctx.time * 0.12);
      foam.forEach((sp, i) => {
        const k = 1 + 0.3 * Math.sin(ctx.time * 3.1 + i * 1.7);
        sp.scale.set(1.3 * s * k, 0.9 * s * k, 1);
        sp.material.opacity = 0.5 + 0.3 * Math.sin(ctx.time * 2.3 + i);
      });
      mistMat.opacity = 0.28 + 0.08 * Math.sin(ctx.time * 0.9);
    },
    dispose() {
      disposeObject(group);
      dot.dispose();
    },
  };
}

function river(f: WorldFeatureSpec, terrain: TerrainType, elevation: number): Built3D {
  const s = Math.max(0.3, f.size || 1);
  const [fx, , fz] = f.position;
  const yaw = ((f.rotationDeg || 0) * Math.PI) / 180;
  const width = 3 * s;
  const length = 40 * s;
  const geo = new THREE.PlaneGeometry(width, length, 4, 80);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    // a gentle meander
    const bend = Math.sin(lz * 0.12) * 1.2 * s;
    const x = lx + bend;
    const wx = fx + x * cos + lz * sin;
    const wz = fz - x * sin + lz * cos;
    pos.setX(i, x);
    pos.setY(i, computeTerrainHeight(terrain, wx, wz, elevation) + 0.08);
  }
  geo.computeVertexNormals();
  const map = streakTexture(73, '#3a9cc4');
  map.repeat.set(1, 8);
  const mesh = new THREE.Mesh(geo, waterSurface(map));
  mesh.name = `WaterFeature-${f.id}`;
  mesh.position.set(fx, 0, fz);
  mesh.rotation.y = yaw;
  mesh.receiveShadow = true;
  return {
    object: mesh,
    update(ctx) { map.offset.y = ctx.time * 0.45; },
    dispose() { disposeObject(mesh); },
  };
}

function pond(f: WorldFeatureSpec, terrain: TerrainType, elevation: number): Built3D {
  const s = Math.max(0.3, f.size || 1);
  const map = streakTexture(11, '#3a9cc4');
  map.repeat.set(3, 3);
  const mesh = pool(f.position[0], f.position[2], 3 * s, terrain, elevation, map);
  mesh.name = `WaterFeature-${f.id}`;
  return {
    object: mesh,
    update(ctx) { map.offset.set(ctx.time * 0.03, ctx.time * 0.05); },
    dispose() { disposeObject(mesh); },
  };
}

export function createWaterFeature(f: WorldFeatureSpec, terrain: TerrainType, elevation: number): Built3D | null {
  if (typeof document === 'undefined') return null;
  switch (f.type) {
    case 'waterfall': return waterfall(f, terrain, elevation);
    case 'river': return river(f, terrain, elevation);
    case 'pond': return pond(f, terrain, elevation);
    default: return null;
  }
}
