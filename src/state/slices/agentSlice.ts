/**
 * Phase 7C store slice — Chat, vision QA, learned skills, settings and storyboard jobs.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { cloneSceneSpec } from '../../registry/assetRegistry';
import { ChatMessage, SceneSpec, VisionQAReport } from '../../types/scene.schema';
import { syncGraphWithScene } from '../../runtime/graphSync';
import { MAX_LEARNED_SKILLS, distillLearnedSkill, persistLearnedSkills } from '../../agent/directorSkills';
import { SETTINGS_STORAGE_KEY } from '../storeHelpers';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createAgentSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setVisionRunning: (isVisionRunning) => set({ isVisionRunning }),
  setLatestVisionReport: (latestVisionReport) => set({ latestVisionReport }),

  applyVisionFixes: (report) =>
    set((state) => {
      const patchedSpec = syncGraphWithScene(cloneSceneSpec(report.proposedSceneSpec));
      const appliedReport: VisionQAReport = { ...report, applied: true };
      const confirmationMsg: ChatMessage = {
        id: `msg-vision-apply-${Date.now()}`,
        role: 'assistant',
        content: `Applied Vision QA spatial fixes: ${report.issues
          .map((i) => i.suggestedFixSummary)
          .join(' · ')}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        diffSummary: report.issues.map((i) => `Fixed [${i.category}]: ${i.suggestedFixSummary}`),
        previousSpecSnapshot: cloneSceneSpec(state.sceneSpec),
        updatedSpecSnapshot: patchedSpec,
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: patchedSpec,
        latestVisionReport: appliedReport,
        chatMessages: [...state.chatMessages, confirmationMsg],
      };
    }),

  saveLearnedSkill: (prompt, spec, title) => {
    const skill = distillLearnedSkill(prompt, spec, title);
    const next = [skill, ...get().learnedSkills].slice(0, MAX_LEARNED_SKILLS);
    persistLearnedSkills(next);
    set({ learnedSkills: next });
    return skill;
  },

  removeLearnedSkill: (skillId) => {
    const next = get().learnedSkills.filter((s) => s.id !== skillId);
    persistLearnedSkills(next);
    set({ learnedSkills: next });
  },

  markSkillsUsed: (skillIds) => {
    if (!skillIds.length) return;
    let changed = false;
    const next = get().learnedSkills.map((s) => {
      if (!skillIds.includes(s.id)) return s;
      changed = true;
      return { ...s, uses: (s.uses || 0) + 1 };
    });
    if (!changed) return;
    persistLearnedSkills(next);
    set({ learnedSkills: next });
  },


  updateSettings: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore quota errors
        }
      }
      return { settings: next };
    }),

  setStoryboardJob: (storyboardJob) => set({ storyboardJob }),

  appendStoryboardScene: (spec, activate = true) => {
    const cloned = cloneSceneSpec(spec);
    set((state) => {
      // Persist in-progress edits of the active scene before appending
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const withoutDup = savedScenes.filter((s) => s.id !== cloned.id);
      return { scenes: [...withoutDup, cloned] };
    });
    if (activate) get().switchScene(cloned.id);
  },

  linkStoryboardScenes: (storyboardId, activateFirst = true) => {
    set((state) => {
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const members = savedScenes
        .filter((s) => s.sequence?.storyboardId === storyboardId)
        .sort((a, b) => (a.sequence!.index ?? 0) - (b.sequence!.index ?? 0));
      if (members.length === 0) return state;
      const linkedById = new Map<string, SceneSpec>();
      members.forEach((m, i) => {
        const next = cloneSceneSpec(m);
        next.sequence = {
          ...next.sequence!,
          index: i,
          total: members.length,
          nextSceneId: members[i + 1]?.id,
        };
        linkedById.set(next.id, next);
      });
      const scenes = savedScenes.map((s) => linkedById.get(s.id) ?? s);
      const active = linkedById.get(state.activeSceneId);
      return active ? { scenes, sceneSpec: cloneSceneSpec(active) } : { scenes };
    });
    if (activateFirst) {
      const first = get().scenes.find(
        (s) => s.sequence?.storyboardId === storyboardId && s.sequence.index === 0
      );
      if (first) get().switchScene(first.id);
    }
  },
});
