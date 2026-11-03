import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { ReelStage } from "../src/reel/ReelStage.jsx";

// Every face/weight the stage uses — the frame waits until they are loaded.
const FONTS = [
  '400 40px "Cairo Variable"',
  '900 40px "Cairo Variable"',
  '400 40px "IBM Plex Sans Arabic"',
  '500 40px "IBM Plex Sans Arabic"',
  '700 40px "IBM Plex Sans Arabic"',
];

function useFonts() {
  const [handle] = useState(() => delayRender("Loading Cairo + IBM Plex Sans Arabic"));
  useEffect(() => {
    Promise.all(FONTS.map((f) => document.fonts.load(f, "مِقياس كِيو AI 0123")))
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle))
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
  }, [handle]);
}

/**
 * The exported video: the same pure `ReelStage(t)` the player shows, sampled at each frame,
 * plus the synthesized soundtrack (public/qeu-reel-audio.wav, written by `pnpm audio`).
 * The platform UI is player-only and never exported.
 */
export function QeuReel({ showSubtitles = true, showSfx = true, withAudio = true, grain = "static" }) {
  useFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#05050a" }}>
      <ReelStage t={frame / fps} showSubtitles={showSubtitles} showSfx={showSfx} grain={grain} />
      {withAudio ? <Html5Audio src={staticFile("qeu-reel-audio.wav")} /> : null}
    </AbsoluteFill>
  );
}
