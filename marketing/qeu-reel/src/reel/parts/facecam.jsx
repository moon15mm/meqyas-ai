import { useId } from "react";

import { clamp, noise } from "../anim.js";
import { Saud } from "./Saud.jsx";

const svgId = (raw) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * Reaction "face cam" bubble (TikTok duet style) with سعود inside.
 * `frozen` 0→1 drains the colour and adds an ice/pause overlay for the Matrix freeze.
 */
export function FaceCam({
  t,
  x,
  y,
  size,
  mood,
  anger = 0,
  iqalLift = 0,
  frozen = 0,
  ring = "#f43f5e",
  opacity = 1,
  rot = 0,
}) {
  if (opacity <= 0) return null;
  const pad = size * 0.035;
  const inner = size - pad * 2;
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        width: size,
        height: size,
        opacity,
        transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}deg)`,
        willChange: "transform",
      }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: `0 0 ${size * 0.2}px ${ring}aa, 0 ${size * 0.06}px ${size * 0.12}px rgba(0,0,0,.6)`,
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${ring}, #ffffff, ${ring}, #111827, ${ring})`,
          transform: `rotate(${(t * 120) % 360}deg)`,
          willChange: "transform",
        }}
      />
      <div
        className="absolute overflow-hidden rounded-full"
        style={{
          left: pad,
          top: pad,
          width: inner,
          height: inner,
          background: "radial-gradient(circle at 50% 30%, #3a2f4a, #120f1c 70%)",
        }}
      >
        <Saud
          mood={mood}
          t={t}
          anger={anger}
          iqalLift={iqalLift}
          layer={iqalLift > 0 ? "base" : "all"}
          size={inner * 1.02}
          style={{
            position: "absolute",
            left: -inner * 0.01,
            top: inner * 0.05,
            filter:
              frozen > 0
                ? `grayscale(${frozen}) contrast(${1 + 0.25 * frozen}) brightness(${1 - 0.15 * frozen})`
                : undefined,
          }}
        />
        {frozen > 0 ? (
          <>
            <div
              className="absolute inset-0"
              style={{
                opacity: frozen,
                background: "linear-gradient(160deg, rgba(103,232,249,.35), rgba(167,139,250,.25))",
                mixBlendMode: "screen",
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                opacity: 0.6 * frozen,
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 2px, transparent 2px 7px)",
              }}
            />
          </>
        ) : null}
      </div>
      {iqalLift > 0 ? (
        <Saud
          layer="iqal"
          iqalLift={iqalLift}
          size={inner * 1.02}
          style={{ position: "absolute", left: pad - inner * 0.01, top: pad + inner * 0.05 }}
        />
      ) : null}
      <div
        className="absolute flex items-center gap-[8px] rounded-full font-ui font-bold text-white"
        style={{
          left: "50%",
          bottom: -size * 0.07,
          transform: "translateX(-50%)",
          padding: `${size * 0.018}px ${size * 0.06}px`,
          fontSize: size * 0.085,
          background: frozen > 0.5 ? "#4c1d95" : "#e11d48",
          boxShadow: "0 6px 18px rgba(0,0,0,.45)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          className="inline-block rounded-full"
          style={{
            width: size * 0.04,
            height: size * 0.04,
            background: "#fff",
            opacity: frozen > 0.5 ? 1 : Math.floor(t * 2) % 2 ? 0.35 : 1,
          }}
        />
        {frozen > 0.5 ? "متجمّد ⏸" : "سعود · مباشر"}
      </div>
    </div>
  );
}

/**
 * The brand motif: a gauge («مِقياس»). Anger mode → «مِقياس العصبية»; joy mode → «مِقياس الرضا».
 * `value` 0→1 drives the needle (0 = left, 1 = right).
 */
export function MoodGauge({ t, x, y, width = 230, value, joy = 0, frozen = 0, opacity = 1 }) {
  const id = svgId(useId());
  if (opacity <= 0) return null;
  const v = clamp(value + (frozen > 0.5 ? 0 : noise(t * 9, 5) * 0.025 * value));
  const ang = Math.PI - v * Math.PI;
  const nx = 100 + 66 * Math.cos(ang);
  const ny = 100 - 66 * Math.sin(ang);
  const isJoy = joy > 0.5;
  const pct = Math.round(v * 100);
  return (
    <div
      className="absolute top-0 left-0 rounded-[28px] font-ui text-white"
      style={{
        transform: `translate(${x - width / 2}px, ${y}px)`,
        willChange: "transform",
        width,
        opacity,
        padding: "14px 14px 12px",
        background: "rgba(10,10,18,.78)",
        border: `2px solid ${isJoy ? "rgba(52,211,153,.7)" : frozen > 0.5 ? "rgba(167,139,250,.7)" : "rgba(244,63,94,.7)"}`,
        boxShadow: `0 0 16px ${isJoy ? "rgba(52,211,153,.35)" : frozen > 0.5 ? "rgba(167,139,250,.35)" : "rgba(244,63,94,.35)"}`,
        filter: frozen > 0 ? `grayscale(${frozen * 0.6})` : undefined,
      }}
    >
      <div className="text-center font-bold" style={{ fontSize: 24, lineHeight: 1.2 }}>
        {isJoy ? "مِقياس الرضا 😍" : "مِقياس العصبية 😤"}
      </div>
      <svg viewBox="0 0 200 118" width={width - 28} height={((width - 28) * 118) / 200} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={isJoy ? "#f43f5e" : "#10b981"} />
            <stop offset=".5" stopColor="#facc15" />
            <stop offset="1" stopColor={isJoy ? "#10b981" : "#f43f5e"} />
          </linearGradient>
        </defs>
        <path
          d="M24 100 A76 76 0 0 1 176 100"
          fill="none"
          stroke="rgba(255,255,255,.12)"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M24 100 A76 76 0 0 1 176 100"
          fill="none"
          stroke={`url(#${id}a)`}
          strokeWidth="16"
          strokeLinecap="round"
        />
        {Array.from({ length: 9 }, (_, i) => {
          const a = Math.PI - (i / 8) * Math.PI;
          return (
            <line
              key={i}
              x1={100 + 56 * Math.cos(a)}
              y1={100 - 56 * Math.sin(a)}
              x2={100 + 48 * Math.cos(a)}
              y2={100 - 48 * Math.sin(a)}
              stroke="rgba(255,255,255,.45)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          );
        })}
        <line x1="100" y1="100" x2={nx} y2={ny} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <circle cx="100" cy="100" r="10" fill="#fff" />
        <circle cx="100" cy="100" r="4" fill="#0b0b12" />
      </svg>
      <div
        className="text-center font-black"
        style={{
          marginTop: -6,
          fontSize: 38,
          lineHeight: 1,
          fontFamily: "var(--font-display)",
          color: isJoy ? "#6ee7b7" : v > 0.6 ? "#fb7185" : "#fde68a",
        }}
      >
        {pct}%
      </div>
    </div>
  );
}
