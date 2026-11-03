import { Angry, Frown, HeartPulse, Laugh, Meh, Smile } from "lucide-react";

import { addShakes, clamp, ease, fadeWindow, hash, interp, prog, shake, spring } from "../anim.js";
import { QeuMark } from "../parts/brand.jsx";
import { HEARTBEATS, T } from "../timeline.js";

/* ------------------------------------------------------------- 2.5D box maths */

const DEPTH = [95, -105];
const DLEN = Math.hypot(DEPTH[0], DEPTH[1]);
const BACK = [DEPTH[0] / DLEN, DEPTH[1] / DLEN];
const FLAP = 70;
const FL = [-250, -150];
const FR = [250, -150];
const BL = [FL[0] + DEPTH[0], FL[1] + DEPTH[1]];
const BR = [FR[0] + DEPTH[0], FR[1] + DEPTH[1]];

function flap(a, b, closedDir, deg) {
  const phi = (deg * Math.PI) / 180;
  const vx = FLAP * Math.cos(phi) * closedDir[0];
  const vy = FLAP * (Math.cos(phi) * closedDir[1] - Math.sin(phi));
  return `${a[0]},${a[1]} ${b[0]},${b[1]} ${b[0] + vx},${b[1] + vy} ${a[0] + vx},${a[1] + vy}`;
}

/** Ballistic particles: deterministic burst from (x0, y0) at t0. */
function burst(t, t0, n, seed, { x0, y0, speed = 900, spread = 120, dir = -90, gravity = 2400, life = 1.1 }) {
  const age = t - t0;
  if (age < 0 || age > life) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = ((dir + (hash(seed + i * 1.7) - 0.5) * spread) * Math.PI) / 180;
    const v = speed * (0.45 + hash(seed + i * 3.1) * 0.75);
    return {
      i,
      x: x0 + Math.cos(a) * v * age,
      y: y0 + Math.sin(a) * v * age + 0.5 * gravity * age * age,
      r: 6 + hash(seed + i * 5.9) * 12,
      o: clamp(1 - age / life) * 1.2,
      rot: age * 600 * (hash(seed + i) - 0.5),
    };
  });
}

function JuiceCarton({ t }) {
  const crushed = spring(t, T.crash, { stiffness: 420, damping: 16 });
  return (
    <g
      transform={`translate(-125 -205) rotate(${-14 - 6 * crushed}) scale(${1 + 0.06 * crushed} ${1 - 0.1 * crushed})`}
    >
      <rect
        x="-48"
        y="-120"
        width="96"
        height="180"
        rx="6"
        fill="url(#juiceBody)"
        stroke="#9a3412"
        strokeWidth="3"
      />
      <rect x="-48" y="-120" width="96" height="34" fill="#fff7ed" />
      <polygon
        points="-48,-120 0,-152 48,-120"
        fill="#ffedd5"
        stroke="#9a3412"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect x="-28" y="-160" width="56" height="10" rx="3" fill="#fed7aa" stroke="#9a3412" strokeWidth="2" />
      <circle cx="0" cy="-38" r="23" fill="#fff" />
      <circle cx="0" cy="-38" r="17" fill="#fb923c" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <line
          key={a}
          x1="0"
          y1="-38"
          x2={17 * Math.cos((a * Math.PI) / 180)}
          y2={-38 + 17 * Math.sin((a * Math.PI) / 180)}
          stroke="#fff7ed"
          strokeWidth="2.5"
        />
      ))}
      <text
        x="0"
        y="16"
        textAnchor="middle"
        direction="rtl"
        fontFamily="var(--font-display)"
        fontWeight="900"
        fontSize="26"
        fill="#fff"
      >
        عصير
      </text>
      <text
        x="0"
        y="44"
        textAnchor="middle"
        direction="rtl"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="20"
        fill="#ffedd5"
      >
        برتقال طازج
      </text>
      {crushed > 0 ? (
        <>
          <path
            d="M-48 -8 L-6 -30 L14 6 L48 -22"
            stroke="#7c2d12"
            strokeOpacity={0.55 * crushed}
            strokeWidth="5"
            fill="none"
            strokeLinejoin="round"
          />
          <path
            d="M18 -70 l9 -6 4 9 9 -2 -5 9 7 6 -10 2 -1 10 -8 -6 -8 5 1 -10 -9 -4 8 -5z"
            fill="#431407"
            opacity={crushed}
          />
        </>
      ) : null}
    </g>
  );
}

function EggTray({ t }) {
  const cracked = t >= T.crash;
  const ooze = ease.outCubic(prog(t, T.crash, T.crash + 1.2));
  const eggs = [-66, -22, 22, 66];
  return (
    <g transform="translate(150 -180)">
      <rect
        x="-98"
        y="-22"
        width="196"
        height="64"
        rx="14"
        fill="url(#tray)"
        stroke="#64748b"
        strokeWidth="3"
      />
      {eggs.map((x, i) =>
        i === 1 && cracked ? (
          <g key={x}>
            <path
              d={`M${x - 21} -26 a21 27 0 0 0 42 0 l-6 -7 -6 6 -7 -8 -6 7 -6 -7 -6 6z`}
              fill="#fde8cf"
              stroke="#d6b591"
              strokeWidth="2"
            />
            <ellipse
              cx={x}
              cy={-30 + 4 * ooze}
              rx={15 + 10 * ooze}
              ry={10 + 3 * ooze}
              fill="rgba(255,255,255,.75)"
            />
            <ellipse cx={x} cy={-31 + 5 * ooze} rx={12} ry={10} fill="url(#yolk)" />
            <ellipse cx={x - 4} cy={-35 + 5 * ooze} rx={4} ry={2.6} fill="#fef9c3" />
          </g>
        ) : (
          <g key={x}>
            <ellipse cx={x} cy={-28} rx="21" ry="27" fill="#fdecd8" stroke="#d6b591" strokeWidth="2" />
            <ellipse cx={x - 7} cy={-38} rx="5" ry="8" fill="#fff" opacity=".75" />
          </g>
        ),
      )}
    </g>
  );
}

/** Drop + squash on landing — applied by the compositor to the whole box layer. */
function boxDrop(t) {
  const fall = t < T.boxLand ? -1150 * (1 - ease.inQuad(clamp(t / T.boxLand))) : 0;
  const k = t >= T.boxLand ? Math.exp(-(t - T.boxLand) * 9) * Math.cos((t - T.boxLand) * 28) : 0;
  return { fall, sx: 1 + 0.1 * k, sy: 1 - 0.14 * k };
}

function Box({ t }) {
  const jolt = t >= T.crash ? Math.exp(-(t - T.crash) * 8) * Math.sin((t - T.crash) * 40) * 6 : 0;

  const o = ease.outBack(prog(t, T.flapsOpen, T.flapsOpened));
  const o2 = ease.outBack(prog(t, T.flapsOpen + 0.04, T.flapsOpened + 0.05));
  const front = 205 * o + jolt;
  const back = 118 * o + jolt;
  const left = 128 * o2 + jolt;
  const right = 122 * o2 + jolt;
  const open = o > 0.02;
  const rise = 50 * (1 - ease.outBack(prog(t, 1.0, 1.55)));
  const innerFill = (deg) => (deg > 90 ? "url(#flapInner)" : "url(#flapOuter)");

  const juice = burst(t, T.crash, 26, 11, { x0: -111, y0: -265, speed: 1100, spread: 110, dir: -100 });
  const shells = burst(t, T.crash, 7, 41, {
    x0: 128,
    y0: -222,
    speed: 800,
    spread: 140,
    dir: -80,
    life: 0.9,
  });
  const drips = [-182, -130, -86].map((x, i) => ({
    x,
    len: 250 * ease.outCubic(prog(t, 1.72 + i * 0.12, 4.6)) - i * 30,
  }));
  const yolkDrip = 170 * ease.outCubic(prog(t, 1.95, 4.7));
  const puddle = ease.outCubic(prog(t, 1.85, 4.7));
  const tapeTorn = t >= T.tapeRip;
  const tapeAge = t - T.tapeRip;

  return (
    <g transform="translate(-47 0)">
      <ellipse cx="47" cy="214" rx="330" ry="32" fill="url(#floorShadow)" />
      {puddle > 0 ? (
        <g>
          <ellipse cx="-110" cy="214" rx={270 * puddle} ry={44 * puddle} fill="#f97316" opacity=".92" />
          <ellipse cx="-150" cy="206" rx={120 * puddle} ry={10 * puddle} fill="#fed7aa" opacity=".6" />
          <ellipse cx="150" cy="216" rx={90 * puddle} ry={18 * puddle} fill="#facc15" opacity=".9" />
        </g>
      ) : null}

      {/* interior + flaps behind */}
      <polygon points={`${FL} 150,-150 230,-116 300,-188 ${BR} ${BL}`} fill="url(#inside)" />
      <polygon
        points={flap(BL, BR, [-BACK[0], -BACK[1]], back)}
        fill={innerFill(back)}
        stroke="#7a4f26"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon
        points={flap(FL, BL, [1, 0], left)}
        fill={innerFill(left)}
        stroke="#7a4f26"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon
        points={flap(FR, BR, [-1, 0], right)}
        fill={innerFill(right)}
        stroke="#7a4f26"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {open ? (
        <g transform={`translate(0 ${rise})`}>
          <g transform="translate(20 -238)">
            <rect
              x="-82"
              y="-40"
              width="164"
              height="72"
              rx="34"
              fill="url(#bread)"
              stroke="#78350f"
              strokeWidth="3"
            />
            {[-40, 0, 40].map((x) => (
              <path
                key={x}
                d={`M${x - 14} -22 q14 10 28 0`}
                stroke="#fde68a"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
              />
            ))}
          </g>
          <EggTray t={t} />
          <JuiceCarton t={t} />
        </g>
      ) : null}

      {/* right side + front face */}
      <polygon
        points={`250,-72 262,-112 300,-188 ${BR} 345,95 250,200`}
        fill="url(#sideFace)"
        stroke="#7a4f26"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <text
        x="300"
        y="20"
        textAnchor="middle"
        fontSize="40"
        fontWeight="900"
        fill="#5c3a1a"
        opacity=".55"
        transform="skewY(-48) translate(0 300)"
      >
        ↑↑
      </text>
      <polygon
        points="-250,-150 150,-150 182,-132 206,-142 230,-116 250,-72 250,200 -250,200"
        fill="url(#frontFace)"
        stroke="#7a4f26"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M150 -150 L186 -112 L178 -70 M206 -142 L214 -98 M230 -116 L238 -60"
        stroke="#6b4423"
        strokeWidth="3"
        fill="none"
        strokeOpacity=".7"
        strokeLinecap="round"
      />
      <path
        d="M160 -146 L192 -114 M210 -136 L222 -100"
        stroke="#f3d3a6"
        strokeWidth="2.5"
        fill="none"
        strokeOpacity=".7"
      />

      {/* label + fragile sticker */}
      <g>
        <rect
          x="28"
          y="-96"
          width="190"
          height="156"
          rx="8"
          fill="#fafaf9"
          stroke="#d6d3d1"
          strokeWidth="2"
        />
        <rect x="160" y="-84" width="44" height="44" rx="11" fill="#10b981" />
        <circle cx="181" cy="-63" r="10" fill="none" stroke="#fff" strokeWidth="4.5" />
        <path d="M187 -57 l7 7" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
        <text
          x="150"
          y="-55"
          textAnchor="start"
          direction="rtl"
          fontFamily="var(--font-display)"
          fontWeight="900"
          fontSize="27"
          fill="#111827"
        >
          كِيو
        </text>
        <text
          x="40"
          y="-55"
          textAnchor="start"
          fontFamily="var(--font-display)"
          fontWeight="900"
          fontSize="22"
          fill="#10b981"
        >
          QEU
        </text>
        <text
          x="206"
          y="-14"
          textAnchor="start"
          direction="rtl"
          fontFamily="var(--font-display)"
          fontWeight="700"
          fontSize="20"
          fill="#374151"
        >
          إلى: سعود · الرياض
        </text>
        {Array.from({ length: 24 }, (_, i) => (
          <rect
            key={i}
            x={44 + i * 6.8}
            y="6"
            width={hash(i * 3.3) > 0.5 ? 4 : 2}
            height="40"
            fill="#111827"
          />
        ))}
      </g>
      <g transform="rotate(-6 -150 90)">
        <rect
          x="-232"
          y="58"
          width="168"
          height="62"
          rx="10"
          fill="#dc2626"
          stroke="#7f1d1d"
          strokeWidth="3"
        />
        <text
          x="-148"
          y="98"
          textAnchor="middle"
          direction="rtl"
          fontFamily="var(--font-display)"
          fontWeight="900"
          fontSize="27"
          fill="#fff"
        >
          ⚠ قابل للكسر
        </text>
      </g>

      {/* juice + yolk running down the front */}
      {drips.map((d, i) =>
        d.len > 4 ? (
          <g key={i}>
            <rect x={d.x - 10} y="-152" width="20" height={d.len} rx="10" fill="#f97316" />
            <circle cx={d.x} cy={-152 + d.len} r="13" fill="#f97316" />
            <rect
              x={d.x - 4}
              y="-146"
              width="5"
              height={Math.max(0, d.len - 18)}
              rx="2.5"
              fill="#fed7aa"
              opacity=".7"
            />
          </g>
        ) : null,
      )}
      {drips[0].len > 4 ? (
        <path d={`M-215 -152 Q-150 ${-138 + 6 * puddle} -60 -152 Z`} fill="#f97316" />
      ) : null}
      {yolkDrip > 4 ? (
        <g>
          <rect x="120" y="-152" width="16" height={yolkDrip} rx="8" fill="#facc15" />
          <circle cx="128" cy={-152 + yolkDrip} r="11" fill="#facc15" />
        </g>
      ) : null}

      {/* front flap (nearest) + tape */}
      <polygon
        points={flap(FL, FR, BACK, front)}
        fill={innerFill(front)}
        stroke="#7a4f26"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {!tapeTorn || tapeAge < 0.35 ? (
        <g opacity={tapeTorn ? 1 - tapeAge / 0.35 : 1}>
          <polygon
            points={`${-250 + BACK[0] * 52 - (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 52} ${-5 - (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 52} ${-5 - (tapeTorn ? tapeAge * 300 : 0) + BACK[0] * 36},${-150 + BACK[1] * 88} ${-250 + BACK[0] * 88 - (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 88}`}
            fill="#fde68a"
            opacity=".85"
          />
          <polygon
            points={`${5 + (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 52} ${250 + BACK[0] * 52 + (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 52} ${250 + BACK[0] * 88 + (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 88} ${5 + BACK[0] * 36 + (tapeTorn ? tapeAge * 300 : 0)},${-150 + BACK[1] * 88}`}
            fill="#fde68a"
            opacity=".85"
          />
        </g>
      ) : null}

      {/* splash particles */}
      {juice.map((p) => (
        <circle
          key={`j${p.i}`}
          cx={p.x}
          cy={p.y}
          r={p.r}
          fill={p.i % 5 === 0 ? "#fed7aa" : "#fb923c"}
          opacity={Math.min(1, p.o)}
        />
      ))}
      {shells.map((p) => (
        <polygon
          key={`s${p.i}`}
          points="-12,-6 10,-10 6,10"
          transform={`translate(${p.x} ${p.y}) rotate(${p.rot}) scale(${0.8 + p.r / 18})`}
          fill="#fdecd8"
          stroke="#d6b591"
          strokeWidth="2"
          opacity={Math.min(1, p.o)}
        />
      ))}
    </g>
  );
}

function BoxDefs() {
  return (
    <defs>
      <linearGradient id="frontFace" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d6a56b" />
        <stop offset="1" stopColor="#b07c45" />
      </linearGradient>
      <linearGradient id="sideFace" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#a8743f" />
        <stop offset="1" stopColor="#87582b" />
      </linearGradient>
      <linearGradient id="flapOuter" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d9a96e" />
        <stop offset="1" stopColor="#bf8a52" />
      </linearGradient>
      <linearGradient id="flapInner" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ecc896" />
        <stop offset="1" stopColor="#d4a978" />
      </linearGradient>
      <linearGradient id="inside" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#24130a" />
        <stop offset="1" stopColor="#6b4423" />
      </linearGradient>
      <linearGradient id="juiceBody" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fb923c" />
        <stop offset="1" stopColor="#ea580c" />
      </linearGradient>
      <linearGradient id="tray" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#cbd5e1" />
        <stop offset="1" stopColor="#94a3b8" />
      </linearGradient>
      <linearGradient id="bread" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e3a04f" />
        <stop offset="1" stopColor="#a8591d" />
      </linearGradient>
      <radialGradient id="yolk" cx="40%" cy="35%" r="70%">
        <stop offset="0" stopColor="#fde047" />
        <stop offset="1" stopColor="#f59e0b" />
      </radialGradient>
      <radialGradient id="floorShadow">
        <stop offset="0" stopColor="#000" stopOpacity=".7" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/* ----------------------------------------------------------------- hook layers */

function HookTitle({ t }) {
  const out = ease.inCubic(prog(t, 4.5, 4.78));
  const bounce = t < 0.5 ? 1 + 0.04 * Math.sin(t * 18) * (1 - t / 0.5) : 1;
  return (
    <div
      className="absolute inset-x-0 flex justify-center"
      style={{
        top: 120,
        opacity: 1 - out,
        transform: `translateY(${-160 * out}px) scale(${bounce * (1 + 0.15 * out)}) rotate(-1.5deg)`,
      }}
    >
      <div
        className="rounded-[34px] bg-white text-center font-display font-black text-[#0b0b12]"
        style={{
          padding: "18px 40px 22px",
          fontSize: 60,
          lineHeight: 1.18,
          boxShadow: "0 18px 50px rgba(0,0,0,.45), 0 0 0 6px rgba(244,63,94,.85)",
        }}
      >
        <div>لا تخلّي الكرتون المطعوج</div>
        <div>
          <span style={{ color: "#e11d48" }}>يفضحك</span> في إكس! 📦💥
        </div>
      </div>
    </div>
  );
}

function ecgAt(tau) {
  const beats = [0.15, 0.98, ...HEARTBEATS.filter((b) => b < 5)];
  let v = 0;
  for (const b of beats) {
    const d = tau - b;
    if (d < -0.12 || d > 0.25) continue;
    v += 0.12 * Math.exp(-(((d + 0.08) / 0.018) ** 2));
    v -= 0.15 * Math.exp(-(((d + 0.012) / 0.006) ** 2));
    v += Math.exp(-((d / 0.008) ** 2));
    v -= 0.3 * Math.exp(-(((d - 0.014) / 0.007) ** 2));
    v += 0.25 * Math.exp(-(((d - 0.13) / 0.03) ** 2));
  }
  return v;
}

function HeartMonitor({ t }) {
  const show = fadeWindow(t, -1, 4.72, 0.3, 0.2);
  if (show <= 0) return null;
  const bpm = Math.round(interp(t, [0, 1.6, 1.9, 4.4], [74, 74, 132, 171], ease.outCubic));
  const W = 360;
  const pts = Array.from({ length: 121 }, (_, i) => {
    const x = (i / 120) * W;
    const tau = t - (W - x) / 230;
    return `${x.toFixed(1)},${(52 - ecgAt(tau) * 40).toFixed(1)}`;
  }).join(" ");
  const pulse = Math.max(
    0,
    ...HEARTBEATS.filter((b) => b < 5).map((b) => (t >= b && t < b + 0.3 ? 1 - (t - b) / 0.3 : 0)),
  );
  const danger = bpm > 120;
  return (
    <div
      className="absolute rounded-[30px] font-ui text-white"
      style={{
        left: 52,
        top: 400,
        width: 410,
        padding: "16px 20px 10px",
        opacity: show,
        background: "rgba(12,6,10,.82)",
        border: `2px solid ${danger ? "rgba(244,63,94,.85)" : "rgba(52,211,153,.6)"}`,
        boxShadow: danger ? "0 0 22px rgba(244,63,94,.5)" : "0 0 18px rgba(52,211,153,.25)",
        transform: `rotate(-2deg) scale(${1 + 0.05 * pulse})`,
        willChange: "transform",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[10px] font-bold" style={{ fontSize: 25 }}>
          <HeartPulse size={34} color={danger ? "#fb7185" : "#34d399"} strokeWidth={2.6} />
          نبض سعود
        </div>
        <div
          className="font-black"
          style={{ fontFamily: "var(--font-mono)", fontSize: 44, color: danger ? "#fb7185" : "#6ee7b7" }}
        >
          {bpm}
          <span style={{ fontSize: 20, marginInlineStart: 6, opacity: 0.8 }}>BPM</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} 90`}
        width={W}
        height={90}
        aria-hidden="true"
        style={{ display: "block", direction: "ltr" }}
      >
        <polyline
          points={pts}
          fill="none"
          stroke={danger ? "#f43f5e" : "#10b981"}
          strokeOpacity=".35"
          strokeWidth="11"
          strokeLinejoin="round"
        />
        <polyline
          points={pts}
          fill="none"
          stroke={danger ? "#fb7185" : "#34d399"}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

const FACE_ICONS = [Angry, Frown, Meh, Smile, Laugh];
const FACE_LABELS = ["سيئ جدًا", "سيئ", "عادي", "جيد", "ممتاز"];

/** The «نبض» pulse rating Saud smashes 😡 on — the signal مِقياس AI catches in scene 3. */
function PulseCard({ t }) {
  if (t < T.pulseIn || t > T.pulseOut + 0.3) return null;
  const inP = spring(t, T.pulseIn, { stiffness: 320, damping: 18 });
  const out = ease.inBack(prog(t, T.pulseOut, T.pulseOut + 0.26));
  const tapped = t >= T.pulseTap;
  const tapK = spring(t, T.pulseTap, { stiffness: 500, damping: 12 });
  const ripple = prog(t, T.pulseTap, T.pulseTap + 0.35);
  const shakeX = tapped ? Math.sin((t - T.pulseTap) * 70) * 14 * Math.exp(-(t - T.pulseTap) * 9) : 0;
  return (
    <div
      className="absolute inset-x-0 flex justify-center"
      style={{
        top: 880,
        opacity: inP * (1 - out),
        transform: `translate(${shakeX}px, ${(1 - inP) * 120 - out * 420}px) scale(${(0.85 + 0.15 * inP) * (1 - 0.35 * out)})`,
        willChange: "transform, opacity",
      }}
    >
      <div
        className="rounded-[38px] font-ui text-white"
        style={{
          width: 860,
          padding: "26px 30px 24px",
          background: "#13131d",
          border: "2px solid rgba(255,255,255,.16)",
          boxShadow: "0 30px 80px rgba(0,0,0,.7)",
        }}
      >
        <div className="flex items-center gap-[18px]">
          <QeuMark size={64} />
          <div className="flex-1">
            <div className="font-bold" style={{ fontSize: 34 }}>
              كيف كان طلبك يا سعود؟
            </div>
            <div style={{ fontSize: 22, color: "#a1a1aa" }}>كِيو · استبيان «نبض» من مِقياس AI</div>
          </div>
        </div>
        <div className="mt-[22px] grid grid-cols-5 gap-[14px]">
          {FACE_ICONS.map((Icon, i) => {
            const hit = i === 0 && tapped;
            return (
              <div
                key={i}
                className="relative flex flex-col items-center gap-[8px] rounded-[26px]"
                style={{
                  padding: "16px 0 12px",
                  background: hit ? "rgba(220,94,89,.18)" : "rgba(255,255,255,.06)",
                  border: `3px solid ${hit ? "#dc5e59" : "transparent"}`,
                  opacity: tapped && !hit ? 0.45 : 1,
                  transform: hit ? `scale(${1 + 0.18 * tapK})` : undefined,
                }}
              >
                <Icon size={64} color={hit ? "#dc5e59" : "#a1a1aa"} strokeWidth={hit ? 2.4 : 1.7} />
                <span style={{ fontSize: 20, color: hit ? "#fff" : "#a1a1aa", fontWeight: hit ? 700 : 400 }}>
                  {FACE_LABELS[i]}
                </span>
                {hit && ripple < 1 ? (
                  <span
                    className="absolute rounded-full"
                    style={{
                      left: "50%",
                      top: "42%",
                      width: 40 + 220 * ripple,
                      height: 40 + 220 * ripple,
                      transform: "translate(-50%, -50%)",
                      border: "5px solid rgba(220,94,89,.9)",
                      opacity: 1 - ripple,
                    }}
                  />
                ) : null}
                {hit ? (
                  <span
                    className="absolute rounded-full font-black"
                    style={{
                      top: -18,
                      insetInlineStart: -10,
                      background: "#dc5e59",
                      padding: "2px 14px",
                      fontSize: 24,
                      fontFamily: "var(--font-mono)",
                      transform: `scale(${tapK})`,
                    }}
                  >
                    1/5
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Scene 1 · 0–5 s — the drama hook. */
export function HookScene({ t }) {
  if (t > 5.1) return null;
  const cam = addShakes(
    shake(t, T.boxLand, 0.45, 26, 30, 1),
    shake(t, T.tapeRip, 0.3, 7, 40, 2),
    shake(t, T.crash, 0.6, 34, 32, 3),
    shake(t, T.zoom1, 0.25, 10, 30, 4),
    shake(t, T.zoom2, 0.25, 12, 30, 5),
    shake(t, T.zoom3, 0.4, 18, 30, 6),
  );
  const zoom = interp(
    t,
    [0, T.boxLand, T.crash, T.crash + 0.25, 4.3],
    [1, 1, 1.06, 1.14, 1.2],
    ease.outCubic,
  );
  const exit = ease.inCubic(prog(t, T.whoosh, T.whoosh + 0.3));
  const drop = boxDrop(t);
  return (
    <div className="absolute inset-0" style={{ opacity: 1 - exit }}>
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${cam.x}px, ${cam.y - exit * 900}px) rotate(${cam.r}deg) scale(${zoom})`,
          transformOrigin: "540px 900px",
          filter: exit > 0 ? `blur(${exit * 14}px)` : undefined,
          willChange: "transform",
        }}
      >
        <div
          className="absolute"
          style={{
            left: 120,
            top: 520,
            width: 840,
            height: 760,
            background: "radial-gradient(closest-side, rgba(251,191,36,.28), transparent)",
          }}
        />
        <div
          className="absolute"
          style={{
            left: 0,
            top: 230,
            width: 1080,
            height: 1100,
            transform: `translateY(${drop.fall}px) scale(${drop.sx}, ${drop.sy})`,
            transformOrigin: "540px 900px",
            willChange: "transform",
          }}
        >
          <svg
            style={{ overflow: "visible" }}
            width="1080"
            height="1100"
            viewBox="-540 -700 1080 1100"
            aria-hidden="true"
          >
            <BoxDefs />
            <Box t={t} />
          </svg>
        </div>
      </div>
      <HeartMonitor t={t} />
      <PulseCard t={t} />
      <HookTitle t={t} />
    </div>
  );
}
