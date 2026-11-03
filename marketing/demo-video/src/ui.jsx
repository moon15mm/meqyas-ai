import { useId } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  bg: "#070b18",
  bg2: "#0d1430",
  panel: "rgba(17, 24, 54, 0.82)",
  panelSolid: "#111836",
  line: "rgba(148, 163, 255, 0.16)",
  text: "#eef1ff",
  dim: "#9aa3c7",
  faint: "#5d6690",
  indigo: "#6d72f6",
  indigoDeep: "#3b3fc4",
  teal: "#22b8cf",
  tealDeep: "#1f8fa3",
  green: "#34d399",
  red: "#fb7185",
  amber: "#fbbf24",
  violet: "#a78bfa",
};

export const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Current time in seconds (global — every scene receives absolute times). */
export function useTime() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0→1 between `a` and `a + d` (eased, clamped). */
export function ramp(t, a, d = 0.6) {
  return interpolate(t, [a, a + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

/** Scene envelope: fades in at `a`, out before `b`. */
export function envelope(t, a, b, fin = 0.45, fout = 0.4) {
  return Math.min(ramp(t, a, fin), 1 - ramp(t, b - fout, fout));
}

/** Fade + rise-in style for an element appearing at time `a`. */
export function rise(t, a, d = 0.6, dist = 28) {
  const p = ramp(t, a, d);
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}

/** Characters of `text` visible when typing from `a` at `cps` characters per second. */
export function typed(text, t, a, cps = 28) {
  const chars = Array.from(text);
  const n = Math.max(0, Math.min(chars.length, Math.floor((t - a) * cps)));
  return chars.slice(0, n).join("");
}

export function Scene({ t, range, children, style }) {
  const [a, b] = range;
  if (t < a - 0.05 || t > b + 0.05) return null;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: envelope(t, a, b), ...style }}>{children}</div>
  );
}

export function Kicker({ children, color = C.teal, style }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: 4,
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Title({ children, size = 76, style }) {
  return (
    <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.12, letterSpacing: -1, color: C.text, ...style }}>
      {children}
    </div>
  );
}

export function Panel({ children, style, glow }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 28,
        boxShadow: glow ? `0 0 0 1px ${glow}33, 0 30px 80px -20px ${glow}55` : "0 30px 80px -30px rgba(0,0,0,.6)",
        backdropFilter: "blur(8px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ children, color = C.indigo, style }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 18px",
        borderRadius: 999,
        background: `${color}22`,
        border: `1px solid ${color}66`,
        color,
        fontSize: 24,
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Arabic text block (RTL, Saudi customer voice). */
export function Arabic({ children, size = 52, style }) {
  return (
    <div dir="rtl" lang="ar" style={{ fontSize: size, lineHeight: 1.55, fontWeight: 500, color: C.text, ...style }}>
      {children}
    </div>
  );
}

/** Meqyas mark — gauge arc + rising bars (same geometry as apps/web BrandMark). */
export function MeqyasMark({ size = 80, arc = 1, bars = [1, 1, 1] }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const heights = [9, 13, 17];
  const xs = [13, 18.4, 23.8];
  const ops = [0.75, 0.9, 1];
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.indigoDeep} />
          <stop offset="1" stopColor={C.tealDeep} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}g)`} />
      <path
        d="M9 27a11 11 0 0 1 22 0"
        fill="none"
        stroke="#fff"
        strokeOpacity=".45"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="1 1"
        strokeDashoffset={1 - arc}
      />
      {xs.map((x, i) => {
        const h = heights[i] * Math.max(0, Math.min(1, bars[i] ?? 1));
        return h > 0.05 ? (
          <rect key={x} x={x} y={29 - h} width="3.2" height={h} rx="1.6" fill="#fff" fillOpacity={ops[i]} />
        ) : null;
      })}
    </svg>
  );
}

/** Python code card with simple, deterministic syntax colouring and per-line highlight. */
export function CodeCard({ excerpt, t, appear = 0, highlight = [], fontSize = 25, title, style, dimOthers = false }) {
  const keywords = /\b(def|class|return|if|and|or|not|from|import|for|in|None|True|False|self)\b/g;
  const colour = (line) => {
    const parts = [];
    const re = /("[^"]*"|#.*$|\b\d+(?:\.\d+)?\b|\b(?:def|class|return|if|and|or|not|from|import|for|in|None|True|False|self)\b)/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push([line.slice(last, m.index), C.text]);
      const tok = m[0];
      const col = tok.startsWith('"')
        ? "#86efac"
        : tok.startsWith("#")
          ? C.faint
          : /^\d/.test(tok)
            ? C.amber
            : keywords.test(tok)
              ? C.violet
              : C.text;
      keywords.lastIndex = 0;
      parts.push([tok, col]);
      last = m.index + tok.length;
    }
    if (last < line.length) parts.push([line.slice(last), C.text]);
    return parts;
  };
  return (
    <Panel style={{ padding: 0, overflow: "hidden", ...style }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 26px",
          borderBottom: `1px solid ${C.line}`,
          fontFamily: MONO,
          fontSize: 20,
          color: C.dim,
        }}
      >
        <span style={{ width: 13, height: 13, borderRadius: 99, background: "#ff5f57" }} />
        <span style={{ width: 13, height: 13, borderRadius: 99, background: "#febc2e" }} />
        <span style={{ width: 13, height: 13, borderRadius: 99, background: "#28c840" }} />
        <span style={{ marginLeft: 14 }}>{title ?? excerpt.path}</span>
      </div>
      <div style={{ padding: "18px 0", fontFamily: MONO, fontSize, lineHeight: 1.6 }}>
        {excerpt.lines.map((line, i) => {
          const n = excerpt.first_line + i;
          const hl = highlight.find((h) => n >= h.from && n <= h.to && t >= h.at);
          const p = hl ? ramp(t, hl.at, 0.4) : 0;
          const vis = ramp(t, appear + i * 0.035, 0.35);
          const dim = dimOthers && highlight.some((h) => t >= h.at) && !hl;
          return (
            <div
              key={n}
              style={{
                display: "flex",
                whiteSpace: "pre",
                opacity: vis * (dim ? 0.35 : 1),
                background: hl ? `rgba(34,184,207,${0.16 * p})` : "transparent",
                boxShadow: hl ? `inset 4px 0 0 rgba(34,184,207,${p})` : "none",
                padding: "0 26px",
              }}
            >
              <span style={{ width: 62, color: C.faint, flexShrink: 0, textAlign: "right", marginRight: 26 }}>{n}</span>
              <span>
                {colour(line).map(([s, col], k) => (
                  <span key={k} style={{ color: col }}>
                    {s}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function Arrow({ width = 120, p = 1, color = C.teal }) {
  return (
    <svg width={width} height="40" viewBox={`0 0 ${width} 40`} aria-hidden="true">
      <line
        x1="4"
        y1="20"
        x2={4 + (width - 22) * p}
        y2="20"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      {p > 0.95 ? <path d={`M${width - 22} 8 L${width - 4} 20 L${width - 22} 32`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}
