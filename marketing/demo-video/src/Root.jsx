import { Composition } from "remotion";

import { DemoVideo } from "./DemoVideo.jsx";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./timeline.js";

export function Root() {
  return (
    <Composition
      id="DemoVideo"
      component={DemoVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ subtitles: true, withAudio: true }}
    />
  );
}
