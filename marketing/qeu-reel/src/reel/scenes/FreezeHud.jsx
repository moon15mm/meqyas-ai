import { CircleCheck, FolderOpen, Gift, MessageCircle, Pause, ShieldAlert, Star } from "lucide-react";

import { clamp, ease, fadeWindow, prog, spring } from "../anim.js";
import { MeqyasMark } from "../parts/brand.jsx";
import { T, graphemes } from "../timeline.js";

const CHECKS = [
  { icon: Star, text: "تقييم «نبض» منخفض: 1 من 5 😡", tone: "#fda4af" },
  { icon: CircleCheck, text: "الطلب #4821 · عميل وفيّ: 23 طلبًا", tone: "#c4b5fd" },
  { icon: FolderOpen, text: "فُتحت حالة متابعة تلقائيًا", tone: "#c4b5fd" },
  { icon: ShieldAlert, text: "احتمال شكوى علنية", tone: "#fb7185", risk: true },
  { icon: Gift, text: "القرار: اعتذار + 50 ر.س + بوكس بديل", tone: "#6ee7b7", decision: true },
  { icon: MessageCircle, text: "إرسال عبر واتساب", tone: "#86efac", send: true },
];

const BLIPS = [
  { a: 32, r: 0.62, label: "1/5 😡", color: "#fb7185", big: true },
  { a: 118, r: 0.78, label: "طلب #4821", color: "#c4b5fd" },
  { a: 205, r: 0.5, label: "عميل ذهبي", color: "#fde68a" },
  { a: 290, r: 0.72, label: "خطر 94%", color: "#fb7185" },
];

function typewriter(text, t, t0, cps = 38) {
  const g = graphemes(text);
  const n = Math.max(0, Math.min(g.length, Math.floor((t - t0) * cps)));
  return g.slice(0, n).join("");
}

function Radar({ t, size = 300 }) {
  const sweep = ((t - T.radarIn) * 300) % 360;
  const passed = (a) => (t - T.radarIn) * 300 >= a;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        className="absolute inset-0"
        width={size}
        height={size}
        viewBox="-150 -150 300 300"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="radarBg">
            <stop offset="0" stopColor="#4c1d95" stopOpacity=".55" />
            <stop offset="1" stopColor="#0b0618" stopOpacity=".9" />
          </radialGradient>
        </defs>
        <circle r="146" fill="url(#radarBg)" stroke="#a78bfa" strokeOpacity=".7" strokeWidth="2.5" />
        {[36, 72, 108].map((r) => (
          <circle key={r} r={r} fill="none" stroke="#a78bfa" strokeOpacity=".28" strokeWidth="1.5" />
        ))}
        <path d="M-146 0H146M0 -146V146" stroke="#a78bfa" strokeOpacity=".25" strokeWidth="1.5" />
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={Math.cos(a) * 138}
              y1={Math.sin(a) * 138}
              x2={Math.cos(a) * (i % 3 ? 142 : 132)}
              y2={Math.sin(a) * (i % 3 ? 142 : 132)}
              stroke="#c4b5fd"
              strokeOpacity=".5"
              strokeWidth="2"
            />
          );
        })}
      </svg>
      <div
        className="absolute inset-[4px] rounded-full"
        style={{
          background: "conic-gradient(rgba(167,139,250,.75), rgba(167,139,250,.15) 40deg, transparent 70deg)",
          transform: `scaleX(-1) rotate(${sweep}deg)`,
          willChange: "transform",
        }}
      />
      {BLIPS.map((b, i) => {
        if (!passed(b.a)) return null;
        const since = ((t - T.radarIn) * 300 - b.a) / 300;
        const rad = ((-b.a + 90) * Math.PI) / 180;
        const x = size / 2 + Math.cos(rad) * b.r * (size / 2 - 10);
        const y = size / 2 - Math.sin(rad) * b.r * (size / 2 - 10);
        const k = spring(since, 0, { stiffness: 400, damping: 14 });
        return (
          <div key={i} className="absolute" style={{ left: x, top: y }}>
            <span
              className="absolute rounded-full"
              style={{
                width: b.big ? 22 : 15,
                height: b.big ? 22 : 15,
                left: b.big ? -11 : -7.5,
                top: b.big ? -11 : -7.5,
                background: b.color,
                transform: `scale(${k})`,
                boxShadow: `0 0 14px ${b.color}`,
              }}
            />
            {b.big ? (
              <span
                className="absolute rounded-full"
                style={{
                  width: 70,
                  height: 70,
                  left: -35,
                  top: -35,
                  border: `2px solid ${b.color}`,
                  opacity: 1 - ((t * 1.6) % 1),
                  transform: `scale(${(t * 1.6) % 1})`,
                }}
              />
            ) : null}
            <span
              className="absolute whitespace-nowrap rounded-[8px] font-ui font-bold"
              style={{
                top: 12,
                left: "50%",
                transform: `translateX(-50%) scale(${k})`,
                background: "rgba(8,6,20,.85)",
                border: `1px solid ${b.color}`,
                color: b.color,
                fontSize: 17,
                padding: "1px 8px",
              }}
            >
              {b.label}
            </span>
          </div>
        );
      })}
      <div className="absolute" style={{ left: size / 2 - 22, top: size / 2 - 22 }}>
        <MeqyasMark size={44} />
      </div>
    </div>
  );
}

function CheckRow({ c, t, at }) {
  if (t < at) return null;
  const k = spring(t, at, { stiffness: 380, damping: 20 });
  const text = typewriter(c.text, t, at + 0.05);
  const Icon = c.icon;
  const risk = c.risk ? ease.outCubic(prog(t, at + 0.15, at + 0.9)) : 0;
  const send = c.send ? ease.inOutQuad(prog(t, at + 0.1, at + 0.9)) : 0;
  const sent = c.send && send >= 1;
  return (
    <div
      className="flex items-center gap-[12px] rounded-[16px]"
      style={{
        opacity: k,
        transform: `translateX(${(1 - k) * -40}px)`,
        padding: "5px 12px",
        background: c.decision ? "rgba(16,185,129,.16)" : "rgba(255,255,255,.04)",
        border: c.decision ? "1.5px solid rgba(52,211,153,.75)" : "1.5px solid rgba(255,255,255,.07)",
        boxShadow: c.decision ? "0 0 20px rgba(52,211,153,.35)" : "none",
      }}
    >
      <Icon size={30} color={c.tone} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <div
          className="font-ui font-bold text-white"
          style={{ fontSize: 25, lineHeight: 1.3, whiteSpace: "nowrap" }}
        >
          {text}
          {c.risk ? (
            <span
              dir="ltr"
              style={{
                fontFamily: "var(--font-mono)",
                color: "#fb7185",
                marginRight: 12,
                display: "inline-block",
              }}
            >
              {Math.round(94 * risk)}%
            </span>
          ) : null}
        </div>
        {c.risk ? (
          <div
            className="mt-[5px] overflow-hidden rounded-full"
            style={{ height: 9, background: "rgba(255,255,255,.1)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${94 * risk}%`, background: "linear-gradient(90deg,#facc15,#f43f5e)" }}
            />
          </div>
        ) : null}
        {c.send ? (
          <div
            className="mt-[5px] overflow-hidden rounded-full"
            style={{ height: 9, background: "rgba(255,255,255,.1)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${100 * send}%`, background: "linear-gradient(90deg,#22c55e,#86efac)" }}
            />
          </div>
        ) : null}
      </div>
      <span
        className="shrink-0 rounded-full font-ui font-bold"
        style={{
          fontSize: 18,
          padding: "2px 10px",
          color: c.risk ? "#fecdd3" : "#d1fae5",
          background: c.risk ? "rgba(244,63,94,.25)" : "rgba(16,185,129,.25)",
        }}
      >
        {c.risk ? "مرتفع" : c.send ? (sent ? "تم ✓" : "…") : "✓"}
      </span>
    </div>
  );
}

/** Scene 3 · 10–17 s — time stops, مِقياس AI's radar reads the signals and decides. */
export function FreezeHud({ t }) {
  const on = fadeWindow(t, T.freeze, T.unfreeze + 0.15, 0.15, 0.25);
  if (on <= 0) return null;
  const panel = spring(t, T.radarIn, { stiffness: 200, damping: 20 });
  const pauseFlash = clamp(1 - (t - T.freeze) / 0.7);
  const decided = t >= T.decision;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity: on }}>
      {/* viewfinder corners */}
      {[
        [40, 100, 0],
        [1040, 100, 90],
        [1040, 1820, 180],
        [40, 1820, 270],
      ].map(([x, y, r]) => (
        <svg
          key={r}
          className="absolute"
          style={{ left: x - 50, top: y - 50 }}
          width="100"
          height="100"
          viewBox="-50 -50 100 100"
          aria-hidden="true"
        >
          <path
            d="M0 40V0h40"
            transform={`rotate(${r})`}
            fill="none"
            stroke="#c4b5fd"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </svg>
      ))}

      <div className="absolute flex items-center gap-[14px]" style={{ left: 70, top: 118 }}>
        <span
          className="flex items-center gap-[8px] rounded-full font-ui font-bold text-white"
          style={{
            background: "#6d28d9",
            padding: "8px 20px",
            fontSize: 28,
            boxShadow: "0 0 24px rgba(124,58,237,.7)",
          }}
        >
          <Pause size={26} fill="#fff" /> تجمّد الزمن
        </span>
        <span
          dir="ltr"
          className="rounded-[12px] font-bold"
          style={{
            fontFamily: "var(--font-mono)",
            color: "#ddd6fe",
            fontSize: 28,
            background: "rgba(10,6,24,.8)",
            border: "1.5px solid rgba(167,139,250,.6)",
            padding: "6px 14px",
          }}
        >
          00:09.700
        </span>
      </div>

      {pauseFlash > 0 ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: pauseFlash }}>
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 280,
              height: 280,
              background: "rgba(76,29,149,.6)",
              border: "6px solid #c4b5fd",
              transform: `scale(${1.3 - 0.3 * pauseFlash})`,
              boxShadow: "0 0 40px rgba(167,139,250,.7)",
              willChange: "transform",
            }}
          >
            <Pause size={150} color="#fff" fill="#fff" />
          </div>
        </div>
      ) : null}

      {t >= T.radarIn ? (
        <div
          className="absolute overflow-hidden rounded-[40px]"
          style={{
            left: 44,
            right: 44,
            top: 724,
            opacity: panel,
            transform: `translateY(${(1 - panel) * 160}px) scale(${0.94 + 0.06 * panel})`,
            background: "linear-gradient(160deg, rgba(20,12,44,.94), rgba(6,6,16,.94))",
            border: "2px solid rgba(167,139,250,.75)",
            boxShadow: "0 0 30px rgba(124,58,237,.4)",
            willChange: "transform",
            padding: "18px 24px 14px",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(167,139,250,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,.07) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-[14px]">
              <MeqyasMark size={56} />
              <div className="font-ui text-white">
                <div className="font-bold" style={{ fontSize: 34, lineHeight: 1.1 }}>
                  مِقياس <span style={{ color: "#a5b4fc" }}>AI</span>
                </div>
                <div style={{ fontSize: 21, color: "#c4b5fd" }}>رادار تجربة العملاء · وضع الاحتواء</div>
              </div>
            </div>
            <div className="flex items-center gap-[10px]">
              <span
                className="flex items-center gap-[8px] rounded-full font-bold"
                style={{
                  background: "rgba(244,63,94,.2)",
                  border: "1.5px solid #fb7185",
                  color: "#fecdd3",
                  padding: "4px 14px",
                  fontSize: 20,
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 11,
                    height: 11,
                    background: "#f43f5e",
                    opacity: Math.floor(t * 3) % 2 ? 0.3 : 1,
                  }}
                />
                LIVE
              </span>
              <span
                dir="ltr"
                className="rounded-full font-bold"
                style={{
                  background: "rgba(103,232,249,.14)",
                  border: "1.5px solid #67e8f9",
                  color: "#cffafe",
                  padding: "4px 14px",
                  fontSize: 21,
                  fontFamily: "var(--font-mono)",
                }}
              >
                T−300ms
              </span>
            </div>
          </div>
          <div className="relative mt-[12px] flex items-center gap-[22px]">
            <Radar t={t} size={270} />
            <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
              {CHECKS.map((c, i) => (
                <CheckRow key={i} c={c} t={t} at={T.checks[i]} />
              ))}
            </div>
          </div>
          <div
            className="relative mt-[10px] flex items-center justify-between font-ui"
            style={{ fontSize: 20, color: "#a1a1aa" }}
          >
            <span>
              زمن القرار:{" "}
              <b dir="ltr" style={{ color: decided ? "#6ee7b7" : "#e4e4e7", fontFamily: "var(--font-mono)" }}>
                {decided
                  ? "0.30s"
                  : `${(0.3 * clamp((t - T.radarIn) / (T.decision - T.radarIn))).toFixed(2)}s`}
              </b>
            </span>
            <span>كل رقم تحسبه المنصة · والقرار وفق سياسة المتجر</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
