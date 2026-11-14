/**
 * Phase 7C store slice — 2D nodes, VFX, particle emitters, audio and captions.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { PRESET_2D_ASSETS, cloneSceneSpec } from '../../registry/assetRegistry';
import { Node2D, SceneSpec, VFXNode, VFXType } from '../../types/scene.schema';
import { syncGraphWithScene } from '../../runtime/graphSync';
import { resolveAudioSpec } from '../../audio/audioBus';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createStageContentSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

  // ================= 2D VECTOR / SPRITE NODE ACTIONS =================
  selectNode2D: (id) => set({ selectedNode2DId: id }),

  spawnPreset2D: (presetId) =>
    set((state) => {
      const preset = PRESET_2D_ASSETS.find((p) => p.id === presetId) ?? PRESET_2D_ASSETS[0];
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const offset = (nextSpec.nodes2D.length % 5) * 35;
      const newNode: Node2D = {
        ...JSON.parse(JSON.stringify(preset.nodeTemplate)),
        id: `node2d-${Date.now().toString(36)}`,
        x: Math.min(860, preset.nodeTemplate.x + offset),
        y: Math.min(500, preset.nodeTemplate.y - offset * 0.5),
      };
      nextSpec.nodes2D.push(newNode);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedNode2DId: newNode.id,
      };
    }),

  addCustomNode2D: (nodeTemplate) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const newNode: Node2D = {
        ...nodeTemplate,
        id: `node2d-${Date.now().toString(36)}`,
      };
      nextSpec.nodes2D.push(newNode);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedNode2DId: newNode.id,
      };
    }),

  updateNode2D: (nodeId, patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.nodes2D.findIndex((n) => n.id === nodeId);
      if (idx === -1 || (nextSpec.nodes2D[idx].locked && patch.locked === undefined)) return state;
      nextSpec.nodes2D[idx] = { ...nextSpec.nodes2D[idx], ...patch };
      return {
        sceneSpec: nextSpec,
      };
    }),

  duplicateNode2D: (nodeId) =>
    set((state) => {
      const source = state.sceneSpec.nodes2D.find((n) => n.id === nodeId);
      if (!source) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const copy: Node2D = {
        ...JSON.parse(JSON.stringify(source)),
        id: `node2d-${Date.now().toString(36)}`,
        name: `${source.name} Copy`,
        x: Math.min(900, source.x + 40),
        y: Math.min(520, source.y + 30),
      };
      nextSpec.nodes2D.push(copy);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId: copy.id,
      };
    }),

  removeNode2D: (nodeId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.nodes2D = nextSpec.nodes2D.filter((n) => n.id !== nodeId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId:
          state.selectedNode2DId === nodeId
            ? (nextSpec.nodes2D[0]?.id ?? null)
            : state.selectedNode2DId,
      };
    }),

  // ================= VFX ACTIONS =================
  spawnVFX: (type) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const colorMap: Record<VFXType, string> = {
        sparkles: '#38BDF8',
        shockwave: '#06B6D4',
        'floating-3d-badge': '#F59E0B',
        'laser-beam': '#EC4899',
        confetti: '#FBBF24',
      };
      const newVfx: VFXNode = {
        id: `vfx-${Date.now().toString(36)}`,
        name: `${type.toUpperCase()} Node`,
        type,
        position: type === 'floating-3d-badge' ? [0, 2.5, 0] : [0, 0.2, 0],
        color: colorMap[type],
        intensity: 1.2,
        scale: 1,
        labelText: type === 'floating-3d-badge' ? 'SPECIAL OFFER · PLAY NOW' : undefined,
        startTime: 0,
        endTime: nextSpec.durationSeconds || 8,
        enterEffect: 'pop-in',
      };
      nextSpec.vfx.push(newVfx);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedVfxId: newVfx.id,
      };
    }),

  removeVFX: (vfxId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.vfx = nextSpec.vfx.filter((v) => v.id !== vfxId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateSoundtrack: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      if (patch === null) delete nextSpec.soundtrack;
      else nextSpec.soundtrack = { ...(nextSpec.soundtrack || {}), ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)),
      };
    }),

  setDialogue: (lines) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      if (lines.length) nextSpec.dialogue = lines;
      else delete nextSpec.dialogue;
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)),
      };
    }),

  setDialogueCaptions: (on) =>
    set((state) => {
      const nextSpec = { ...cloneSceneSpec(state.sceneSpec), dialogueCaptions: on };
      return { sceneSpec: nextSpec, scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)) };
    }),

  applyDialogueVoices: (dialogue) =>
    set((state) => {
      const patch = (s: SceneSpec) => (dialogue[s.id] ? { ...cloneSceneSpec(s), dialogue: dialogue[s.id] } : s);
      const nextSpec = patch(state.sceneSpec);
      return {
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : patch(s))),
      };
    }),

  updateActorVoice: (actorId, voice) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const actor = nextSpec.actors.find((a) => a.id === actorId);
      if (!actor) return {};
      if (voice) actor.voice = voice;
      else delete actor.voice;
      // A new voice invalidates the generated clips of this speaker.
      for (const line of nextSpec.dialogue || []) if (line.speaker === actorId) { delete line.clip; delete line.duration; }
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)),
      };
    }),

  updateSceneAudio: (patch, library) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      if (library && Object.keys(library).length) nextSpec.sfxLibrary = { ...(nextSpec.sfxLibrary || {}), ...library };
      const current = resolveAudioSpec(nextSpec);
      nextSpec.audio = {
        ...current,
        ...patch,
        cues: { ...current.cues, ...(patch.cues || {}) },
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)),
      };
    }),


  addParticleEmitter2D: (preset, recipe) => {
    if (recipe) {
      // Extension preset: carry the recipe with the scene so export / MCP / other machines can render it.
      set((state) => {
        const nextSpec = cloneSceneSpec(state.sceneSpec);
        nextSpec.particleLibrary = { ...(nextSpec.particleLibrary || {}), [preset]: recipe };
        return { sceneSpec: nextSpec, scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)) };
      });
    }
    const area = preset === 'rain' || preset === 'snow' || !!recipe?.area;
    get().addCustomNode2D({
      name: `${preset} FX`,
      type: 'particle-emitter',
      x: 500,
      y: area ? 300 : 360,
      width: area ? 1000 : 140,
      height: area ? 600 : 140,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      fill: 'transparent',
      stroke: '#A78BFA',
      physics2D: 'none',
      emitter: { preset, seed: Math.floor(Math.random() * 1000) },
    });
  },

  updateCaptions: (captions) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.captions = captions;
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: state.scenes.map((s) => (s.id === nextSpec.id ? nextSpec : s)),
      };
    }),
});
