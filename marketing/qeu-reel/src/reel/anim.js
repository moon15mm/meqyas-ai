/**
 * Deterministic animation kit: every value is a pure function of time, so any frame can be
 * rendered on its own (scrubbing in the player, frame-by-frame rendering in Remotion).
 */

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, p) => a + (b - a) * p;

/** 0 → 1 as t goes from start to end (clamped). */
export const prog = (t, start, end) => clamp((t - start) / (end - start));

export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  outBack: (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  inBack: (x) => {
    const c1 = 1.70158;
    return (c1 + 1) * x * x * x - c1 * x * x;
  },
};

/** Keyframes: interp(t, [t0, t1, …], [v0, v1, …], easing) — clamped at both ends. */
export function interp(t, times, values, easing = ease.inOutCubic) {
  if (t <= times[0]) return values[0];
  const last = times.length - 1;
  if (t >= times[last]) return values[last];
  let i = 0;
  while (t > times[i + 1]) i++;
  const p = (t - times[i]) / (times[i + 1] - times[i]);
  return lerp(values[i], values[i + 1], easing(p));
}

/**
 * Damped spring from 0 → 1 that starts at t0 (closed-form, no state).
 * Same parameters as Framer Motion / Remotion springs.
 */
export function spring(t, t0, { stiffness = 170, damping = 15, mass = 1 } = {}) {
  const x = t - t0;
  if (x <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * x) * (Math.cos(wd * x) + ((zeta * w0) / wd) * Math.sin(wd * x));
  }
  return 1 - Math.exp(-w0 * x) * (1 + w0 * x);
}

/** Opacity for an element shown in [start, end] with fades. */
export function fadeWindow(t, start, end, fadeIn = 0.18, fadeOut = 0.18) {
  if (t < start || t > end) return 0;
  const a = fadeIn > 0 ? clamp((t - start) / fadeIn) : 1;
  const b = fadeOut > 0 ? clamp((end - t) / fadeOut) : 1;
  return Math.min(a, b);
}

/** Smooth deterministic 1-D value noise in [-1, 1]. */
export function noise(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 57.31), hash(i + 1 + seed * 57.31), u) * 2 - 1;
}

/** Hash → [0, 1). */
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Camera shake that decays after `start`: returns {x, y, r}. */
export function shake(t, start, duration, amp = 20, freq = 28, seed = 1) {
  const p = (t - start) / duration;
  if (p < 0 || p > 1) return { x: 0, y: 0, r: 0 };
  const k = Math.pow(1 - p, 2) * amp;
  return {
    x: noise(t * freq, seed) * k,
    y: noise(t * freq, seed + 3) * k,
    r: noise(t * freq * 0.7, seed + 7) * k * 0.05,
  };
}

/** Sum several shakes. */
export function addShakes(...list) {
  return list.reduce((a, s) => ({ x: a.x + s.x, y: a.y + s.y, r: a.r + s.r }), { x: 0, y: 0, r: 0 });
}

/** Pop-in scale (overshoot) starting at t0; 0 before. */
export function pop(t, t0, opts = { stiffness: 260, damping: 14 }) {
  return spring(t, t0, opts);
}

/** Pulse (0 → 1 → 0) around each time in `times`, `width` seconds wide. */
export function pulseAt(t, times, width = 0.25) {
  let v = 0;
  for (const b of times) {
    const d = t - b;
    if (d >= 0 && d < width) v = Math.max(v, 1 - d / width);
  }
  return v;
}

/** Frame-stable integer (changes `rate` times per second). */
export const tick = (t, rate = 30) => Math.floor(t * rate + 1e-6);
