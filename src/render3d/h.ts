/**
 * Phase 7B — a tiny JSX factory that builds plain Three.js objects (no React). Lets the studio's procedural 3D assets be
 * written once as readable JSX (`/** @jsx h *\/` files in src/render3d) and used by both the R3F studio viewport
 * (`<primitive object={…} />`) and the framework-free OmniStage Player.
 *
 * Supported tags mirror the R3F names used in those files: group, mesh, points, sprite, pointLight, *Geometry,
 * meshStandardMaterial, meshPhysicalMaterial, meshBasicMaterial. Unknown tags throw so mistakes surface in tests.
 */
import * as THREE from 'three';

type Props = Record<string, any> | null;
type Child = THREE.Object3D | THREE.BufferGeometry | THREE.Material | null | undefined | false | Child[];

const GEOMETRIES: Record<string, new (...args: any[]) => THREE.BufferGeometry> = {
  boxGeometry: THREE.BoxGeometry,
  cylinderGeometry: THREE.CylinderGeometry,
  sphereGeometry: THREE.SphereGeometry,
  torusGeometry: THREE.TorusGeometry,
  octahedronGeometry: THREE.OctahedronGeometry,
  icosahedronGeometry: THREE.IcosahedronGeometry,
  dodecahedronGeometry: THREE.DodecahedronGeometry,
  coneGeometry: THREE.ConeGeometry,
  circleGeometry: THREE.CircleGeometry,
  ringGeometry: THREE.RingGeometry,
  planeGeometry: THREE.PlaneGeometry,
  capsuleGeometry: THREE.CapsuleGeometry,
  torusKnotGeometry: THREE.TorusKnotGeometry,
};

const MATERIALS: Record<string, new (p?: any) => THREE.Material> = {
  meshStandardMaterial: THREE.MeshStandardMaterial,
  meshPhysicalMaterial: THREE.MeshPhysicalMaterial,
  meshBasicMaterial: THREE.MeshBasicMaterial,
  spriteMaterial: THREE.SpriteMaterial,
};

const OBJECT_PROPS = new Set(['position', 'rotation', 'scale', 'castShadow', 'receiveShadow', 'name', 'visible', 'renderOrder', 'frustumCulled']);

function flatten(children: Child[], out: Array<THREE.Object3D | THREE.BufferGeometry | THREE.Material> = []) {
  for (const c of children) {
    if (Array.isArray(c)) flatten(c, out);
    else if (c) out.push(c);
  }
  return out;
}

function applyObjectProps(obj: THREE.Object3D, props: Props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (!OBJECT_PROPS.has(k) || v === undefined) continue;
    if (k === 'position') obj.position.set(v[0], v[1], v[2]);
    else if (k === 'rotation') obj.rotation.set(v[0], v[1], v[2]);
    else if (k === 'scale') typeof v === 'number' ? obj.scale.setScalar(v) : obj.scale.set(v[0], v[1], v[2]);
    else (obj as any)[k] = v;
  }
}

export function h(tag: string | ((props: any) => any), props: Props, ...children: Child[]): any {
  if (typeof tag === 'function') return tag({ ...(props || {}), children });
  const kids = flatten(children);
  const Geometry = GEOMETRIES[tag];
  if (Geometry) return new Geometry(...((props?.args as unknown[]) || []));
  const Material = MATERIALS[tag];
  if (Material) {
    // Dev JSX transforms add __self / __source / key; never forward them to Three.js.
    const { args: _a, key: _k, __self: _s, __source: _src, ...rest } = props || {};
    return new Material(rest);
  }
  let obj: THREE.Object3D;
  switch (tag) {
    case 'group':
      obj = new THREE.Group();
      break;
    case 'mesh': {
      const geometry = kids.find((k): k is THREE.BufferGeometry => k instanceof THREE.BufferGeometry);
      const material = kids.find((k): k is THREE.Material => k instanceof THREE.Material);
      obj = new THREE.Mesh(geometry, material);
      break;
    }
    case 'sprite': {
      const material = kids.find((k): k is THREE.SpriteMaterial => k instanceof THREE.SpriteMaterial);
      obj = new THREE.Sprite(material);
      break;
    }
    case 'pointLight':
      obj = new THREE.PointLight(props?.color ?? 0xffffff, props?.intensity ?? 1, props?.distance ?? 0, props?.decay ?? 2);
      break;
    default:
      throw new Error(`render3d: unsupported tag <${tag}>`);
  }
  applyObjectProps(obj, props);
  for (const k of kids) if (k instanceof THREE.Object3D) obj.add(k);
  return obj;
}

export function Fragment(props: { children?: Child[] }) {
  const g = new THREE.Group();
  for (const k of flatten(props.children || [])) if (k instanceof THREE.Object3D) g.add(k);
  return g;
}

// JSX typing for files using `/** @jsx h */`: elements are plain Three.js objects.
export declare namespace h {
  namespace JSX {
    type Element = any;
    interface IntrinsicElements { [tag: string]: any }
  }
}

/** Dispose geometries/materials/textures of a built subtree (not shared caches). */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o: any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}
