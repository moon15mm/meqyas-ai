import { useLayoutEffect, useState } from "react";

import { ReelStage } from "../reel/ReelStage.jsx";
import { DURATION, HEIGHT, WIDTH } from "../reel/timeline.js";
import { ReelChrome } from "./ReelChrome.jsx";

/**
 * Review views (no player UI):
 *   ?view=stage&t=12.5[&chrome=1]          one frame, fitted to the window
 *   ?view=sheet&from=0&to=35&step=1        contact sheet of frames
 */
export function StageView() {
  const q = new URLSearchParams(window.location.search);
  const t = Math.min(DURATION, Math.max(0, parseFloat(q.get("t") ?? "0") || 0));
  const chrome = q.get("chrome") === "1";
  // ?focus=x,y,w,h — show only that stage region (stage pixels), fitted to the window
  const [fx, fy, fw, fh] = (q.get("focus") ?? `0,0,${WIDTH},${HEIGHT}`).split(",").map(Number);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / fw, window.innerHeight / fh));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fw, fh]);
  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      <div style={{ width: fw * scale, height: fh * scale, position: "relative", overflow: "hidden" }}>
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            transform: `scale(${scale}) translate(${-fx}px, ${-fy}px)`,
            transformOrigin: "0 0",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <ReelStage t={t} />
          {chrome ? <ReelChrome t={t} /> : null}
        </div>
      </div>
    </div>
  );
}

export function SheetView() {
  const q = new URLSearchParams(window.location.search);
  const from = parseFloat(q.get("from") ?? "0") || 0;
  const to = parseFloat(q.get("to") ?? String(DURATION)) || DURATION;
  const step = parseFloat(q.get("step") ?? "1") || 1;
  const cols = parseInt(q.get("cols") ?? "6", 10) || 6;
  const times = [];
  for (let t = from; t <= to + 1e-6; t += step) times.push(Math.round(t * 1000) / 1000);
  const w = Math.floor((window.innerWidth - 8 * (cols + 1)) / cols);
  const s = w / WIDTH;
  return (
    <div className="flex flex-wrap gap-2 bg-zinc-950 p-2" dir="ltr">
      {times.map((t) => (
        <div
          key={t}
          className="relative overflow-hidden rounded bg-black"
          style={{ width: w, height: HEIGHT * s }}
        >
          <div
            style={{
              width: WIDTH,
              height: HEIGHT,
              transform: `scale(${s})`,
              transformOrigin: "0 0",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <ReelStage t={t} />
          </div>
          <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[11px] text-white">
            {t.toFixed(2)}s
          </span>
        </div>
      ))}
    </div>
  );
}
