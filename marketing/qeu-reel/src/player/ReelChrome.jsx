import { Bookmark, Camera, ChevronLeft, Ellipsis, Heart, MessageCircle, Music2, Send } from "lucide-react";

import { clamp, hash } from "../reel/anim.js";
import { MeqyasMark, VerifiedBadge } from "../reel/parts/brand.jsx";
import { DURATION, T } from "../reel/timeline.js";

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} ألف` : String(n);
}

function RailItem({ icon: Icon, label, fill }) {
  return (
    <div
      className="flex flex-col items-center gap-[10px]"
      style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,.6))" }}
    >
      <Icon size={66} strokeWidth={2} fill={fill ?? "none"} color={fill ?? "#fff"} />
      <span className="font-bold" style={{ fontSize: 30 }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Simulated Reels/TikTok interface drawn over the 1080 × 1920 stage — player only, never part
 * of the exported video (the platform adds its own). Mirrored for Arabic (rail on the left).
 */
export function ReelChrome({ t }) {
  const q = Math.floor(t * 2) / 2; // counters tick twice a second
  const likes = 48200 + Math.floor(q * 830) + (q > T.posted ? Math.floor((q - T.posted) * 4200) : 0);
  const cta = t >= T.url;
  const loved = t > T.posted;
  return (
    <div className="pointer-events-none absolute inset-0 font-ui text-white" dir="rtl">
      <div
        className="absolute inset-x-0 top-0"
        style={{ height: 240, background: "linear-gradient(to bottom, rgba(0,0,0,.45), transparent)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: 640, background: "linear-gradient(to top, rgba(0,0,0,.72), transparent)" }}
      />
      <div className="absolute flex items-center justify-between" style={{ top: 58, left: 48, right: 48 }}>
        <span className="font-bold" style={{ fontSize: 52 }}>
          ريلز
        </span>
        <Camera size={58} />
      </div>

      <div className="absolute flex flex-col items-center" style={{ left: 30, bottom: 290, gap: 44 }}>
        <div className="relative">
          <RailItem icon={Heart} label={fmt(likes)} fill={loved ? "#ff3040" : undefined} />
          {loved
            ? [0, 1, 2, 3, 4, 5].map((i) => {
                const p = ((t - T.posted) * 0.9 + i / 6) % 1;
                return (
                  <Heart
                    key={i}
                    size={40}
                    fill="#ff3040"
                    color="#ff3040"
                    className="absolute"
                    style={{
                      left: 14 + (hash(i * 3.3) - 0.5) * 60,
                      top: -20,
                      opacity: clamp(1 - p),
                      transform: `translateY(${-380 * p}px) scale(${0.6 + p})`,
                      willChange: "transform, opacity",
                    }}
                  />
                );
              })
            : null}
        </div>
        <RailItem icon={MessageCircle} label="2,914" />
        <RailItem icon={Send} label="12.3 ألف" />
        <Bookmark size={62} />
        <Ellipsis size={62} />
        <div
          className="overflow-hidden rounded-[16px]"
          style={{
            width: 74,
            height: 74,
            border: "4px solid #fff",
            transform: `rotate(${(t * 50) % 360}deg)`,
            willChange: "transform",
          }}
        >
          <MeqyasMark size={66} />
        </div>
      </div>

      <div className="absolute" style={{ right: 44, left: 170, bottom: 156 }}>
        <div className="flex items-center gap-[18px]">
          <MeqyasMark size={86} style={{ borderRadius: 999, border: "3px solid #fff" }} />
          <div>
            <div className="flex items-center gap-[10px] font-bold" style={{ fontSize: 40 }}>
              <span dir="ltr">meqyas.ai</span> <VerifiedBadge size={38} />
            </div>
            <div style={{ fontSize: 30, opacity: 0.8 }}>مُموَّل</div>
          </div>
          <span
            className="rounded-[16px] font-bold"
            style={{ border: "3px solid rgba(255,255,255,.85)", padding: "6px 28px", fontSize: 34 }}
          >
            متابعة
          </span>
        </div>
        <div style={{ fontSize: 36, marginTop: 20, lineHeight: 1.4 }}>
          لا تخلّي الكرتون المطعوج يفضحك في إكس! 📦💥 <b>#مقياس_AI</b> <b>#كيو</b>
        </div>
        <div className="flex items-center gap-[12px]" style={{ fontSize: 32, marginTop: 12, opacity: 0.9 }}>
          <Music2 size={34} /> الصوت الأصلي · مِقياس AI × كِيو
        </div>
      </div>

      <div
        className="absolute flex items-center justify-between font-bold"
        style={{
          left: 0,
          right: 0,
          bottom: 36,
          height: 96,
          padding: "0 46px",
          fontSize: 38,
          background: cta ? "#3b82f6" : "rgba(255,255,255,.14)",
          boxShadow: cta ? "0 0 40px rgba(59,130,246,.8)" : "none",
        }}
      >
        <span>اعرف المزيد</span>
        <ChevronLeft size={48} />
      </div>
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: 8,
          background: "#fff",
          transform: `scaleX(${t / DURATION})`,
          transformOrigin: "100% 50%",
          willChange: "transform",
        }}
      />
    </div>
  );
}
