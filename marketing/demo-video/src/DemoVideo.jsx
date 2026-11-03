import { useEffect, useState } from "react";
import { AbsoluteFill, Html5Audio, Sequence, continueRender, delayRender, staticFile } from "remotion";

import { Part1 } from "./scenes/Part1.jsx";
import { Part2 } from "./scenes/Part2.jsx";
import { Part3 } from "./scenes/Part3.jsx";
import { Part4 } from "./scenes/Part4.jsx";
import { FPS, SEG, SUBTITLES } from "./timeline.js";
import { C, FONT, ramp, useTime } from "./ui.jsx";

const FONTS = [
  '400 40px "IBM Plex Sans Arabic"',
  '500 40px "IBM Plex Sans Arabic"',
  '600 40px "IBM Plex Sans Arabic"',
  '700 40px "IBM Plex Sans Arabic"',
  '400 40px "JetBrains Mono"',
  '600 40px "JetBrains Mono"',
  '700 40px "JetBrains Mono"',
];

function useFonts() {
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    Promise.all(FONTS.map((f) => document.fonts.load(f, "مِقياس Meqyas AI 0123")))
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle))
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
  }, [handle]);
}

function Background({ t }) {
  const drift = t * 6;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div
        style={{
          position: "absolute",
          inset: -200,
          background: `radial-gradient(900px 600px at ${30 + Math.sin(t / 9) * 8}% ${25 + Math.cos(t / 11) * 6}%, rgba(59,63,196,.32), transparent 70%),
             radial-gradient(800px 600px at ${75 + Math.cos(t / 10) * 8}% ${80 + Math.sin(t / 8) * 6}%, rgba(31,143,163,.26), transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(rgba(148,163,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,255,.05) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `${drift}px ${drift}px`,
        }}
      />
    </AbsoluteFill>
  );
}

function Subtitles({ t }) {
  const cue = SUBTITLES.find((s) => t >= s.start && t <= s.end + 0.15);
  if (!cue) return null;
  const op = Math.min(ramp(t, cue.start, 0.2), 1 - ramp(t, cue.end - 0.05, 0.2));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center", opacity: op }}>
      <div
        style={{
          maxWidth: 1500,
          padding: "12px 28px",
          borderRadius: 14,
          background: "rgba(5,8,20,.78)",
          color: "#fff",
          fontSize: 34,
          lineHeight: 1.35,
          textAlign: "center",
        }}
      >
        {cue.text}
      </div>
    </div>
  );
}

export function DemoVideo({ subtitles = true, withAudio = true }) {
  useFonts();
  const t = useTime();
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.text }}>
      <Background t={t} />
      <Part1 t={t} />
      <Part2 t={t} />
      <Part3 t={t} />
      <Part4 t={t} />
      {subtitles ? <Subtitles t={t} /> : null}
      {withAudio
        ? Object.values(SEG).map((s) => (
            <Sequence key={s.file} from={Math.round(s.at * FPS)} durationInFrames={Math.ceil((s.len + 0.5) * FPS)}>
              <Html5Audio src={staticFile(s.file)} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
}
