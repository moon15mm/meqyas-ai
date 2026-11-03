import { useId } from "react";

const svgId = (raw) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * مِقياس AI mark — the gauge arc + rising bars from apps/web (BrandMark), with optional
 * draw-on progress for the outro: `arc` 0→1 draws the gauge, `bars` 0→1 raises each bar.
 */
export function MeqyasMark({ size = 80, arc = 1, bars = [1, 1, 1], style, className }) {
  const id = svgId(useId());
  const heights = [9, 13, 17];
  const xs = [13, 18.4, 23.8];
  const ops = [0.75, 0.9, 1];
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      style={style}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3fc4" />
          <stop offset="1" stopColor="#1f8fa3" />
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

/** كِيو QEU — the delivery app's mark (fictional brand for this ad). */
export function QeuMark({ size = 80, style }) {
  const id = svgId(useId());
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}q`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}q)`} />
      <circle cx="19.5" cy="19" r="8.2" fill="none" stroke="#fff" strokeWidth="3.6" />
      <path d="M23.8 23.4 30 29.6" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <path
        d="M4.5 15h4M3.5 19h4.5M4.5 23h4"
        stroke="#ecfdf5"
        strokeOpacity=".7"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function XLogo({ size = 24, color = "#fff", style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={style} aria-hidden="true">
      <path
        fill={color}
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

/** Generic green chat-bubble glyph standing in for WhatsApp. */
export function WhatsAppGlyph({ size = 40, style }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={style} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#25d366" />
      <path
        d="M20 8.5a11.5 11.5 0 0 0-9.9 17.3L8.6 31.4l5.8-1.5A11.5 11.5 0 1 0 20 8.5z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M16.3 14.6c.4-.1.8 0 1 .4l1 2.3c.1.3 0 .7-.2.9l-.8.8c.7 1.5 1.9 2.7 3.4 3.4l.8-.8c.2-.2.6-.3.9-.2l2.3 1c.4.2.5.6.4 1-.4 1.4-1.6 2.2-3 2-3.9-.6-6.9-3.6-7.5-7.5-.2-1.4.6-2.6 2-3z"
        fill="#fff"
      />
    </svg>
  );
}

export function VerifiedBadge({ size = 18, color = "#1d9bf0", style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={style} aria-hidden="true">
      <path
        fill={color}
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
      />
      <path fill="#fff" d="m10.54 16.4-3.75-3.74 1.42-1.41 2.33 2.33 5.24-5.24 1.42 1.41z" />
    </svg>
  );
}
