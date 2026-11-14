/**
 * Phase 5 — Captions / subtitles: active cue lookup, canvas drawing and WebVTT / SRT export.
 * `drawCaptionOnCanvas` is inlined into exported playables via toString(), so keep it self-contained.
 */
import type { CaptionCue } from '../types/scene.schema';

export function activeCaptions(captions: CaptionCue[] | undefined, time: number): CaptionCue[] {
  return (captions || []).filter((c) => time >= c.start && time < c.end && c.text.trim());
}

/** Draws one cue with a readable backing box. Coordinates are in the canvas design space (w × h). */
export function drawCaptionOnCanvas(ctx: any, cue: { text: string; position?: string; style?: string }, w: number, h: number): void {
  var isTitle = cue.style === 'title';
  var fontSize = isTitle ? Math.round(h * 0.075) : Math.round(h * 0.042);
  ctx.save();
  ctx.font = (isTitle ? '800 ' : '600 ') + fontSize + 'px "Space Grotesk", Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  var maxWidth = w * 0.84;
  var words = String(cue.text).split(/\s+/);
  var lines: string[] = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines = lines.slice(0, 3);
  var lineH = fontSize * 1.25;
  var blockH = lines.length * lineH;
  var cy = cue.position === 'top' ? h * 0.1 + blockH / 2 : cue.position === 'center' ? h / 2 : h * 0.9 - blockH / 2;
  var widest = 0;
  for (var j = 0; j < lines.length; j++) widest = Math.max(widest, ctx.measureText(lines[j]).width);
  if (!isTitle) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(w / 2 - widest / 2 - fontSize * 0.6, cy - blockH / 2 - fontSize * 0.3, widest + fontSize * 1.2, blockH + fontSize * 0.6);
  }
  for (var k = 0; k < lines.length; k++) {
    var y = cy - blockH / 2 + lineH * (k + 0.5);
    if (isTitle) {
      ctx.lineWidth = Math.max(3, fontSize * 0.12);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.strokeText(lines[k], w / 2, y);
    }
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(lines[k], w / 2, y);
  }
  ctx.restore();
}

function stamp(seconds: number, sep: '.' | ','): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

function sorted(captions: CaptionCue[]): CaptionCue[] {
  return [...captions].filter((c) => c.end > c.start && c.text.trim()).sort((a, b) => a.start - b.start);
}

/** Captions of several scenes can be concatenated by passing an offset per scene. */
export function captionsToWebVTT(captions: CaptionCue[], offsetSeconds = 0): string {
  const body = sorted(captions)
    .map((c, i) => {
      const settings = c.position === 'top' ? ' line:10%' : c.position === 'center' ? ' line:50%' : '';
      return `${c.id || `cue-${i + 1}`}\n${stamp(c.start + offsetSeconds, '.')} --> ${stamp(c.end + offsetSeconds, '.')}${settings}\n${c.text.trim()}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

export function captionsToSRT(captions: CaptionCue[], offsetSeconds = 0): string {
  return sorted(captions)
    .map((c, i) => `${i + 1}\n${stamp(c.start + offsetSeconds, ',')} --> ${stamp(c.end + offsetSeconds, ',')}\n${c.text.trim()}\n`)
    .join('\n');
}

/** Splits a script into evenly timed caption cues across `duration` seconds (used by the offline director). */
export function captionsFromScript(script: string, duration: number): CaptionCue[] {
  const sentences = script
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!sentences.length) return [];
  const slot = Math.max(0.8, duration / sentences.length);
  return sentences.map((text, i) => ({
    id: `cap-${i + 1}`,
    start: Number((i * slot).toFixed(2)),
    end: Number(Math.min(duration, (i + 1) * slot - 0.1).toFixed(2)),
    text,
    position: 'bottom' as const,
    style: 'subtitle' as const,
  }));
}
