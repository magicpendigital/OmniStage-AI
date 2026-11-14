/**
 * Phase 6 — Installed extensions on disk (~/OmniStage/extensions). Installing requires an explicit approval
 * payload from the studio (the user ticked the permissions in the review dialog); nothing installs silently.
 */
import { join } from 'node:path';
import type { ExtensionManifest, ExtensionPermission, ExtensionReview, InstalledExtension } from '../../src/extensions/types';
import { reviewExtension, validateManifest } from '../../src/extensions/validate';
import { assertId, moveToTrash, nowIso, omniHome, readJSON, WorkspaceError, writeJSON } from './store';

function extensionsRoot() {
  return join(omniHome(), 'extensions');
}

interface Registry {
  installed: Record<string, Omit<InstalledExtension, 'manifest'>>;
}

async function readRegistry(): Promise<Registry> {
  return readJSON<Registry>(join(extensionsRoot(), 'registry.json'), { installed: {} });
}

export async function listInstalled(): Promise<InstalledExtension[]> {
  const reg = await readRegistry();
  const out: InstalledExtension[] = [];
  for (const [id, entry] of Object.entries(reg.installed)) {
    const manifest = await readJSON<ExtensionManifest | null>(join(extensionsRoot(), id, 'manifest.json'), null);
    if (manifest) out.push({ ...entry, manifest });
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export async function installExtension(input: {
  manifest: ExtensionManifest;
  source: InstalledExtension['source'];
  approvedPermissions: ExtensionPermission[];
  aiReview?: Pick<ExtensionReview, 'aiSummary' | 'aiRisk'>;
}): Promise<InstalledExtension> {
  const errors = validateManifest(input.manifest);
  if (errors.length) throw new WorkspaceError(`Invalid extension: ${errors.join('; ')}`);
  const requested = input.manifest.permissions || [];
  const approved = Array.isArray(input.approvedPermissions) ? input.approvedPermissions : [];
  const missing = requested.filter((p) => !approved.includes(p));
  if (missing.length) throw new WorkspaceError(`Permissions not approved: ${missing.join(', ')}`);
  const id = assertId(input.manifest.id, 'extension id');
  const review = { ...reviewExtension(input.manifest), ...(input.aiReview || {}) };
  await writeJSON(join(extensionsRoot(), id, 'manifest.json'), input.manifest);
  const reg = await readRegistry();
  reg.installed[id] = { enabled: true, installedAt: nowIso(), source: input.source, approvedPermissions: requested, review };
  await writeJSON(join(extensionsRoot(), 'registry.json'), reg);
  return { manifest: input.manifest, ...reg.installed[id] };
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
  const reg = await readRegistry();
  if (!reg.installed[assertId(id, 'extension id')]) throw new WorkspaceError('Extension not installed', 404);
  reg.installed[id].enabled = !!enabled;
  await writeJSON(join(extensionsRoot(), 'registry.json'), reg);
}

export async function uninstallExtension(id: string): Promise<void> {
  const reg = await readRegistry();
  if (!reg.installed[assertId(id, 'extension id')]) throw new WorkspaceError('Extension not installed', 404);
  delete reg.installed[id];
  await writeJSON(join(extensionsRoot(), 'registry.json'), reg);
  await moveToTrash(join(extensionsRoot(), id), `extension-${id}`).catch(() => undefined);
}

/**
 * Downloads a manifest from an https URL (and its `main` script when given as a relative path) so the studio
 * can show the review dialog. Nothing is installed here.
 */
export async function fetchRemoteManifest(url: string): Promise<ExtensionManifest> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WorkspaceError('Invalid URL');
  }
  if (parsed.protocol !== 'https:') throw new WorkspaceError('Extensions can only be fetched over https');
  const get = async (u: string, limit: number) => {
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new WorkspaceError(`${u} returned ${res.status}`);
    const text = await res.text();
    if (text.length > limit) throw new WorkspaceError(`${u} is too large`);
    return text;
  };
  let manifest: any;
  try {
    manifest = JSON.parse(await get(parsed.toString(), 1024 * 1024));
  } catch (e: any) {
    if (e instanceof WorkspaceError) throw e;
    throw new WorkspaceError('The URL did not return a JSON manifest');
  }
  if (typeof manifest.main === 'string' && !manifest.mainSource) {
    const mainUrl = new URL(manifest.main, parsed);
    if (mainUrl.protocol !== 'https:') throw new WorkspaceError('main must be served over https');
    manifest.mainSource = await get(mainUrl.toString(), 200 * 1024);
    delete manifest.main;
  }
  return manifest as ExtensionManifest;
}
