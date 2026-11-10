/**
 * Phase 5 — Procedural 2D particle presets (pixelfx-inspired, implemented from scratch).
 *
 * Particles are a pure function of (preset, seed, time): nothing is simulated frame-to-frame, so the timeline
 * can be paused / scrubbed and recorded video is reproducible. `createParticle2DRuntime` must stay
 * self-contained — the playable exporter inlines it with toString().
 */

export interface Particle2D {
  x: number;
  y: number;
  size: number;
  rotation: number;
  alpha: number;
  color: string;
  shape: string;
}

export interface Particle2DRuntime {
  presets: string[];
  particlesAt: (presetId: string, seed: number, time: number, width: number, height: number, rate?: number, color?: string) => Particle2D[];
  draw: (ctx: any, presetId: string, seed: number, time: number, width: number, height: number, rate?: number, color?: string) => number;
}

export function createParticle2DRuntime(extraPresets?: Record<string, any>): Particle2DRuntime {
  // speed px/s, angle degrees (0 = right, 90 = down), gravity px/s², life seconds.
  var PRESETS: Record<string, any> = {
    sparkle: { rate: 18, life: 1.1, speed: [15, 60], angle: [0, 360], gravity: -12, size: [3, 7], shape: 'star', colors: ['#FDE68A', '#FFFFFF', '#FBBF24'], fade: true, spread: 0.25 },
    confetti: { rate: 38, life: 2.2, speed: [140, 280], angle: [-125, -55], gravity: 300, size: [5, 9], shape: 'rect', colors: ['#F472B6', '#22D3EE', '#FACC15', '#A78BFA', '#34D399'], spin: 8, fade: true, spread: 0.1 },
    fire: { rate: 46, life: 0.9, speed: [30, 85], angle: [-105, -75], gravity: -70, size: [7, 15], shape: 'circle', colors: ['#F97316', '#FACC15', '#EF4444'], shrink: true, additive: true, spread: 0.3 },
    smoke: { rate: 12, life: 2.6, speed: [10, 32], angle: [-100, -80], gravity: -14, size: [10, 20], shape: 'circle', colors: ['#64748B', '#94A3B8'], grow: true, fade: true, alpha: 0.35, spread: 0.3 },
    rain: { rate: 110, life: 0.9, speed: [620, 720], angle: [100, 104], gravity: 0, size: [10, 18], shape: 'line', colors: ['#93C5FD'], alpha: 0.6, area: true },
    snow: { rate: 36, life: 4.2, speed: [26, 55], angle: [80, 100], gravity: 0, size: [2, 5], shape: 'circle', colors: ['#FFFFFF', '#E0F2FE'], alpha: 0.9, drift: 18, area: true },
    'pixel-burst': { rate: 70, life: 0.75, speed: [90, 240], angle: [0, 360], gravity: 260, size: [4, 7], shape: 'pixel', colors: ['#22D3EE', '#A78BFA', '#F472B6', '#FACC15'], burst: 0.6, fade: true },
    'magic-trail': { rate: 30, life: 1.4, speed: [8, 36], angle: [0, 360], gravity: -24, size: [3, 7], shape: 'circle', colors: ['#C084FC', '#22D3EE', '#F0ABFC'], shrink: true, additive: true, orbit: 0.45 },
  };
  // Phase 6: presets contributed by extensions (copied into SceneSpec.particleLibrary so exports stay self-contained).
  if (extraPresets) for (var key in extraPresets) if (!PRESETS[key]) PRESETS[key] = extraPresets[key];
  var MAX_PARTICLES = 420;

  function rand(seed: number, i: number, k: number): number {
    var h = (seed * 374761393 + i * 668265263 + k * 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function lerp(range: number[], t: number): number {
    return range[0] + (range[1] - range[0]) * t;
  }

  function particlesAt(presetId: string, seed: number, time: number, width: number, height: number, rate?: number, color?: string): Particle2D[] {
    var p = PRESETS[presetId] || PRESETS.sparkle;
    var r = rate && rate > 0 ? rate : p.rate;
    var out: Particle2D[] = [];
    var t = Math.max(0, time);
    var first: number, last: number, cycleStart = 0;
    if (p.burst) {
      // All particles of a burst spawn together; the burst repeats every life + pause seconds.
      var period = p.life + p.burst;
      cycleStart = Math.floor(t / period) * period;
      first = 0;
      last = Math.max(1, Math.round(r * 0.5)) - 1;
    } else {
      first = Math.max(0, Math.floor((t - p.life) * r));
      last = Math.floor(t * r);
    }
    for (var i = first; i <= last && out.length < MAX_PARTICLES; i++) {
      var id = p.burst ? i + Math.floor(cycleStart * 1000) : i;
      var born = p.burst ? cycleStart : i / r;
      var age = t - born;
      if (age < 0 || age > p.life) continue;
      var u = age / p.life;
      var ang = (lerp(p.angle, rand(seed, id, 1)) * Math.PI) / 180;
      var spd = lerp(p.speed, rand(seed, id, 2));
      var x0 = p.area ? (rand(seed, id, 3) - 0.5) * width : (rand(seed, id, 3) - 0.5) * width * (p.spread || 0);
      var y0 = p.area ? -height / 2 : (rand(seed, id, 4) - 0.5) * height * (p.spread || 0);
      var x = x0 + Math.cos(ang) * spd * age;
      var y = y0 + Math.sin(ang) * spd * age + 0.5 * (p.gravity || 0) * age * age;
      if (p.drift) x += Math.sin(age * 2 + id) * p.drift;
      if (p.orbit) {
        var orb = p.orbit * Math.min(width, height);
        x += Math.cos(age * 3 + id) * orb * (1 - u);
        y += Math.sin(age * 3 + id) * orb * (1 - u);
      }
      var size = lerp(p.size, rand(seed, id, 5));
      if (p.shrink) size *= 1 - u * 0.85;
      if (p.grow) size *= 1 + u * 1.5;
      var alpha = p.alpha !== undefined ? p.alpha : 1;
      if (p.fade || p.shrink || p.grow) alpha *= 1 - u;
      out.push({
        x: x,
        y: y,
        size: Math.max(0.5, size),
        rotation: (p.spin || 0) * age + rand(seed, id, 6) * Math.PI,
        alpha: Math.max(0, Math.min(1, alpha)),
        color: color || p.colors[Math.floor(rand(seed, id, 7) * p.colors.length) % p.colors.length],
        shape: p.shape,
      });
    }
    return out;
  }

  function draw(ctx: any, presetId: string, seed: number, time: number, width: number, height: number, rate?: number, color?: string): number {
    var p = PRESETS[presetId] || PRESETS.sparkle;
    var list = particlesAt(presetId, seed, time, width, height, rate, color);
    ctx.save();
    if (p.additive) ctx.globalCompositeOperation = 'lighter';
    var baseAlpha = ctx.globalAlpha;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      ctx.globalAlpha = baseAlpha * q.alpha;
      ctx.fillStyle = q.color;
      ctx.strokeStyle = q.color;
      if (q.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (q.shape === 'line') {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.size * 0.15, q.y - q.size);
        ctx.stroke();
      } else if (q.shape === 'pixel') {
        var s = Math.round(q.size);
        ctx.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s);
      } else if (q.shape === 'star') {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rotation);
        ctx.fillRect(-q.size / 2, -q.size / 8, q.size, q.size / 4);
        ctx.fillRect(-q.size / 8, -q.size / 2, q.size / 4, q.size);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rotation);
        ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
        ctx.restore();
      }
    }
    ctx.restore();
    return list.length;
  }

  return { presets: Object.keys(PRESETS), particlesAt: particlesAt, draw: draw };
}

export const PARTICLE_2D_PRESETS = createParticle2DRuntime().presets;

const runtimeCache = new Map<string, Particle2DRuntime>();

/** Runtime including a scene's extension presets (cached per library). */
export function particleRuntimeFor(library?: Record<string, unknown>): Particle2DRuntime {
  const key = library && Object.keys(library).length ? JSON.stringify(library) : '';
  let rt = runtimeCache.get(key);
  if (!rt) {
    rt = createParticle2DRuntime(key ? (library as Record<string, any>) : undefined);
    if (runtimeCache.size > 20) runtimeCache.clear();
    runtimeCache.set(key, rt);
  }
  return rt;
}
