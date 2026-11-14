/**
 * Phase 6 — Sandbox host for code extensions.
 *
 * Each extension's `mainSource` runs in its own hidden <iframe sandbox="allow-scripts"> (opaque origin: no access
 * to the studio DOM, cookies or storage) whose CSP is `default-src 'none'` (no network, no external scripts).
 * The only way out is `window.omni.*`, a postMessage RPC that the host checks against the permissions the user
 * approved at install. Scene writes go through the verifier and the normal undo history.
 */
import type { ExtensionManifest, ExtensionPermission } from './types';

export interface SandboxHostApi {
  getScene: () => unknown;
  applyScenePatch: (patch: unknown, label: string) => { ok: boolean; fixes: string[]; errors: number };
  listLibrary: () => Promise<unknown>;
  notify: (message: string) => void;
  log: (message: string) => void;
}

const BOOTSTRAP = `
(function () {
  var pending = {}; var seq = 0; var commands = {};
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq; pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ __omni: true, type: 'call', id: id, method: method, params: params || {} }, '*');
    });
  }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || !m.__omni) return;
    if (m.type === 'result' && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'Host error'));
    } else if (m.type === 'run') {
      var h = commands[m.command];
      Promise.resolve().then(function () {
        if (!h) throw new Error('Unknown command ' + m.command);
        return h(m.args || {});
      }).then(function (value) {
        parent.postMessage({ __omni: true, type: 'run-result', id: m.id, ok: true, value: value === undefined ? null : value }, '*');
      }, function (err) {
        parent.postMessage({ __omni: true, type: 'run-result', id: m.id, ok: false, error: String(err && err.message || err) }, '*');
      });
    }
  });
  window.omni = {
    registerCommand: function (id, fn) { commands[id] = fn; },
    scene: { get: function () { return call('scene.get'); }, applyPatch: function (patch, label) { return call('scene.applyPatch', { patch: patch, label: label }); } },
    library: { list: function () { return call('library.list'); } },
    fetch: function (url) { return call('net.fetch', { url: url }); },
    notify: function (message) { return call('ui.notify', { message: String(message) }); },
    log: function () { return call('log', { message: Array.prototype.map.call(arguments, String).join(' ') }); }
  };
  parent.postMessage({ __omni: true, type: 'ready' }, '*');
})();
`;

export function buildSandboxDocument(mainSource: string): string {
  const safe = mainSource.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">
</head><body><script>${BOOTSTRAP}</script><script>
try {
${safe}
} catch (err) { omni.log('Extension failed to start: ' + (err && err.message || err)); }
</script></body></html>`;
}

const METHOD_PERMISSION: Record<string, ExtensionPermission | null> = {
  'scene.get': 'scene:read',
  'scene.applyPatch': 'scene:write',
  'library.list': 'library:read',
  'net.fetch': 'network',
  'ui.notify': 'ui:notify',
  log: null,
};

export class ExtensionSandbox {
  private iframe: HTMLIFrameElement;
  private ready: Promise<void>;
  private runs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private seq = 0;
  private onMessage = (e: MessageEvent) => this.handle(e);

  constructor(private manifest: ExtensionManifest, private approved: ExtensionPermission[], private host: SandboxHostApi) {
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    this.iframe.setAttribute('aria-hidden', 'true');
    this.iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    let markReady: () => void = () => undefined;
    this.ready = new Promise((resolve) => (markReady = resolve));
    (this as any).markReady = markReady;
    window.addEventListener('message', this.onMessage);
    this.iframe.srcdoc = buildSandboxDocument(manifest.mainSource || '');
    document.body.appendChild(this.iframe);
  }

  private post(message: object) {
    this.iframe.contentWindow?.postMessage({ __omni: true, ...message }, '*');
  }

  private async handle(e: MessageEvent) {
    if (e.source !== this.iframe.contentWindow) return; // only our own sandbox
    const m = e.data;
    if (!m || !m.__omni) return;
    if (m.type === 'ready') return (this as any).markReady();
    if (m.type === 'run-result') {
      const run = this.runs.get(m.id);
      if (!run) return;
      this.runs.delete(m.id);
      window.clearTimeout(run.timer);
      if (m.ok) run.resolve(m.value);
      else run.reject(new Error(m.error));
      return;
    }
    if (m.type !== 'call') return;
    const reply = (ok: boolean, value?: unknown, error?: string) => this.post({ type: 'result', id: m.id, ok, value, error });
    const needed = METHOD_PERMISSION[m.method];
    if (needed === undefined) return reply(false, undefined, `Unknown method ${m.method}`);
    if (needed && !this.approved.includes(needed)) return reply(false, undefined, `Permission "${needed}" was not granted`);
    try {
      switch (m.method) {
        case 'scene.get':
          return reply(true, JSON.parse(JSON.stringify(this.host.getScene())));
        case 'scene.applyPatch':
          return reply(true, this.host.applyScenePatch(m.params?.patch, String(m.params?.label || this.manifest.name).slice(0, 80)));
        case 'library.list':
          return reply(true, await this.host.listLibrary());
        case 'net.fetch': {
          const url = new URL(String(m.params?.url || ''));
          if (url.protocol !== 'https:' || !(this.manifest.networkHosts || []).includes(url.host)) {
            return reply(false, undefined, `Host ${url.host} is not declared in networkHosts`);
          }
          const res = await fetch(url.toString(), { credentials: 'omit' });
          const text = await res.text();
          return reply(true, { status: res.status, text: text.slice(0, 1024 * 1024) });
        }
        case 'ui.notify':
          this.host.notify(`[${this.manifest.name}] ${String(m.params?.message || '').slice(0, 300)}`);
          return reply(true, null);
        case 'log':
          this.host.log(`[${this.manifest.name}] ${String(m.params?.message || '').slice(0, 500)}`);
          return reply(true, null);
      }
    } catch (err: any) {
      reply(false, undefined, err?.message || String(err));
    }
  }

  async run(commandId: string, args: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<unknown> {
    await Promise.race([this.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Extension did not start')), 5000))]);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.runs.delete(id);
        reject(new Error(`Command "${commandId}" timed out`));
      }, timeoutMs);
      this.runs.set(id, { resolve, reject, timer });
      this.post({ type: 'run', id, command: commandId, args });
    });
  }

  dispose() {
    window.removeEventListener('message', this.onMessage);
    for (const run of this.runs.values()) window.clearTimeout(run.timer);
    this.runs.clear();
    this.iframe.remove();
  }
}
