import { useId } from "react";

import { clamp } from "../anim.js";

const svgId = (raw) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

const INK = "#1d120b";
const SKIN = "#d9a577";

/**
 * Mood → face parts. Moods: happy · shock · angry · furious · curious · amazed · delight.
 */
const MOODS = {
  happy: { brows: "raised", eyes: "happy", mouth: "grin", blush: true },
  shock: { brows: "raised", eyes: "wide", mouth: "o", sweat: true },
  angry: { brows: "angry", eyes: "narrow", mouth: "grit", vein: true },
  furious: { brows: "angry", eyes: "narrow", mouth: "yell", vein: true, steam: true },
  curious: { brows: "neutral", eyes: "open", mouth: "flat" },
  amazed: { brows: "raised", eyes: "wide", mouth: "grin", blush: true },
  delight: { brows: "raised", eyes: "star", mouth: "bigGrin", blush: true },
};

const BROWS = {
  neutral: ["M90 108 Q101 102 112 106", "M128 106 Q139 102 150 108"],
  raised: ["M89 101 Q101 92 112 99", "M128 99 Q139 92 151 101"],
  angry: ["M89 100 Q101 104 113 111", "M127 111 Q139 104 151 100"],
};

const STAR = "M0 -11 L3.2 -3.6 L11 -3.4 L4.8 1.6 L7 9.4 L0 4.8 L-7 9.4 L-4.8 1.6 L-11 -3.4 L-3.2 -3.6 Z";

function Eye({ cx, cy, kind, blink, side, t }) {
  if (kind === "happy") {
    return (
      <path
        d={`M${cx - 8} ${cy + 2} Q${cx} ${cy - 7} ${cx + 8} ${cy + 2}`}
        stroke={INK}
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  if (kind === "star") {
    const s = 1 + 0.12 * Math.sin(t * 14 + side);
    return (
      <g transform={`translate(${cx} ${cy}) scale(${s}) rotate(${(t * 40 + side * 20) % 360})`}>
        <path d={STAR} fill="#fde047" stroke="#ca8a04" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
    );
  }
  const wide = kind === "wide";
  const rx = wide ? 10.5 : 8.5;
  const ry = wide ? 11.5 : 7.5;
  const pupil = wide ? 3.3 : 4.6;
  const squash = blink ? 0.12 : 1;
  return (
    <g transform={`translate(${cx} ${cy}) scale(1 ${squash})`}>
      <ellipse rx={rx} ry={ry} fill="#fff" stroke={INK} strokeWidth="1.6" />
      <circle cx={side * 0.6} r={pupil} fill="#2a1a10" />
      <circle cx={side * 0.6 + 1.5} cy={-1.8} r={1.4} fill="#fff" />
      {kind === "narrow" ? (
        <>
          <path
            d={side < 0 ? "M-12 -9 L13 -3 L13 -14 L-12 -14 Z" : "M-13 -3 L12 -9 L12 -14 L-13 -14 Z"}
            fill={SKIN}
          />
          <path
            d={side < 0 ? "M-11 -8.5 L12 -3" : "M-12 -3 L11 -8.5"}
            stroke={INK}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </g>
  );
}

function Mouth({ kind }) {
  switch (kind) {
    case "grin":
      return (
        <g>
          <path d="M103 158 Q120 160 137 158 Q134 178 120 179 Q106 178 103 158 Z" fill="#3b0f12" />
          <path d="M106 159.5 Q120 161.5 134 159.5 L133 164 Q120 166 107 164 Z" fill="#fff" />
          <ellipse cx="120" cy="173" rx="8" ry="4" fill="#e0626b" />
        </g>
      );
    case "o":
      return (
        <g>
          <ellipse cx="120" cy="168" rx="8.5" ry="11" fill="#2b0b0e" />
          <ellipse cx="120" cy="174" rx="5" ry="3" fill="#e0626b" />
        </g>
      );
    case "grit":
      return (
        <g>
          <rect
            x="103"
            y="158"
            width="34"
            height="12"
            rx="5"
            fill="#fff"
            stroke="#3b0f12"
            strokeWidth="2.5"
          />
          <path d="M103 164h34M111 158v12M120 158v12M129 158v12" stroke="#3b0f12" strokeWidth="1.6" />
        </g>
      );
    case "yell":
      return (
        <g>
          <path d="M100 156 Q120 152 140 156 Q138 187 120 189 Q102 187 100 156 Z" fill="#2b0b0e" />
          <path d="M103 157 Q120 154 137 157 L136 162 Q120 160 104 162 Z" fill="#fff" />
          <ellipse cx="120" cy="181" rx="10" ry="5" fill="#e0626b" />
        </g>
      );
    case "bigGrin":
      return (
        <g>
          <path d="M98 154 Q120 158 142 154 Q138 185 120 187 Q102 185 98 154 Z" fill="#3b0f12" />
          <path d="M101 155.5 Q120 159 139 155.5 L137.5 162 Q120 165 102.5 162 Z" fill="#fff" />
          <ellipse cx="120" cy="178" rx="11" ry="5" fill="#e0626b" />
        </g>
      );
    case "flat":
      return (
        <path
          d="M108 165 Q120 168 132 165"
          stroke="#3b1414"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      );
    default:
      return (
        <path
          d="M106 162 Q120 172 134 162"
          stroke="#3b1414"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      );
  }
}

function Iqal({ lift }) {
  return (
    <g
      transform={`translate(0 ${-36 * lift}) rotate(${-7 * lift} 120 60)`}
      style={lift > 0 ? { filter: `drop-shadow(0 0 ${10 * lift}px rgba(253,224,71,.95))` } : undefined}
    >
      <ellipse cx="120" cy="58" rx="50" ry="12.5" fill="none" stroke="#0a0a0a" strokeWidth="7" />
      <ellipse cx="120" cy="66" rx="51" ry="12.5" fill="none" stroke="#0a0a0a" strokeWidth="7" />
      <path d="M76 62 Q120 48 164 62" stroke="#fff" strokeOpacity=".22" strokeWidth="2" fill="none" />
    </g>
  );
}

/**
 * سعود — flat vector avatar (red shemagh, black iqal, short beard).
 * `anger` 0→1 reddens the face; `iqalLift` 0→1 raises the iqal («أرفع لكم العقال»).
 * `layer`: "all" | "base" (no iqal) | "iqal" (only the iqal, so it can rise out of a cropped frame).
 */
export function Saud({ mood = "happy", t = 0, anger = 0, iqalLift = 0, size = 240, layer = "all", style }) {
  const id = svgId(useId());
  const m = MOODS[mood] ?? MOODS.happy;
  const blinkPhase = (t + 0.7) % 3.3;
  const blink = (m.eyes === "open" || m.eyes === "wide") && blinkPhase < 0.11;
  const [browL, browR] = BROWS[m.brows];
  const lift = clamp(iqalLift);
  if (layer === "iqal") {
    return (
      <svg
        viewBox="0 0 240 240"
        width={size}
        height={size}
        style={{ overflow: "visible", ...style }}
        aria-hidden="true"
      >
        <Iqal lift={lift} />
      </svg>
    );
  }
  const shemagh =
    "M120 34 C74 34 50 66 48 112 C46 150 42 196 30 240 L210 240 C198 196 194 150 192 112 C190 66 166 34 120 34 Z " +
    "M120 80 C96 80 80 92 78 112 C77 126 78 140 82 152 C88 168 96 178 102 186 L98 240 L142 240 L138 186 C144 178 152 168 158 152 C162 140 163 126 162 112 C160 92 144 80 120 80 Z";
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} style={style} aria-hidden="true">
      <defs>
        <pattern
          id={`${id}p`}
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="9" height="9" fill="#fff6f6" />
          <rect width="3.6" height="3.6" fill="#d61f2c" />
          <rect x="4.5" y="4.5" width="3.6" height="3.6" fill="#d61f2c" />
        </pattern>
        <radialGradient id={`${id}s`} cx="50%" cy="42%" r="62%">
          <stop offset="0" stopColor="#e6b88b" />
          <stop offset="1" stopColor="#c08757" />
        </radialGradient>
        <linearGradient id={`${id}sh`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".25" />
          <stop offset="1" stopColor="#3b0a0a" stopOpacity=".35" />
        </linearGradient>
      </defs>

      {/* thobe + neck */}
      <path d="M18 240 C28 206 70 194 120 192 C170 194 212 206 222 240 Z" fill="#f1f5f9" />
      <path d="M104 202 Q120 214 136 202" stroke="#cbd5e1" strokeWidth="2.2" fill="none" />
      <path d="M120 211 V240" stroke="#e2e8f0" strokeWidth="2" />
      <circle cx="120" cy="224" r="2.2" fill="#cbd5e1" />
      <path d="M102 166 L102 200 Q120 211 138 200 L138 166 Z" fill="#b97f50" />

      {/* face */}
      <ellipse cx="120" cy="126" rx="44" ry="54" fill={`url(#${id}s)`} />
      {anger > 0 ? (
        <ellipse cx="120" cy="126" rx="44" ry="54" fill="#dc2626" opacity={0.34 * clamp(anger)} />
      ) : null}
      <path
        d="M78 138 C80 166 96 192 120 194 C144 192 160 166 162 138 C158 156 150 170 140 176 C132 181 126 183 120 183 C114 183 108 181 100 176 C90 170 82 156 78 138 Z"
        fill="#2a1a12"
        opacity=".95"
      />

      {/* shemagh (ghutra) with the face opening */}
      <path d={shemagh} fill={`url(#${id}p)`} fillRule="evenodd" />
      <path d={shemagh} fill={`url(#${id}sh)`} fillRule="evenodd" />
      <path
        d="M120 80 C96 80 80 92 78 112 C77 126 78 140 82 152 C88 168 96 178 102 186 M120 80 C144 80 160 92 162 112 C163 126 162 140 158 152 C152 168 144 178 138 186"
        stroke="#fbe9e9"
        strokeWidth="3.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M66 150 C62 180 58 206 54 236 M174 150 C178 180 182 206 186 236"
        stroke="#7f1d1d"
        strokeOpacity=".25"
        strokeWidth="3"
        fill="none"
      />

      {/* features */}
      <path d={browL} stroke={INK} strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d={browR} stroke={INK} strokeWidth="7" fill="none" strokeLinecap="round" />
      <Eye cx={101} cy={122} kind={m.eyes} blink={blink} side={-1} t={t} />
      <Eye cx={139} cy={122} kind={m.eyes} blink={blink} side={1} t={t} />
      <path
        d="M121 124 C118 134 115 140 117 144 C119 147 125 147 127 144"
        stroke="#a8714a"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M100 152 Q110 145 120 149 Q130 145 140 152 Q131 155 120 153 Q109 155 100 152 Z"
        fill="#24160e"
      />
      <Mouth kind={m.mouth} />
      {m.blush ? (
        <>
          <ellipse cx="91" cy="146" rx="9" ry="5" fill="#f472b6" opacity=".42" />
          <ellipse cx="149" cy="146" rx="9" ry="5" fill="#f472b6" opacity=".42" />
        </>
      ) : null}
      {m.vein ? (
        <g transform={`translate(142 95) scale(${1 + 0.15 * Math.abs(Math.sin(t * 9))})`}>
          <path
            d="M-8 -3 Q-3 -3 -3 -8 M3 -8 Q3 -3 8 -3 M8 3 Q3 3 3 8 M-3 8 Q-3 3 -8 3"
            stroke="#ef4444"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      ) : null}
      {m.sweat ? (
        <path
          transform="translate(160 104)"
          d="M0 -10 C5 -3 7 1 7 4 A7 7 0 0 1 -7 4 C-7 1 -5 -3 0 -10 Z"
          fill="#7dd3fc"
          stroke="#0284c7"
          strokeWidth="1.5"
        />
      ) : null}

      {layer === "all" ? <Iqal lift={lift} /> : null}

      {m.steam
        ? [0, 1, 2].map((i) => {
            const p = (t * 1.5 + i / 3) % 1;
            return (
              <g key={i} opacity={(1 - p) * 0.9}>
                <circle cx={52 - p * 10} cy={86 - p * 46} r={7 + p * 9} fill="#f8fafc" />
                <circle cx={188 + p * 10} cy={86 - p * 46} r={7 + p * 9} fill="#f8fafc" />
              </g>
            );
          })
        : null}
    </svg>
  );
}
