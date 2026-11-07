/**
 * Client for the server-side Online Asset Hub proxy (see server/assetHubProxy.ts).
 * All model / HDRI URLs returned here point at same-origin /api/assets/* routes, so
 * useGLTF and the HDR loader never hit third-party CORS restrictions.
 */
import {
  OnlineAssetKind,
  OnlineAssetProvider,
  OnlineAssetResult,
  OnlineAssetSearchResponse,
  SettingsConfig,
} from '../types/scene.schema';

export interface OnlineAssetSource {
  id: string;
  provider: OnlineAssetProvider;
  kind: OnlineAssetKind;
  label: string;
  settingsToggle: keyof SettingsConfig;
  needsKey?: 'polyPizzaApiKey' | 'sketchfabApiToken';
  keyRequiredFor: 'search' | 'download' | null;
}

export const ONLINE_ASSET_SOURCES: OnlineAssetSource[] = [
  { id: 'polypizza', provider: 'polypizza', kind: 'model', label: 'Poly Pizza · Low-poly GLB', settingsToggle: 'enablePolyPizzaHub', needsKey: 'polyPizzaApiKey', keyRequiredFor: 'search' },
  { id: 'sketchfab', provider: 'sketchfab', kind: 'model', label: 'Sketchfab · Downloadable GLB', settingsToggle: 'enableSketchfabHub', needsKey: 'sketchfabApiToken', keyRequiredFor: 'download' },
  { id: 'polyhaven-model', provider: 'polyhaven', kind: 'model', label: 'Poly Haven · CC0 Models', settingsToggle: 'enablePolyHavenHub', keyRequiredFor: null },
  { id: 'polyhaven-hdri', provider: 'polyhaven', kind: 'hdri', label: 'Poly Haven · CC0 HDRI', settingsToggle: 'enablePolyHavenHub', keyRequiredFor: null },
];

function hubHeaders(settings: Pick<SettingsConfig, 'polyPizzaApiKey' | 'sketchfabApiToken'>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (settings.polyPizzaApiKey?.trim()) headers['x-polypizza-key'] = settings.polyPizzaApiKey.trim();
  if (settings.sketchfabApiToken?.trim()) headers['x-sketchfab-token'] = settings.sketchfabApiToken.trim();
  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (data?.error) return String(data.error);
  } catch {
    // ignore
  }
  return `Request failed (${response.status})`;
}

export async function searchOnlineAssets(
  source: OnlineAssetSource,
  query: string,
  page: number,
  settings: Pick<SettingsConfig, 'polyPizzaApiKey' | 'sketchfabApiToken'>,
  signal?: AbortSignal
): Promise<OnlineAssetSearchResponse> {
  const params = new URLSearchParams({
    provider: source.provider,
    kind: source.kind,
    q: query,
    page: String(page),
  });
  const response = await fetch(`/api/assets/search?${params}`, { headers: hubHeaders(settings), signal });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

/** Returns a same-origin URL loadable by useGLTF / HDR loader, resolving Sketchfab downloads when needed. */
export async function resolveOnlineAssetUrl(
  asset: OnlineAssetResult,
  settings: Pick<SettingsConfig, 'polyPizzaApiKey' | 'sketchfabApiToken'>
): Promise<string> {
  if (asset.downloadUrl) return asset.downloadUrl;
  if (asset.provider === 'sketchfab') {
    const response = await fetch('/api/assets/sketchfab/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hubHeaders(settings) },
      body: JSON.stringify({ uid: asset.id }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    if (typeof data?.downloadUrl === 'string') return data.downloadUrl;
  }
  throw new Error('This asset has no downloadable file.');
}
