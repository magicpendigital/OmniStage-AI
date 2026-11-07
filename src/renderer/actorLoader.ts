import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import dracoWrapperUrl from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import basisWrapperUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import basisWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';

// One worker pool for all instances. Vite serves version-matched decoder files
// locally, so imported models do not depend on a third-party decoder CDN.
const dracoLoader = new DRACOLoader()
  .setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl })
  .setWorkerLimit(2);
const textureDecoders = new WeakMap<THREE.WebGLRenderer, KTX2Loader>();
const textureDecoderPool = new Set<KTX2Loader>();

export function configureActorLoader(loader: GLTFLoader, renderer?: THREE.WebGLRenderer) {
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    let textures = textureDecoders.get(renderer);
    if (!textures) {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => url.endsWith('basis_transcoder.js') ? basisWrapperUrl
        : url.endsWith('basis_transcoder.wasm') ? basisWasmUrl : url);
      textures = new KTX2Loader(manager).setWorkerLimit(2).detectSupport(renderer);
      textureDecoders.set(renderer, textures);
      textureDecoderPool.add(textures);
    }
    loader.setKTX2Loader(textures);
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  dracoLoader.dispose();
  textureDecoderPool.forEach((decoder) => decoder.dispose());
});

