import { AudioLines } from "lucide-react";

import { clamp, noise, pulseAt, spring } from "../anim.js";
import { SFX, SUBTITLES, captionWords } from "../timeline.js";
import { MeqyasMark, QeuMark } from "./brand.jsx";

const SPEAKERS = {
  saud: { name: "سعود", chip: "#e11d48", box: "#facc15", ink: "#111827" },
  ai: { name: "مِقياس AI", chip: "#6d28d9", box: "#c4b5fd", ink: "#1e1033" },
  qeu: { name: "كِيو", chip: "#047857", box: "#34d399", ink: "#022c22" },
  narrator: { name: null, chip: null, box: "#ffffff", ink: "#111827" },
};

const EMOJI = /\p{Extended_Pictographic}/u;

/** Karaoke captions: the spoken word pops inside a speaker-coloured box. */
export function Subtitles({ t }) {
  const line = SUBTITLES.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  const sp = SPEAKERS[line.who];
  const words = captionWords(line);
  const enter = spring(t, line.start, { stiffness: 420, damping: 24 });
  const exit = clamp((line.end - t) / 0.12);
  const y = line.y ?? 1268;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
      style={{
        top: y - 70,
        opacity: exit,
        transform: `translateY(${(1 - enter) * 26}px) scale(${0.92 + 0.08 * enter})`,
        willChange: "transform, opacity",
      }}
    >
      {sp.name ? (
        <div
          className="mb-[14px] flex items-center gap-[10px] rounded-full font-ui font-bold text-white"
          style={{
            background: sp.chip,
            padding: "6px 22px 6px 14px",
            fontSize: 28,
            boxShadow: "0 6px 0 rgba(0,0,0,.35)",
          }}
        >
          {line.who === "ai" ? (
            <MeqyasMark size={34} />
          ) : line.who === "qeu" ? (
            <QeuMark size={34} />
          ) : (
            <span>🎙️</span>
          )}
          {sp.name}
        </div>
      ) : null}
      <div
        className="flex flex-wrap justify-center"
        style={{ maxWidth: 920, gap: "4px 0", padding: "0 10px" }}
      >
        {words.map((w, i) => {
          const active = t >= w.start && t < w.end;
          const past = t >= w.end;
          const k = active ? spring(t, w.start, { stiffness: 600, damping: 16 }) : 0;
          const emoji = EMOJI.test(w.word);
          return (
            <span
              key={i}
              className="inline-block rounded-[18px] font-display font-black"
              style={{
                fontSize: 68,
                lineHeight: 1.22,
                padding: "2px 13px 8px",
                color: active ? sp.ink : "#fff",
                opacity: active || past ? 1 : 0.5,
                background: active ? sp.box : "transparent",
                boxShadow: active ? "0 10px 0 rgba(0,0,0,.55)" : "none",
                textShadow:
                  active || emoji
                    ? "none"
                    : "3px 0 #000, -3px 0 #000, 0 3px #000, 0 -3px #000, 2px 2px #000, -2px -2px #000, 2px -2px #000, -2px 2px #000, 0 7px 0 rgba(0,0,0,.85)",
                transform: active
                  ? `translateY(${-6 * k}px) scale(${1 + 0.1 * k}) rotate(${i % 2 ? 2 : -2}deg)`
                  : undefined,
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Comic-style onomatopoeia stickers that "show" each sound effect. */
export function SfxStickers({ t }) {
  return SFX.filter((s) => t >= s.start && t < s.end).map((s) => <Sticker key={s.id} s={s} t={t} />);
}

function Sticker({ s, t }) {
  const age = t - s.start;
  const life = s.end - s.start;
  const inP = spring(t, s.start, { stiffness: 460, damping: 13 });
  const out = clamp((s.end - t) / 0.18) * clamp(inP * 2.5);
  let scale = (0.55 + 0.45 * inP) * (0.85 + 0.15 * out);
  if (s.beats) scale *= 1 + 0.24 * pulseAt(t, s.beats, 0.22);
  const jx = s.jitter ? noise(t * 26, 1) * 10 : 0;
  const jy = s.jitter ? noise(t * 26, 2) * 10 : 0;
  const wob = Math.sin(age * 10) * 4 * (1 - clamp(age / life));
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: s.x,
        top: s.y,
        opacity: out,
        transform: `translate(-50%, -50%) translate(${jx}px, ${jy}px) rotate(${s.rot + wob}deg) scale(${scale})`,
        willChange: "transform, opacity",
      }}
    >
      <div
        className="text-center font-display font-black"
        style={{
          fontSize: s.size ?? 88,
          lineHeight: 1,
          whiteSpace: "nowrap",
          color: s.color,
          WebkitTextStroke: "12px #0b0b12",
          paintOrder: "stroke fill",
          textShadow: "0 10px 0 #0b0b12",
        }}
      >
        {s.ar}
      </div>
      <div
        dir="ltr"
        className="mx-auto mt-[12px] flex w-fit items-center gap-[8px] rounded-full"
        style={{
          background: "#0b0b12",
          border: `3px solid ${s.color}`,
          color: s.color,
          padding: "5px 16px",
          fontFamily: "var(--font-mono)",
          fontSize: 23,
          fontWeight: 800,
          letterSpacing: 1,
          whiteSpace: "nowrap",
        }}
      >
        <AudioLines size={24} strokeWidth={2.6} />[{s.en}]
      </div>
    </div>
  );
}
