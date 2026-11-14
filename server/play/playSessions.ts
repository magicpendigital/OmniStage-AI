/**
 * Phase 6 batch 2 — "Play on phone": the studio (localhost only) uploads the exported playable HTML; phones on the
 * same Wi-Fi open http://<this computer's LAN IP>:<port>/play/<token>. Only that read-only HTML is reachable from
 * the LAN — the private workspace API stays localhost-only. Tokens are 128-bit random and expire.
 */
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { Express, Request } from 'express';
import QRCode from 'qrcode';
import { isLoopbackRequest } from '../ai/index';

interface PlaySession {
  html: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_HTML_BYTES = 30 * 1024 * 1024;
const sessions = new Map<string, PlaySession>();

function prune(now = Date.now()) {
  for (const [token, s] of sessions) if (s.expiresAt <= now) sessions.delete(token);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
}

export function createPlaySession(html: string, title: string, now = Date.now()): string {
  if (typeof html !== 'string' || !html.includes('<html')) throw new Error('html must be an exported OmniStage playable');
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('Playable is larger than 30 MB');
  prune(now);
  const token = randomBytes(16).toString('hex');
  sessions.set(token, { html, title: String(title || 'OmniStage').slice(0, 80), createdAt: now, expiresAt: now + SESSION_TTL_MS, hits: 0 });
  return token;
}

export function getPlaySession(token: string, now = Date.now()): PlaySession | null {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const s = sessions.get(token);
  if (!s || s.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/** Private-network IPv4 addresses of this computer, most likely Wi-Fi/LAN first. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

function portOf(req: Request): string {
  const host = String(req.headers.host || '');
  const m = /:(\d+)$/.exec(host);
  return m ? m[1] : String(process.env.PORT || 3000);
}

export function registerPlayRoutes(app: Express) {
  // Studio → server (this computer only).
  app.post('/api/play/session', async (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(403).json({ error: 'Phone preview sessions can only be created on this computer.' });
      return;
    }
    try {
      const token = createPlaySession(req.body?.html, req.body?.title);
      const port = portOf(req);
      const urls = lanAddresses().map((ip) => `http://${ip}:${port}/play/${token}`);
      const qrs = await Promise.all(urls.map((u) => QRCode.toString(u, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })));
      res.json({ token, urls, qrs, expiresInMinutes: SESSION_TTL_MS / 60000, localUrl: `http://localhost:${port}/play/${token}` });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not create a play session' });
    }
  });

  // Phone → server (LAN). Read-only, token-gated, expires.
  app.get('/play/:token', (req, res) => {
    const session = getPlaySession(req.params.token);
    if (!session) {
      res.status(404).type('text/plain').send('This OmniStage preview link has expired. Create a new one from Play Test → Play on phone.');
      return;
    }
    session.hits += 1;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.type('html').send(session.html);
  });
}
