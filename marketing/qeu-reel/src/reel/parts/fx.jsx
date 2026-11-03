import { clamp, ease, fadeWindow, hash, interp, lerp, noise, prog, pulseAt, tick } from "../anim.js";
import { HEARTBEATS, T } from "../timeline.js";

/* ---------------------------------------------------------------- colour mixing */

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function mixHex(a, b, p) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], p))).join(",")})`;
}

/** Scene mood palette: [time, colourA, colourB, intensity] — crossfaded between keys. */
const MOODS = [
  [0, "#f43f5e", "#f59e0b", 0.42],
  [4.6, "#f43f5e", "#f59e0b", 0.42],
  [5.1, "#ef4444", "#1d9bf0", 0.36],
  [9.95, "#ef4444", "#1d9bf0", 0.4],
  [10.15, "#7c3aed", "#06b6d4", 0.5],
  [16.9, "#7c3aed", "#06b6d4", 0.5],
  [17.4, "#10b981", "#7c3aed", 0.42],
  [25.9, "#10b981", "#7c3aed", 0.42],
  [26.4, "#facc15", "#10b981", 0.36],
  [30.9, "#facc15", "#10b981", 0.44],
  [31.2, "#3b3fc4", "#1f8fa3", 0.7],
  [35, "#3b3fc4", "#1f8fa3", 0.7],
];

function moodAt(t) {
  let i = 0;
  while (i < MOODS.length - 2 && t >= MOODS[i + 1][0]) i++;
  const [t0, a0, b0, k0] = MOODS[i];
  const [t1, a1, b1, k1] = MOODS[i + 1];
  const p = clamp((t - t0) / (t1 - t0));
  return { a: mixHex(a0, a1, p), b: mixHex(b0, b1, p), k: lerp(k0, k1, p) };
}

/* ---------------------------------------------------------------------- layers */

/* Performance: everything that moves every frame moves with `transform`/`opacity` on its own
 * compositor layer, so the GPU only re-composites — nothing forces a full-frame repaint. */

function Blob({ color, x, y, r, opacity }) {
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        width: r * 2,
        height: r * 2,
        transform: `translate(${x - r}px, ${y - r}px)`,
        background: `radial-gradient(closest-side, ${color}, transparent 70%)`,
        opacity,
        willChange: "transform, opacity",
      }}
    />
  );
}

export function Backdrop({ t }) {
  const { a, b, k } = moodAt(t);
  const grid = Math.max(fadeWindow(t, 10.05, 17.0, 0.4, 0.4) * 0.55, fadeWindow(t, 31.05, 36, 0.5, 0) * 0.35);
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#05050a" }}>
      <Blob
        color={a}
        x={260 + noise(t * 0.25, 1) * 120}
        y={420 + noise(t * 0.2, 2) * 140}
        r={620}
        opacity={k}
      />
      <Blob
        color={b}
        x={820 + noise(t * 0.22, 3) * 120}
        y={1450 + noise(t * 0.18, 4) * 160}
        r={700}
        opacity={k}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(900px 1300px at 50% 45%, rgba(255,255,255,.05), transparent 70%)",
        }}
      />
      {grid > 0 ? (
        <div
          className="absolute overflow-hidden"
          style={{
            left: -540,
            right: -540,
            bottom: -200,
            height: 900,
            opacity: grid,
            transform: "perspective(700px) rotateX(62deg)",
            transformOrigin: "50% 100%",
          }}
        >
          <div
            className="absolute inset-x-0"
            style={{
              top: -90,
              height: 990,
              backgroundImage:
                "linear-gradient(rgba(167,139,250,.55) 2px, transparent 2px), linear-gradient(90deg, rgba(167,139,250,.55) 2px, transparent 2px)",
              backgroundSize: "90px 90px",
              transform: `translateY(${(t * 120) % 90}px)`,
              willChange: "transform",
            }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, #05050a 8%, transparent 75%)" }}
          />
        </div>
      ) : null}
      <Dust t={t} />
    </div>
  );
}

function Dust({ t }) {
  return (
    <div className="absolute inset-0" style={{ willChange: "transform" }}>
      {Array.from({ length: 20 }, (_, i) => {
        const x = hash(i * 3.1) * 1080 + noise(t * 0.4 + i, i) * 30;
        const speed = 18 + hash(i * 7.7) * 40;
        const y = 1920 - ((t * speed + hash(i * 5.3) * 1920) % 1980);
        const s = 2 + hash(i * 1.9) * 4;
        return (
          <div
            key={i}
            className="absolute top-0 left-0 rounded-full"
            style={{
              width: s,
              height: s,
              background: "#fff",
              opacity: 0.08 + hash(i * 2.3) * 0.22,
              transform: `translate(${x}px, ${y}px)`,
            }}
          />
        );
      })}
    </div>
  );
}

// White specks with noise-driven alpha: reads as film grain with normal blending (no blend mode).
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.7 0 0 0 -0.62'/></filter><rect width='256' height='256' filter='url(%23n)'/></svg>\")";

/** `animated` re-seeds 12×/s (player); `static` keeps one texture — same look, far smaller H.264 files. */
export function Grain({ t, animated = true }) {
  const f = animated ? tick(t, 12) : 7;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        style={{
          position: "absolute",
          left: -256,
          top: -256,
          width: 1080 + 512,
          height: 1920 + 512,
          backgroundImage: GRAIN,
          backgroundSize: "256px 256px",
          opacity: 0.5,
          transform: `translate(${Math.floor(hash(f) * 256)}px, ${Math.floor(hash(f + 0.5) * 256)}px)`,
          willChange: "transform",
        }}
      />
    </div>
  );
}

export function Vignette({ t }) {
  const beat = t < 5 || (t > 8 && t < 10) ? pulseAt(t, HEARTBEATS, 0.32) : 0;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 70% at 50% 48%, transparent 55%, rgba(0,0,0,.72) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 72% 62% at 50% 48%, transparent 45%, rgba(239,68,68,.8) 100%)",
          opacity: 0.85 * beat,
          willChange: "opacity",
        }}
      />
    </>
  );
}

/** White/coloured flashes on the hard cuts. */
export function Flash({ t }) {
  const hits = [
    [T.boxLand, 0.18, "#fff", 0.22],
    [T.crash, 0.2, "#fde68a", 0.45],
    [T.zoom1, 0.16, "#ef4444", 0.35],
    [T.zoom2, 0.16, "#ef4444", 0.35],
    [T.zoom3, 0.22, "#ef4444", 0.45],
    [T.freeze, 0.26, "#e0f2fe", 0.85],
    [T.unfreeze, 0.22, "#c4b5fd", 0.5],
    [T.posted, 0.3, "#fef9c3", 0.45],
    [T.sting, 0.35, "#e0e7ff", 0.6],
  ];
  let v = 0;
  let color = "#fff";
  for (const [at, d, c, peak] of hits) {
    const p = (t - at) / d;
    if (p >= 0 && p < 1) {
      const a = (1 - p) * peak;
      if (a > v) {
        v = a;
        color = c;
      }
    }
  }
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ background: color, opacity: v, willChange: "opacity" }}
    />
  );
}

/* --------------------------------------------------------------- matrix / glitch */

const GLYPHS = "مقياسAIنبضرصدثقةكيو٠١٢٣٤٥٦٧٨٩01ابتجحخدذرزشصضطظعغفلهوي◆▲●";

export function DigitalRain({ t, opacity = 1, columns = 14 }) {
  if (opacity <= 0) return null;
  const frame = tick(t, 5);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: columns }, (_, i) => {
        const len = 12 + Math.floor(hash(i * 9.1) * 12);
        const speed = 380 + hash(i * 4.4) * 520;
        const lineH = 54;
        const span = len * lineH;
        const y = ((t * speed + hash(i * 2.2) * 2400) % (1920 + span)) - span;
        const violet = hash(i * 1.3) > 0.45;
        return (
          <div
            key={i}
            className="absolute top-0 left-0 flex flex-col items-center"
            style={{
              width: 44,
              transform: `translate(${(i + 0.5) * (1080 / columns) - 22 + (hash(i * 6.6) - 0.5) * 20}px, ${y}px)`,
              fontFamily: "var(--font-mono)",
              fontSize: 38,
              fontWeight: 700,
              lineHeight: `${lineH}px`,
              color: violet ? "#a78bfa" : "#34d399",
              opacity,
              willChange: "transform, opacity",
            }}
          >
            {Array.from({ length: len }, (_, k) => {
              const head = k === len - 1;
              const g =
                GLYPHS[
                  Math.floor(hash(i * 31 + k * 7 + Math.floor((frame + k * 3) / 2) * 0.37) * GLYPHS.length)
                ];
              return (
                <span
                  key={k}
                  style={
                    head
                      ? { color: "#f5f3ff", textShadow: "0 0 14px #fff" }
                      : { opacity: 0.12 + 0.75 * (k / (len - 1)) }
                  }
                >
                  {g}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function Scanlines({ t, opacity = 1 }) {
  if (opacity <= 0) return null;
  const bar = ((t * 520) % 2400) - 240;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,.055) 0 2px, transparent 2px 6px)",
          opacity,
          willChange: "opacity",
        }}
      />
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: 160,
          background: "linear-gradient(to bottom, transparent, rgba(167,139,250,.16), transparent)",
          opacity,
          transform: `translateY(${bar}px)`,
          willChange: "transform",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ celebrations */

const CONFETTI = ["#34d399", "#a78bfa", "#facc15", "#f472b6", "#38bdf8", "#ffffff"];

export function Confetti({ t, t0, count = 70, x0 = 540, y0 = 1250, spread = 1 }) {
  const age = t - t0;
  if (age < 0 || age > 2.4) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const ang = (-90 + (hash(i * 1.7) - 0.5) * 150 * spread) * (Math.PI / 180);
        const v = 900 + hash(i * 3.3) * 1300;
        const x = x0 + Math.cos(ang) * v * age + Math.sin(age * 4 + i) * 30;
        const y = y0 + Math.sin(ang) * v * age + 0.5 * 2600 * age * age;
        const rot = age * (400 + hash(i * 2.9) * 600) * (i % 2 ? 1 : -1);
        const w = 14 + hash(i * 5.1) * 16;
        const round = i % 4 === 0;
        return (
          <div
            key={i}
            className="absolute top-0 left-0"
            style={{
              width: w,
              height: round ? w : w * 0.45,
              borderRadius: round ? "50%" : 3,
              background: CONFETTI[i % CONFETTI.length],
              opacity: clamp(1.6 - age * 0.7),
              transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scaleY(${Math.cos(rot * 0.023).toFixed(3)})`,
            }}
          />
        );
      })}
    </div>
  );
}

const SPARK =
  "M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1 Z";

/** Twinkling 4-point stars around (x, y). */
export function Sparkles({ t, t0, x, y, radius = 140, count = 10, color = "#fde68a", duration = 1.4 }) {
  const age = t - t0;
  if (age < 0 || age > duration + 0.6) return null;
  return (
    <svg
      className="pointer-events-none absolute"
      style={{
        left: x - radius * 1.4,
        top: y - radius * 1.4,
        width: radius * 2.8,
        height: radius * 2.8,
        overflow: "visible",
      }}
      viewBox={`${-radius * 1.4} ${-radius * 1.4} ${radius * 2.8} ${radius * 2.8}`}
    >
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + hash(i) * 0.6;
        const d = radius * (0.55 + hash(i * 3.7) * 0.6) * ease.outCubic(clamp(age / 0.5));
        const local = age - hash(i * 2.1) * 0.35;
        const tw =
          local > 0
            ? Math.sin(clamp(local / duration) * Math.PI) * (0.75 + 0.25 * Math.sin(local * 22 + i))
            : 0;
        const s = (14 + hash(i * 4.9) * 22) * tw;
        return s > 0.5 ? (
          <path
            key={i}
            d={SPARK}
            transform={`translate(${Math.cos(a) * d} ${Math.sin(a) * d}) scale(${s}) rotate(${age * 90})`}
            fill={color}
          />
        ) : null;
      })}
    </svg>
  );
}

/** Small helper: opacity + travel for things that slide in. */
export function slideIn(t, t0, dur = 0.45, dist = 60) {
  const p = ease.outCubic(prog(t, t0, t0 + dur));
  return { opacity: p, dy: (1 - p) * dist };
}

export { interp };
