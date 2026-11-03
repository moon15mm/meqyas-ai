import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  Captions,
  Check,
  Clapperboard,
  Copy,
  Film,
  Gauge,
  Layers,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Smartphone,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ReelChrome } from "./player/ReelChrome.jsx";
import { ReelAudio } from "./player/reelAudio.js";
import { MeqyasMark, QeuMark } from "./reel/parts/brand.jsx";
import { ReelStage } from "./reel/ReelStage.jsx";
import {
  DURATION,
  FPS,
  HEIGHT,
  SCENES,
  SFX,
  SUBTITLES,
  WIDTH,
  formatTime,
  sceneAt,
} from "./reel/timeline.js";

const clampT = (v) => Math.min(DURATION, Math.max(0, v));
const pct = (t) => `${(t / DURATION) * 100}%`;

const SPEAKER = {
  saud: { label: "سعود", color: "#fb7185" },
  ai: { label: "مِقياس AI", color: "#c4b5fd" },
  qeu: { label: "كِيو", color: "#6ee7b7" },
  narrator: { label: "الراوي", color: "#e4e4e7" },
};

// One frame from each look of the reel — rendered once behind the loading cover so the GPU compiles
// its shaders and caches glyphs before the first real playback (avoids first-run stutter).
const WARM_TIMES = [
  0.6, 1.9, 3.1, 4.3, 6.8, 9.6, 10.3, 12.5, 15.4, 17.1, 18.4, 20.2, 22.0, 24.6, 26.4, 28.6, 29.7, 30.3, 31.3,
  31.9, 33.6,
];

const EXPORT_STEPS = [
  { id: "i", cmd: "pnpm install --ignore-workspace", note: "مرة واحدة" },
  { id: "s", cmd: "pnpm studio", note: "معاينة وتحرير في Remotion Studio" },
  { id: "r", cmd: "pnpm render", note: "← out/meqyas-qeu-reel.mp4" },
];

function initialTime() {
  if (typeof window === "undefined") return 0;
  const v = parseFloat(new URLSearchParams(window.location.search).get("t") ?? "0");
  return Number.isFinite(v) ? clampT(v) : 0;
}

function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/* ------------------------------------------------------------------ small UI */

function IconButton({ label, onClick, active, children, big }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      className={`flex items-center justify-center rounded-full border transition-colors ${
        big
          ? "h-14 w-14 border-transparent bg-gradient-to-br from-[#4f46e5] to-[#0d9488] text-white shadow-[0_0_30px_rgba(99,102,241,.55)]"
          : active
            ? "h-10 w-10 border-violet-400/60 bg-violet-500/20 text-violet-100"
            : "h-10 w-10 border-white/10 bg-white/5 text-zinc-300 hover:text-white"
      }`}
    >
      {children}
    </motion.button>
  );
}

function Toggle({ on, onClick, icon: Icon, children }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        on
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
          : "border-white/10 bg-white/5 text-zinc-400"
      }`}
    >
      <Icon size={15} /> {children}
    </motion.button>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#0c0c14] p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold tracking-wide text-zinc-400">
        <Icon size={16} className="text-violet-300" /> {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- timeline */

/** Scrubber — runs right → left like every time axis in the Arabic UI (DECISIONS D-033). */
function Timeline({ time, onSeek, onScrub }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const dragging = useRef(false);
  const toTime = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return clampT(((r.right - clientX) / r.width) * DURATION);
  };
  return (
    <div className="w-full select-none">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="الخط الزمني للإعلان"
        aria-valuemin={0}
        aria-valuemax={DURATION}
        aria-valuenow={Number(time.toFixed(1))}
        aria-valuetext={`${formatTime(time)} من 00:35`}
        className="relative h-14 cursor-pointer touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(true);
          onSeek(toTime(e.clientX));
        }}
        onPointerMove={(e) => {
          setHover(toTime(e.clientX));
          if (dragging.current) onSeek(toTime(e.clientX));
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
          onScrub(false);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {SCENES.map((s) => (
          <div
            key={s.id}
            className="absolute top-[22px] h-[14px] rounded-[5px]"
            style={{
              right: pct(s.start),
              width: `calc(${pct(s.end - s.start)} - 3px)`,
              background: `${s.color}33`,
              border: `1px solid ${s.color}77`,
            }}
          />
        ))}
        <div
          className="absolute inset-x-0 top-[22px] h-[14px] rounded-[5px]"
          style={{
            background: "linear-gradient(to left, #6366f1, #a78bfa, #34d399)",
            opacity: 0.85,
            transform: `scaleX(${time / DURATION})`,
            transformOrigin: "100% 50%",
            willChange: "transform",
          }}
        />
        {SFX.map((s) => (
          <div
            key={s.id}
            title={`${s.ar} · ${s.en}`}
            className="absolute top-[8px] h-[9px] w-[3px] rounded-full"
            style={{
              right: pct(s.start),
              background: s.color,
              opacity: time >= s.start && time < s.end ? 1 : 0.55,
            }}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-x-0 top-[14px] h-[30px]"
          style={{ transform: `translateX(${-(time / DURATION) * 100}%)`, willChange: "transform" }}
        >
          <div className="absolute top-0 right-[-2.5px] h-full w-[5px] rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.9)]" />
        </div>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute -top-8 rounded-md bg-zinc-900 px-2 py-0.5 text-[12px] whitespace-nowrap text-zinc-100 ring-1 ring-white/10"
            style={{ right: pct(hover), transform: "translateX(50%)" }}
          >
            <span dir="ltr">{formatTime(hover)}</span> · {sceneAt(hover).title}
          </div>
        ) : null}
      </div>
      <SceneLabels sceneId={sceneAt(time).id} onSeek={onSeek} />
    </div>
  );
}

const SceneLabels = memo(function SceneLabels({ sceneId, onSeek }) {
  return (
    <div className="relative h-5 text-[11px] text-zinc-500">
      {SCENES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSeek(s.start)}
          className="absolute truncate text-start hover:text-zinc-200"
          style={{
            right: pct(s.start),
            width: pct(s.end - s.start),
            color: s.id === sceneId ? s.color : undefined,
          }}
        >
          {s.n}· {s.title}
        </button>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------- side panels */

const ScenePanel = memo(function ScenePanel({ sceneId, onSeek }) {
  const scene = SCENES.find((s) => s.id === sceneId);
  return (
    <Panel title="المشهد الحالي" icon={Clapperboard}>
      <AnimatePresence mode="wait">
        <motion.div
          key={scene.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22 }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-2xl font-bold" style={{ color: scene.color }}>
              {scene.n}. {scene.title}
            </div>
            <div dir="ltr" className="font-mono text-[13px] text-zinc-400">
              {formatTime(scene.start)} → {formatTime(scene.end)}
            </div>
          </div>
          <div dir="ltr" className="text-end text-[12px] tracking-wide text-zinc-500 uppercase">
            {scene.en}
          </div>
          <p className="mt-2 text-[15px] leading-7 text-zinc-300">{scene.brief}</p>
        </motion.div>
      </AnimatePresence>
      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {SCENES.map((s) => {
          const on = s.id === scene.id;
          return (
            <motion.button
              key={s.id}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => onSeek(s.start)}
              className={`rounded-xl border px-2 py-1.5 text-start text-[11px] leading-tight transition-colors ${
                on ? "bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-zinc-200"
              }`}
              style={on ? { borderColor: s.color } : undefined}
            >
              <span className="block font-bold" style={{ color: s.color }}>
                {s.n}
              </span>
              {s.title}
            </motion.button>
          );
        })}
      </div>
    </Panel>
  );
});

const ScriptPanel = memo(function ScriptPanel({ activeLine, onSeek }) {
  const listRef = useRef(null);
  // keep the spoken line in view (scrolls the list only, never the page)
  useEffect(() => {
    const list = listRef.current;
    const item = activeLine >= 0 ? list?.children[activeLine] : null;
    if (item)
      list.scrollTo({
        top: item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2,
        behavior: "smooth",
      });
  }, [activeLine]);
  return (
    <Panel title="النص والترجمة (كاريوكي)" icon={Captions}>
      <ol ref={listRef} className="scrollbar-thin relative grid max-h-[300px] gap-1 overflow-y-auto pe-1">
        {SUBTITLES.map((l, i) => {
          const on = i === activeLine;
          const sp = SPEAKER[l.who];
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSeek(l.start + 0.01)}
                className={`relative flex w-full items-start gap-2 rounded-xl px-2.5 py-1.5 text-start text-[14px] leading-6 transition-colors ${
                  on ? "text-white" : "text-zinc-400 hover:bg-white/5"
                }`}
              >
                {on ? (
                  <motion.span
                    layoutId="line-hl"
                    className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/15"
                  />
                ) : null}
                <span dir="ltr" className="relative mt-0.5 shrink-0 font-mono text-[11px] text-zinc-500">
                  {formatTime(l.start)}
                </span>
                <span className="relative shrink-0 font-bold" style={{ color: sp.color }}>
                  {sp.label}:
                </span>
                <span className="relative">{l.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
});

const SfxPanel = memo(function SfxPanel({ activeKey, onSeek }) {
  const active = new Set(activeKey.split(","));
  return (
    <Panel title="المؤثرات الصوتية (SFX)" icon={AudioLines}>
      <div className="flex flex-wrap gap-1.5">
        {SFX.map((s) => {
          const on = active.has(s.id);
          return (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => onSeek(s.start)}
              animate={on ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={on ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]"
              style={{
                borderColor: on ? s.color : "rgba(255,255,255,.1)",
                background: on ? `${s.color}26` : "rgba(255,255,255,.03)",
                color: on ? "#fff" : "#a1a1aa",
                boxShadow: on ? `0 0 16px ${s.color}66` : "none",
              }}
            >
              <span className="font-bold" style={{ color: s.color }}>
                {s.ar}
              </span>
              <span dir="ltr" className="font-mono text-[10px] opacity-80">
                {s.en}
              </span>
            </motion.button>
          );
        })}
      </div>
    </Panel>
  );
});

const ExportPanel = memo(function ExportPanel() {
  const [copied, setCopied] = useState(null);
  const copy = (text, id) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1400);
    });
  };
  return (
    <Panel title="تصدير فيديو MP4 حقيقي (Remotion)" icon={Film}>
      <p className="mb-3 text-[13px] leading-6 text-zinc-400">
        المشاهد نفسها تُرسم إطارًا بإطار في Remotion (1080×1920 · 30fps · H.264) مع الصوت المُولَّد كملف WAV.
        من مجلد{" "}
        <code dir="ltr" className="rounded bg-white/10 px-1 text-zinc-200">
          marketing/qeu-reel
        </code>
        :
      </p>
      {EXPORT_STEPS.map((c) => (
        <div key={c.id} className="mb-2 flex items-center gap-2">
          <code
            dir="ltr"
            className="flex-1 truncate rounded-xl bg-black/50 px-3 py-2 font-mono text-[13px] text-emerald-200 ring-1 ring-white/10"
          >
            {c.cmd}
          </code>
          <button
            type="button"
            onClick={() => copy(c.cmd, c.id)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-300 ring-1 ring-white/10 hover:text-white"
            aria-label={`نسخ ${c.cmd}`}
          >
            {copied === c.id ? <Check size={16} className="text-emerald-300" /> : <Copy size={16} />}
          </button>
          <span className="hidden w-40 text-[11px] text-zinc-500 sm:block">{c.note}</span>
        </div>
      ))}
      <p className="mt-2 flex items-start gap-2 text-[12px] leading-5 text-zinc-500">
        <Layers size={14} className="mt-0.5 shrink-0" />
        واجهة المنصة لا تدخل في الفيديو المُصدَّر (المنصة تضيف واجهتها)، أما الترجمة ومؤشرات الصوت فتُطبع
        داخله ويمكن إيقافها بخصائص التصدير.
      </p>
    </Panel>
  );
});

/* ------------------------------------------------------------------ the artifact */

export default function MeqyasQeuReel() {
  const [time, setTime] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [showSfx, setShowSfx] = useState(true);
  const [showSubs, setShowSubs] = useState(true);
  const [loop, setLoop] = useState(false);
  const [audioState, setAudioState] = useState("preparing");
  const [scale, setScale] = useState(0.35);
  const [full, setFull] = useState(false);
  const [warmT, setWarmT] = useState(WARM_TIMES[0]);

  const audio = useRef(null);
  if (!audio.current) audio.current = new ReelAudio();
  const clock = useRef({ perf: 0, from: 0, useAudio: false });
  const lastFrame = useRef(-1);
  const frameRef = useRef(null);
  const shellRef = useRef(null);
  const resumeAfterScrub = useRef(false);
  const timeRef = useLatest(time);
  const playingRef = useLatest(playing);
  const mutedRef = useLatest(muted);
  const rateRef = useLatest(rate);
  const loopRef = useLatest(loop);
  const warmingRef = useLatest(warmT !== null);
  const pendingPlay = useRef(false);

  const startClock = useCallback(
    (from) => {
      const a = audio.current;
      let useAudio = false;
      if (!mutedRef.current && rateRef.current === 1 && a.ready) useAudio = a.start(from);
      else a.stop();
      clock.current = { perf: performance.now(), from, useAudio, lastAudio: -1, aligned: false };
    },
    [mutedRef, rateRef],
  );

  const play = useCallback(() => {
    if (warmingRef.current) {
      pendingPlay.current = true; // starts as soon as the warm-up finishes
      return;
    }
    if (!mutedRef.current) audio.current.unlock(); // inside the click: lets audio start without a hitch later
    const from = timeRef.current >= DURATION - 0.02 ? 0 : timeRef.current;
    timeRef.current = from;
    setTime(from);
    startClock(from);
    setPlaying(true);
  }, [mutedRef, startClock, timeRef, warmingRef]);

  const pause = useCallback(() => {
    audio.current.stop();
    setTime(timeRef.current);
    setPlaying(false);
  }, [timeRef]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play, playingRef]);

  const seek = useCallback(
    (t) => {
      const v = clampT(t);
      timeRef.current = v;
      setTime(v);
      if (playingRef.current) startClock(v);
    },
    [playingRef, startClock, timeRef],
  );

  const replay = useCallback(() => {
    timeRef.current = 0;
    setTime(0);
    if (warmingRef.current) {
      pendingPlay.current = true;
      return;
    }
    startClock(0);
    setPlaying(true);
  }, [startClock, timeRef, warmingRef]);

  const onScrub = useCallback(
    (down) => {
      if (down) {
        resumeAfterScrub.current = playingRef.current;
        if (playingRef.current) pause();
      } else if (resumeAfterScrub.current) {
        resumeAfterScrub.current = false;
        play();
      }
    },
    [pause, play, playingRef],
  );

  // Frame clock: re-render only when the 30 fps video frame changes (same cadence as the export).
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    const tickFn = () => {
      // The picture follows performance.now(); the audio follows the picture. If the audio clock
      // starts late (some devices) or drifts, the sound is re-started at the picture's position.
      const c = clock.current;
      let t = c.from + ((performance.now() - c.perf) / 1000) * rateRef.current;
      if (c.useAudio) {
        const at = audio.current.now();
        const advancing = c.lastAudio >= 0 && at > c.lastAudio + 1e-4;
        c.lastAudio = at;
        if (advancing) {
          if (Math.abs(at - t) > (c.aligned ? 0.25 : 0.08) && t < DURATION - 0.1) {
            audio.current.start(t);
            c.lastAudio = -1;
          }
          c.aligned = true;
        }
      }
      if (t >= DURATION) {
        if (loopRef.current) {
          t = 0;
          startClock(0);
        } else {
          audio.current.stop();
          timeRef.current = DURATION;
          setTime(DURATION);
          setPlaying(false);
          return;
        }
      }
      timeRef.current = t;
      const f = Math.floor(t * FPS);
      if (f !== lastFrame.current) {
        lastFrame.current = f;
        setTime(t);
      }
      raf = requestAnimationFrame(tickFn);
    };
    raf = requestAnimationFrame(tickFn);
    return () => cancelAnimationFrame(raf);
  }, [playing, loopRef, rateRef, startClock, timeRef]);

  // GPU warm-up: walk the stage through WARM_TIMES (two frames each) behind the loading cover.
  useEffect(() => {
    let cancelled = false;
    const frame = () =>
      new Promise((resolve) => {
        const id = setTimeout(resolve, 250); // keeps going even if rAF is throttled
        requestAnimationFrame(() => {
          clearTimeout(id);
          resolve();
        });
      });
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      for (const w of WARM_TIMES) {
        if (cancelled) return;
        setWarmT(w);
        await frame();
        await frame();
      }
      if (cancelled) return;
      setWarmT(null);
      if (pendingPlay.current) {
        pendingPlay.current = false;
        requestAnimationFrame(() => play());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [play]);

  // Render the soundtrack once, in a worker.
  useEffect(() => {
    let alive = true;
    audio.current
      .prepareAsync()
      .then(() => alive && setAudioState("ready"))
      .catch((err) => {
        console.error(err);
        if (alive) setAudioState("unavailable");
      });
    return () => {
      alive = false;
    };
  }, []);

  // (Re)attach audio when it becomes ready, or when mute / speed change mid-play.
  useEffect(() => {
    if (playingRef.current) startClock(timeRef.current);
  }, [audioState, muted, rate, playingRef, startClock, timeRef]);

  // Scale the 1080×1920 stage into the phone frame.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else shellRef.current?.requestFullscreen?.();
  }, []);

  // Keyboard: Space/K play · ←/→ ±1 s (the timeline runs right→left) · , / . frame · Home/End · R · M · C · F
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const map = {
        " ": toggle,
        k: toggle,
        arrowleft: () => seek(timeRef.current + 1),
        arrowright: () => seek(timeRef.current - 1),
        ".": () => seek(timeRef.current + 1 / FPS),
        ",": () => seek(timeRef.current - 1 / FPS),
        home: () => seek(0),
        end: () => seek(DURATION),
        r: replay,
        m: () => setMuted((m) => !m),
        c: () => setChrome((c) => !c),
        f: toggleFull,
      };
      const fn = map[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, seek, timeRef, toggle, toggleFull]);

  // Handle for automated checks / debugging.
  useEffect(() => {
    window.__reel = {
      seek,
      play,
      pause,
      get time() {
        return timeRef.current;
      },
    };
  }, [pause, play, seek, timeRef]);

  const scene = sceneAt(time);
  const activeLine = SUBTITLES.findIndex((l) => time >= l.start && time < l.end);
  const activeSfx = SFX.filter((s) => time >= s.start && time < s.end)
    .map((s) => s.id)
    .join(",");

  return (
    <main dir="rtl" lang="ar" className="min-h-screen bg-[#05050a] font-ui text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 85% -10%, rgba(99,102,241,.22), transparent 60%), radial-gradient(700px 500px at 0% 110%, rgba(16,185,129,.16), transparent 60%)",
        }}
      />
      <header className="relative mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <MeqyasMark size={42} />
          <span className="text-lg font-light text-zinc-500">×</span>
          <QeuMark size={42} />
          <div className="leading-tight">
            <h1 className="text-[17px] font-bold text-white sm:text-xl">
              لا تخلّي الكرتون المطعوج يفضحك في إكس!
            </h1>
            <p className="text-[13px] text-zinc-400">Meqyas Commerce AI × QEU · إعلان ريلز تفاعلي</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          {["35 ثانية", "9:16 · 1080×1920", `${FPS}fps`, "RTL"].map((b) => (
            <span
              key={b}
              dir={b === "RTL" ? "ltr" : undefined}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-zinc-300"
            >
              {b}
            </span>
          ))}
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1240px] gap-5 px-5 pb-10 lg:grid-cols-[auto_minmax(0,1fr)]">
        <section className="flex flex-col items-center gap-3">
          <div
            ref={shellRef}
            className={`relative ${full ? "flex h-full w-full items-center justify-center bg-black" : ""}`}
          >
            <div
              className="rounded-[46px] p-[10px] shadow-[0_40px_120px_rgba(0,0,0,.7),0_0_0_1px_rgba(255,255,255,.08)]"
              style={{ background: "linear-gradient(145deg,#3f3f46,#09090b 40%,#18181b 75%,#3f3f46)" }}
            >
              <div
                ref={frameRef}
                onClick={toggle}
                className="relative cursor-pointer overflow-hidden rounded-[36px] bg-black"
                style={{ height: full ? "94vh" : "min(76vh, 860px)", aspectRatio: "9 / 16" }}
              >
                <div
                  className="absolute top-0 left-0"
                  style={{
                    width: WIDTH,
                    height: HEIGHT,
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                    willChange: "transform",
                  }}
                >
                  <ReelStage t={warmT ?? time} showSubtitles={showSubs} showSfx={showSfx} />
                  {chrome ? <ReelChrome t={warmT ?? time} /> : null}
                </div>
                {warmT !== null ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#07070d]">
                    <MeqyasMark size={72} />
                    <div className="text-[15px] font-medium text-zinc-300">جارٍ تجهيز الإعلان…</div>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-indigo-400 to-emerald-400"
                        style={{ width: `${((WARM_TIMES.indexOf(warmT) + 1) / WARM_TIMES.length) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <AnimatePresence>
                  {!playing && warmT === null ? (
                    <motion.div
                      key="big-play"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.3 }}
                      transition={{ type: "spring", stiffness: 320, damping: 22 }}
                      className="absolute inset-0 flex items-center justify-center bg-black/25"
                    >
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/45 ring-1 ring-white/40">
                        {time >= DURATION - 0.02 ? (
                          <RotateCcw size={38} />
                        ) : (
                          <Play size={40} fill="#fff" className="-translate-x-[2px]" />
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div
            className="w-full max-w-[520px] rounded-3xl border border-white/10 bg-[#0c0c14] p-3"
            style={{ minWidth: "min(100%, 360px)" }}
          >
            <Timeline time={time} onSeek={seek} onScrub={onScrub} />
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IconButton big label={playing ? "إيقاف مؤقت (Space)" : "تشغيل (Space)"} onClick={toggle}>
                  {playing ? (
                    <Pause size={26} fill="#fff" />
                  ) : (
                    <Play size={26} fill="#fff" className="-translate-x-[1px]" />
                  )}
                </IconButton>
                <IconButton label="إعادة من البداية (R)" onClick={replay}>
                  <RotateCcw size={18} />
                </IconButton>
                <IconButton label="الإطار السابق (,)" onClick={() => seek(time - 1 / FPS)}>
                  <StepForward size={18} />
                </IconButton>
                <IconButton label="الإطار التالي (.)" onClick={() => seek(time + 1 / FPS)}>
                  <StepBack size={18} />
                </IconButton>
              </div>
              <div className="text-center leading-tight">
                <div dir="ltr" className="font-mono text-[17px] font-bold text-white tabular-nums">
                  {formatTime(time)} <span className="text-zinc-500">/ 00:35.0</span>
                </div>
                <div className="text-[11px] text-zinc-500" dir="ltr">
                  frame {Math.min(FPS * DURATION - 1, Math.floor(time * FPS))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <IconButton
                  label={muted ? "تشغيل الصوت (M)" : "كتم الصوت (M)"}
                  onClick={() => setMuted((m) => !m)}
                  active={!muted}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </IconButton>
                <IconButton label={full ? "خروج من ملء الشاشة (F)" : "ملء الشاشة (F)"} onClick={toggleFull}>
                  {full ? <Minimize size={18} /> : <Maximize size={18} />}
                </IconButton>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <Toggle on={showSubs} onClick={() => setShowSubs((v) => !v)} icon={Captions}>
                الترجمة
              </Toggle>
              <Toggle on={showSfx} onClick={() => setShowSfx((v) => !v)} icon={AudioLines}>
                مؤشرات الصوت
              </Toggle>
              <Toggle on={chrome} onClick={() => setChrome((v) => !v)} icon={Smartphone}>
                واجهة المنصة
              </Toggle>
              <Toggle on={loop} onClick={() => setLoop((v) => !v)} icon={Repeat}>
                تكرار
              </Toggle>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => setRate((r) => (r === 1 ? 0.5 : r === 0.5 ? 0.25 : 1))}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-medium text-zinc-300"
              >
                <Gauge size={15} /> السرعة <span dir="ltr">{rate}×</span>
              </motion.button>
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-500">
              {audioState === "preparing"
                ? "جارٍ توليد المؤثرات الصوتية…"
                : audioState === "unavailable"
                  ? "الصوت غير متاح في هذا المتصفح — المؤشرات البصرية تعمل."
                  : rate !== 1
                    ? "الصوت يعمل بالسرعة العادية فقط."
                    : "الصوت مُولَّد بالكامل برمجيًا · ← / → ثانية · , / . إطار"}
            </p>
          </div>
        </section>

        <div className="grid content-start gap-4">
          <ScenePanel sceneId={scene.id} onSeek={seek} />
          <ScriptPanel activeLine={activeLine} onSeek={seek} />
          <SfxPanel activeKey={activeSfx} onSeek={seek} />
          <ExportPanel />
        </div>
      </div>
    </main>
  );
}
