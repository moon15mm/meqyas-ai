import { Composition } from "remotion";

import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "../src/reel/timeline.js";
import { QeuReel } from "./QeuReel.jsx";

export function Root() {
  return (
    <Composition
      id="QeuReel"
      component={QeuReel}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ showSubtitles: true, showSfx: true, withAudio: true, grain: "static" }}
    />
  );
}
