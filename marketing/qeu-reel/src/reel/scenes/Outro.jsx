import { ArrowLeft } from "lucide-react";

import { clamp, ease, hash, prog, spring } from "../anim.js";
import { MeqyasMark, QeuMark } from "../parts/brand.jsx";
import { T } from "../timeline.js";

const CTA = [
  ["احمِ", "متجرك"],
  ["قبل", "أن", "يشتكي", "عميلك"],
];

/** Scene 6 · 31–35 s — iris into the brand, logo build, tagline, CTA and the link. */
export function OutroScene({ t }) {
  if (t < T.outro) return null;
  const iris = ease.inOutCubic(prog(t, T.outro, T.outro + 0.45));
  const logo = spring(t, T.logo, { stiffness: 210, damping: 13 });
  const arc = ease.inOutCubic(prog(t, T.logo + 0.1, T.logo + 0.5));
  const bars = [0, 1, 2].map((i) => ease.outBack(prog(t, T.logo + 0.18 + i * 0.12, T.logo + 0.5 + i * 0.12)));
  const word = spring(t, T.wordmark, { stiffness: 240, damping: 20 });
  const co = spring(t, T.wordmark + 0.2, { stiffness: 260, damping: 18 });
  const tag = spring(t, T.tagline, { stiffness: 240, damping: 20 });
  const cta = spring(t, T.cta, { stiffness: 240, damping: 20 });
  const url = spring(t, T.url, { stiffness: 260, damping: 15 });
  const glow = 0.6 + 0.4 * Math.sin(t * 4);
  // Iris wipe on the compositor: a scaled circular clip with a counter-scaled stage inside.
  const s = Math.max(0.001, iris);
  const R = 1400;
  return (
    <div
      className="absolute overflow-hidden rounded-full"
      style={{
        left: 540 - R,
        top: 700 - R,
        width: 2 * R,
        height: 2 * R,
        transform: `scale(${s})`,
        willChange: "transform",
      }}
    >
      <div
        className="absolute overflow-hidden"
        style={{
          left: R - 540,
          top: R - 700,
          width: 1080,
          height: 1920,
          transform: `scale(${1 / s})`,
          transformOrigin: "540px 700px",
          willChange: "transform",
        }}
      >
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(165deg, #12103a 0%, #2b2f9e 45%, #1f8fa3 100%)" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(700px 700px at 540px 640px, rgba(129,140,248,.55), transparent 70%)",
          }}
        />
        {[0, 1, 2, 3].map((i) => {
          const p = ((t - T.outro) * 0.45 + i / 4) % 1;
          return (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                left: 540 - 900,
                top: 640 - 900,
                width: 1800,
                height: 1800,
                border: "4px solid rgba(165,180,252,.35)",
                opacity: 1 - p,
                transform: `scale(${Math.max(0.001, p)})`,
                willChange: "transform, opacity",
              }}
            />
          );
        })}
        <div className="absolute inset-0" style={{ willChange: "transform" }}>
          {Array.from({ length: 14 }, (_, i) => {
            const x = 40 + hash(i * 2.7) * 1000;
            const h = 60 + hash(i * 5.1) * 220;
            const rise = ((t - T.outro) * (60 + hash(i) * 80) + hash(i * 9.9) * 1900) % 2100;
            return (
              <div
                key={i}
                className="absolute top-0 left-0 rounded-full"
                style={{
                  width: 16,
                  height: h,
                  transform: `translate(${x}px, ${1960 - rise}px)`,
                  background: "linear-gradient(to top, transparent, rgba(255,255,255,.22))",
                }}
              />
            );
          })}
        </div>

        <div
          className="absolute rounded-full"
          style={{
            left: 540 - 250,
            top: 390,
            width: 500,
            height: 500,
            background: "radial-gradient(closest-side, rgba(129,140,248,.9), transparent)",
            opacity: 0.55 * glow * clamp(logo),
            willChange: "opacity",
          }}
        />
        <div
          className="absolute"
          style={{
            left: 540 - 170,
            top: 470,
            width: 340,
            height: 340,
            transform: `scale(${0.3 + 0.7 * logo}) rotate(${(1 - logo) * -20}deg)`,
          }}
        >
          <div
            className="absolute inset-0"
            style={{ borderRadius: "27.5%", boxShadow: "0 30px 60px rgba(0,0,0,.4)" }}
          />
          <MeqyasMark size={340} arc={arc} bars={bars} style={{ position: "relative" }} />
        </div>

        <div
          className="absolute inset-x-0 text-center font-ui font-bold text-white"
          style={{
            top: 850,
            fontSize: 132,
            lineHeight: 1.1,
            opacity: word,
            transform: `translateY(${(1 - word) * 60}px)`,
            letterSpacing: `${(1 - word) * 12}px`,
          }}
        >
          مِقياس <span style={{ color: "#a5b4fc" }}>AI</span>
        </div>

        <div
          className="absolute inset-x-0 flex justify-center"
          style={{ top: 1010, opacity: co, transform: `scale(${0.8 + 0.2 * co})` }}
        >
          <span
            className="flex items-center gap-[14px] rounded-full font-ui font-bold text-white"
            style={{
              background: "rgba(6,6,20,.45)",
              border: "2px solid rgba(255,255,255,.25)",
              padding: "8px 26px 8px 12px",
              fontSize: 34,
            }}
          >
            <QeuMark size={52} /> بالشراكة مع كِيو QEU
          </span>
        </div>

        <div
          className="absolute inset-x-0 text-center font-ui font-medium"
          style={{
            top: 1100,
            fontSize: 46,
            color: "rgba(255,255,255,.85)",
            opacity: tag,
            transform: `translateY(${(1 - tag) * 30}px)`,
          }}
        >
          من الفكرة إلى الدليل
        </div>

        <div
          className="absolute inset-x-0 flex flex-col items-center font-display font-black"
          style={{
            top: 1180,
            fontSize: 82,
            lineHeight: 1.2,
            opacity: cta,
            transform: `translateY(${(1 - cta) * 40}px)`,
          }}
        >
          {CTA.map((row, r) => (
            <div key={r} className="flex justify-center" style={{ gap: "0 20px" }}>
              {row.map((w, j) => {
                const i = r === 0 ? j : CTA[0].length + j;
                const lit = t >= T.cta + 0.12 * i;
                return (
                  <span
                    key={w}
                    style={{
                      color: lit ? "#6ee7b7" : "#ffffff",
                      textShadow: lit
                        ? "0 0 30px rgba(52,211,153,.75), 0 6px 0 rgba(0,0,0,.35)"
                        : "0 6px 0 rgba(0,0,0,.35)",
                      transform: lit
                        ? `scale(${1 + 0.08 * clamp(1 - (t - T.cta - 0.12 * i) / 0.25)})`
                        : undefined,
                      display: "inline-block",
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        <div
          className="absolute inset-x-0 flex justify-center"
          style={{ top: 1410, opacity: clamp(url * 1.4), transform: `scale(${0.7 + 0.3 * url})` }}
        >
          <div
            className="flex items-center gap-[18px] rounded-full font-ui font-bold"
            style={{
              background: "#ffffff",
              color: "#1e1b4b",
              padding: "16px 22px 16px 34px",
              fontSize: 48,
              boxShadow: "0 0 50px rgba(110,231,183,.6), 0 20px 50px rgba(0,0,0,.4)",
            }}
          >
            <span dir="ltr">meqyas.wardat.xyz</span>
            <span
              className="flex items-center gap-[8px] rounded-full text-white"
              style={{
                background: "linear-gradient(135deg,#3b3fc4,#1f8fa3)",
                padding: "8px 22px",
                fontSize: 32,
              }}
            >
              ابدأ الآن{" "}
              <ArrowLeft
                size={34}
                strokeWidth={3}
                style={{ transform: `translateX(${-6 * Math.sin(t * 6)}px)` }}
              />
            </span>
          </div>
        </div>

        <div
          className="absolute inset-x-0 text-center font-ui"
          style={{ top: 1530, fontSize: 24, color: "rgba(255,255,255,.55)", opacity: clamp(url) }}
        >
          * مشهد تمثيلي · التعويض يحدده المتجر وفق سياسته
        </div>
      </div>
    </div>
  );
}
