/**
 * Phase 6 — Runs extension commands: one sandbox per extension (created lazily), host API wired to the store.
 * Scene writes are merge patches → deterministic auto-fix → normal undo history.
 */
import { useStudioStore } from '../state/useStudioStore';
import { autoFixSceneSpec } from '../verification/sceneVerifier';
import { mergePatch } from '../utils/jsonPatch';
import { workspaceApi } from '../workspace/workspaceClient';
import { ExtensionSandbox } from './sandboxHost';
import type { InstalledExtension } from './types';

const sandboxes = new Map<string, ExtensionSandbox>();

function sandboxFor(ext: InstalledExtension): ExtensionSandbox {
  const key = `${ext.manifest.id}@${ext.manifest.version}`;
  let sb = sandboxes.get(key);
  if (!sb) {
    sb = new ExtensionSandbox(ext.manifest, ext.approvedPermissions, {
      getScene: () => useStudioStore.getState().sceneSpec,
      applyScenePatch: (patch, label) => {
        const store = useStudioStore.getState();
        const current = store.sceneSpec;
        const merged = mergePatch(current, patch);
        merged.id = current.id; // extensions cannot swap the scene identity
        const { spec, fixes, report } = autoFixSceneSpec(merged, { scenes: store.scenes });
        store.setSceneSpec(spec, [`${ext.manifest.name}: ${label}`, ...fixes]);
        store.appendLog({ level: 'action', message: `Extension "${ext.manifest.name}" changed the scene: ${label}${fixes.length ? ` (auto-fixed ${fixes.length})` : ''}` });
        return { ok: report.ok, fixes, errors: report.errors };
      },
      listLibrary: () => workspaceApi.listLibrary('personal'),
      notify: (message) => useStudioStore.getState().appendLog({ level: 'info', message }),
      log: (message) => useStudioStore.getState().appendLog({ level: 'info', message }),
    });
    sandboxes.set(key, sb);
  }
  return sb;
}

export async function runExtensionCommand(ext: InstalledExtension, commandId: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return sandboxFor(ext).run(commandId, args);
}

export function disposeExtensionSandbox(extensionId: string) {
  for (const [key, sb] of sandboxes) {
    if (key.startsWith(`${extensionId}@`)) {
      sb.dispose();
      sandboxes.delete(key);
    }
  }
}
