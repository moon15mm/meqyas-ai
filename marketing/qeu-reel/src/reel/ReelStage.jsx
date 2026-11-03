import { clamp, ease, fadeWindow, interp, lerp, prog, spring } from "./anim.js";
import { SfxStickers, Subtitles } from "./parts/captions.jsx";
import { FaceCam, MoodGauge } from "./parts/facecam.jsx";
import { Backdrop, Confetti, DigitalRain, Flash, Grain, Scanlines, Sparkles, Vignette } from "./parts/fx.jsx";
import { FreezeHud } from "./scenes/FreezeHud.jsx";
import { HookScene } from "./scenes/Hook.jsx";
import { OutroScene } from "./scenes/Outro.jsx";
import { PhoneRig, frozenAmount } from "./scenes/Phone.jsx";
import { HEIGHT, T, WIDTH } from "./timeline.js";

const MOOD_TRACK = [
  [0, "happy"],
  [T.crash, "shock"],
  [T.angry, "angry"],
  [3.95, "furious"],
  [5.4, "angry"],
  [7.9, "furious"],
  [T.notif, "shock"],
  [19.5, "curious"],
  [T.wallet, "amazed"],
  [26.3, "happy"],
  [27.5, "delight"],
];

function moodAt(t) {
  let m = MOOD_TRACK[0][1];
  for (const [at, mood] of MOOD_TRACK) if (t >= at) m = mood;
  return m;
}

/** Face-cam choreography: pop-in, "dun dun DUNNN" zooms, corner for the phone scenes. */
function faceCamPose(t) {
  const tf = t >= T.freeze && t < T.unfreeze ? T.freeze : t;
  const pop = spring(t, -0.3, { stiffness: 300, damping: 16 }); // already on screen in frame 0 (the cover)
  const zs = { stiffness: 520, damping: 26 };
  const zoom =
    (spring(t, T.zoom1, zs) + spring(t, T.zoom2, zs) + spring(t, T.zoom3, zs)) *
    (1 - spring(t, T.angry, { stiffness: 220, damping: 20 }));
  let x = lerp(880, 560, zoom / 3);
  let y = lerp(500, 690, zoom / 3);
  let size = 260 + 140 * zoom;
  const corner = ease.inOutCubic(prog(t, 4.65, 5.15));
  x = lerp(x, 925, corner);
  y = lerp(y, 300, corner);
  size = lerp(size, 250, corner);
  const outro = ease.inCubic(prog(t, T.outro - 0.05, T.outro + 0.25));
  const anger =
    t < T.notif
      ? interp(tf, [T.angry, 4.4, 5.4, 7.9, 9], [0, 0.9, 0.75, 0.85, 1])
      : interp(t, [T.notif, 19.6, 22], [1, 0.6, 0]);
  const ring = t >= 27 ? "#facc15" : t >= T.unfreeze ? "#34d399" : t >= T.freeze ? "#a78bfa" : "#f43f5e";
  return {
    x,
    y,
    size: size * (0.3 + 0.7 * pop) * (1 - 0.6 * outro),
    opacity: clamp(pop * 1.5) * (1 - outro),
    mood: moodAt(tf),
    anger: t < T.angry ? 0 : anger,
    frozen: frozenAmount(t),
    iqal: spring(t, T.iqal, { stiffness: 160, damping: 11 }),
    ring,
    tf,
  };
}

function gaugePose(t) {
  const show =
    spring(t, T.angry + 0.07, { stiffness: 260, damping: 16 }) *
    (1 - ease.inCubic(prog(t, T.outro - 0.05, T.outro + 0.2)));
  const toPhone = ease.inOutCubic(prog(t, 4.65, 5.15));
  const toLeft = ease.inOutCubic(prog(t, 17.4, 17.85)) * (1 - ease.inOutCubic(prog(t, 25.95, 26.35)));
  let x = lerp(900, 925, toPhone);
  let y = lerp(680, 450, toPhone);
  let w = lerp(200, 210, toPhone);
  x = lerp(x, 170, toLeft);
  y = lerp(y, 150, toLeft);
  const joy = t >= 26.3 ? 1 : 0;
  const tf = t >= T.freeze && t < T.unfreeze ? T.freeze : t;
  const value = joy
    ? interp(t, [26.3, 27.5, 29.6], [0.35, 0.7, 1], ease.outCubic)
    : interp(
        tf,
        [T.angry, 3.9, 4.25, 17.7, 19.6, 21.5, 22.3, 23.0, 24.0],
        [0.3, 0.8, 0.94, 0.94, 0.8, 0.55, 0.22, 0.2, 0.06],
        ease.outBack,
      );
  return { x, y, w, value, joy, show, tf };
}

/** `display: contents` wrapper — lets QA / perf checks toggle a layer with [data-layer=…]. */
function Layer({ name, children }) {
  return (
    <div data-layer={name} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/**
 * The whole 35-second reel as a pure function of time (seconds). 1080 × 1920 stage —
 * the player scales it to fit; Remotion renders it 1:1.
 */
export function ReelStage({ t, showSubtitles = true, showSfx = true, grain = "animated" }) {
  const fc = faceCamPose(t);
  const gp = gaugePose(t);
  const rain = fadeWindow(t, T.freeze + 0.1, T.unfreeze + 0.25, 0.45, 0.35);
  return (
    <div
      className="reel-stage relative overflow-hidden font-display text-white"
      dir="rtl"
      lang="ar"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <Layer name="backdrop">
        <Backdrop t={t} />
      </Layer>
      <Layer name="rain">
        <DigitalRain t={t} opacity={rain * 0.75} />
      </Layer>
      <Layer name="hook">
        <HookScene t={t} />
      </Layer>
      <Layer name="phone">
        <PhoneRig t={t} />
      </Layer>
      <Layer name="hud">
        <FreezeHud t={t} />
      </Layer>
      <Layer name="facecam">
        <FaceCam
          t={fc.tf}
          x={fc.x}
          y={fc.y}
          size={fc.size}
          mood={fc.mood}
          anger={fc.anger}
          frozen={fc.frozen}
          iqalLift={fc.iqal}
          ring={fc.ring}
          opacity={fc.opacity}
        />
        <MoodGauge
          t={gp.tf}
          x={gp.x}
          y={gp.y}
          width={gp.w}
          value={gp.value}
          joy={gp.joy}
          frozen={fc.frozen}
          opacity={clamp(gp.show * 1.4)}
        />
        <Sparkles
          t={t}
          t0={T.iqal}
          x={fc.x}
          y={fc.y - fc.size * 0.42}
          radius={150}
          count={12}
          color="#fde68a"
        />
      </Layer>
      <Layer name="confetti">
        <Confetti t={t} t0={T.posted} x0={540} y0={1320} count={80} />
      </Layer>
      <Layer name="outro">
        <OutroScene t={t} />
      </Layer>
      <Layer name="subtitles">{showSubtitles ? <Subtitles t={t} /> : null}</Layer>
      <Layer name="sfx">{showSfx ? <SfxStickers t={t} /> : null}</Layer>
      <Layer name="scanlines">
        <Scanlines t={t} opacity={rain} />
      </Layer>
      <Layer name="vignette">
        <Vignette t={t} />
      </Layer>
      <Layer name="grain">{grain === "off" ? null : <Grain t={t} animated={grain === "animated"} />}</Layer>
      <Layer name="flash">
        <Flash t={t} />
      </Layer>
    </div>
  );
}
