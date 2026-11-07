// Run against `npm run dev` with:
// npx --package @playwright/cli playwright-cli run-code --filename tests/renderer.browser.js
async (page) => {
  await page.goto(new URL(page.url()).origin);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluate(async () => {
    const { useStudioStore } = await import('/src/state/useStudioStore.ts');
    const { _roots } = await import('/node_modules/.vite/deps/@react-three_fiber.js');
    const { createBlankSceneSpec } = await import('/src/registry/assetRegistry.ts');
    window.__rendererQA = { store: useStudioStore, roots: _roots, createBlankSceneSpec,
      previousSettings: { ...useStudioStore.getState().settings } };
  });
  await page.waitForFunction(() => {
    const root = window.__rendererQA.roots.get(document.querySelector('canvas'))?.store;
    if (root) window.__rendererQA.root = root;
    return !!root;
  });
  await page.evaluate(() => {
    const { store: useStudioStore, createBlankSceneSpec } = window.__rendererQA;
    useStudioStore.getState().updateSettings({ renderQuality: 'high' });
    const spec = createBlankSceneSpec('3d');
    spec.id = 'renderer-qa';
    spec.mode = 'media';
    spec.camera.mode = 'orbit';
    spec.camera.position = [8, 5, 10];
    spec.camera.target = [0, 0.7, 0];
    spec.durationSeconds = 120;
    spec.environment.fogNear = 30;
    spec.environment.fogFar = 90;
    spec.environment.fogColor = '#c39180';
    spec.environment.groundGrid = false;
    spec.world.skybox = 'sunset-atmosphere';
    spec.world.sunPosition = [-10, 8, -15];
    spec.world.terrain.type = 'ocean-island';
    spec.world.terrain.color = '#3a725b';
    spec.world.weather = { type: 'snow', intensity: 1 };
    spec.vfx = ['sparkles', 'confetti'].map((type, index) => ({
      id: type, name: type, type, position: [index * 3 - 1.5, 2, 0],
      color: '#ffd67c', intensity: 1,
    }));
    const actor = spec.actors[0];
    actor.position = [-1.5, 0.6, 0]; actor.activeClip = 'Idle';
    spec.actors = [actor, { ...structuredClone(actor), id: 'second-rig', position: [1.5, 0.6, 0], activeClip: 'Running' }];
    useStudioStore.getState().loadProjectBundle([spec], spec.id);
    useStudioStore.setState({ isPlaying: false, currentTime: 3, selectedActorId: null });
  });
  await page.waitForFunction(() => {
    const scene = window.__rendererQA.root.getState().scene;
    let skeletons = 0;
    scene.traverse(node => { if (node.isSkinnedMesh) skeletons++; });
    return skeletons >= 2 && scene.getObjectByName('ReflectiveWater') && scene.getObjectByName('GPU-snow');
  });
  const initial = await page.evaluate(() => {
    const { scene, gl, camera, controls } = window.__rendererQA.root.getState();
    camera.position.set(14, 6, 16);
    controls.target.set(0, 0.7, 0); controls.update();
    const rigs = [];
    scene.traverse(node => { if (node.isSkinnedMesh) rigs.push(node.skeleton); });
    if (rigs[0].bones[0] === rigs[rigs.length - 1].bones[0]) throw Error('Rig instances share bones');
    const gpu = scene.getObjectByName('GPU-snow');
    window.__rendererQA.seedBuffer = gpu.geometry.attributes.position;
    return { independentRigs: true, reflectionSize: scene.getObjectByName('ReflectiveWater').getRenderTarget().width,
      weatherCount: gpu.geometry.attributes.position.count, renderer: gl.getContext().getParameter(gl.getContext().RENDERER) };
  });
  await page.screenshot({ path: 'output/playwright/sunset-water.png' });
  await page.evaluate(() => {
    const { store, root } = window.__rendererQA;
    store.getState().updateTerrain({ type: 'flat-grid', waterLevel: 1.5 });
    for (const actor of store.getState().sceneSpec.actors) {
      store.getState().updateActorProperty(actor.id, { position: [actor.position[0], 1.15, actor.position[2]] });
    }
    root.getState().camera.position.set(8, 4, 12);
    root.getState().controls.target.set(0, 1.5, 0);
    root.getState().controls.update();
  });
  await page.waitForFunction(() => window.__rendererQA.root.getState().scene.getObjectByName('ReflectiveWater').position.y > 1);
  await page.screenshot({ path: 'output/playwright/reflective-water.png' });
  const weather = [];
  for (const type of ['rain', 'snow', 'floating-embers', 'foggy-mist']) {
    await page.evaluate(type => window.__rendererQA.store.getState().updateWeather({ type, intensity: 1 }), type);
    await page.waitForFunction(type => !!window.__rendererQA.root.getState().scene.getObjectByName(`GPU-${type}`), type);
    const result = await page.evaluate(type => {
      const { scene, gl } = window.__rendererQA.root.getState();
      const gpu = scene.getObjectByName(`GPU-${type}`);
      return { type, time: gpu.material.uniforms.uTime.value, uploads: gpu.geometry.attributes.position.version,
        programsValid: gl.info.programs.every(program => program.diagnostics?.runnable !== false) };
    }, type);
    if (!result.programsValid || result.uploads !== 0) throw Error(`GPU shader/upload failure: ${type}`);
    weather.push(result);
  }
  await page.evaluate(() => window.__rendererQA.store.getState().setCurrentTime(60));
  await page.waitForFunction(() => window.__rendererQA.root.getState().scene.getObjectByName('DynamicSky').material.uniforms.uTime.value === 60);
  await page.screenshot({ path: 'output/playwright/sky-cycle.png' });
  await page.evaluate(() => {
    const store = window.__rendererQA.store;
    store.getState().updateSettings({ renderQuality: 'draft' });
    store.setState({ burstEffects: [{ id: 'qa-burst', position: [0, 2, 0], color: '#ffcc66', createdAt: Date.now() }] });
  });
  await page.waitForFunction(() => window.__rendererQA.root.getState().scene.getObjectByName('ReflectiveWater').getRenderTarget().width === 256);
  await page.evaluate(() => {
    const { scene } = window.__rendererQA.root.getState();
    if (!scene.getObjectByName('GPU-burst')) throw Error('Missing GPU collision burst');
    const programs = window.__rendererQA.root.getState().gl.info.programs;
    if (programs.some(program => program.diagnostics?.runnable === false)) throw Error('Shader compile/link failed');
  });
  const textureCounts = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.evaluate(() => window.__rendererQA.store.getState().updateTerrain({ type: 'none' }));
    await page.waitForFunction(() => !window.__rendererQA.root.getState().scene.getObjectByName('ReflectiveWater'));
    await page.evaluate(() => window.__rendererQA.store.getState().updateTerrain({ type: 'ocean-island' }));
    await page.waitForFunction(() => !!window.__rendererQA.root.getState().scene.getObjectByName('ReflectiveWater'));
    textureCounts.push(await page.evaluate(() => window.__rendererQA.root.getState().gl.info.memory.textures));
  }
  if (textureCounts.at(-1) > textureCounts[1] + 1) throw Error(`Water textures leaked: ${textureCounts}`);
  const registry = await page.evaluate(async () => {
    const { ASSET_REGISTRY } = await import('/src/registry/assetRegistry.ts');
    return Object.values(ASSET_REGISTRY).filter(asset => asset.modelUrl).map(asset => ({ id: asset.assetId, url: asset.modelUrl }));
  });
  const cdnChecks = await Promise.all(registry.map(async asset => {
    const response = await page.request.head(asset.url);
    return { id: asset.id, status: response.status(), cors: response.headers()['access-control-allow-origin'] };
  }));
  const compressed = await page.evaluate(async () => {
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { configureActorLoader } = await import('/src/renderer/actorLoader.ts');
    const { gl, camera } = window.__rendererQA.root.getState();
    const results = [];
    for (const [name, extension] of [['LittlestTokyo', 'KHR_draco_mesh_compression'], ['coffeemat', 'EXT_meshopt_compression']]) {
      const loader = new GLTFLoader();
      configureActorLoader(loader, gl);
      const model = await loader.loadAsync(`https://threejs.org/examples/models/gltf/${name}.glb`);
      const extensions = model.parser.json.extensionsUsed ?? [];
      if (!extensions.includes(extension)) throw Error(`Missing expected compression extension: ${extension}`);
      let vertices = 0;
      const textures = new Set();
      model.scene.traverse(node => {
        if (!node.isMesh) return;
        vertices += node.geometry.attributes.position.count;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      if (!vertices) throw Error(`${name} decoded no geometry`);
      await gl.compileAsync(model.scene, camera);
      results.push({ name, extensions, vertices, textures: textures.size, clips: model.animations.length });
      model.scene.traverse(node => {
        if (!node.isMesh) return;
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
      });
      textures.forEach(texture => texture.dispose());
    }
    return results;
  });
  await page.evaluate(() => window.__rendererQA.store.getState().updateSettings(window.__rendererQA.previousSettings));
  const report = { initial, weather, textureCounts, cdnChecks, compressed, errors };
  await page.evaluate(report => { window.__rendererQA.report = report; }, report);
  if (errors.length || cdnChecks.some(check => check.status !== 200 || !check.cors)) throw Error('Renderer or registry verification failed');
  return report;
}
