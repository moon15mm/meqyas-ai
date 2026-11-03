import {
  BarChart2,
  Bike,
  Bookmark,
  CalendarClock,
  Camera,
  ChevronRight,
  Delete,
  Globe,
  Heart,
  House,
  Image,
  ImagePlay,
  ListOrdered,
  MapPin,
  MessageCircle,
  Mic,
  Package,
  Phone,
  Plus,
  Repeat2,
  Share,
  Smile,
  Store,
  Video,
  Wallet,
} from "lucide-react";

import { clamp, ease, fadeWindow, hash, lerp, noise, prog, spring, tick } from "../anim.js";
import { MeqyasMark, QeuMark, VerifiedBadge, WhatsAppGlyph, XLogo } from "../parts/brand.jsx";
import { Saud } from "../parts/Saud.jsx";
import { HAPPY_TWEET, T, WA_MESSAGE, draftAt, lastKeyAt } from "../timeline.js";

export const PHONE_W = 390;
export const PHONE_H = 844;
const X_BLUE = "#1d9bf0";
const POST_BTN = [52, 72];
const BANNER_TAP = [150, 104];

/* -------------------------------------------------------------------- choreography */

/** 0 → 1 while the world is frozen (10 s → 17 s). */
export function frozenAmount(t) {
  return clamp((t - T.freeze) / 0.2) * (1 - clamp((t - T.unfreeze) / 0.3));
}

/** Glitch bursts at the freeze and the unfreeze. */
export function glitchAmount(t) {
  const a = t >= T.freeze && t < T.freeze + 0.6 ? 1 - (t - T.freeze) / 0.6 : 0;
  const b = t >= T.unfreeze - 0.1 && t < T.unfreeze + 0.3 ? 1 - Math.abs(t - T.unfreeze - 0.05) / 0.25 : 0;
  return clamp(Math.max(a, b));
}

/** Where the phone sits on the stage (centre x/y, scale, tilt). */
export function rigPose(t) {
  const enter = spring(t, T.phoneIn, { stiffness: 150, damping: 18 });
  const settle = ease.inOutQuad(prog(t, 5.3, 8.0));
  const release = 1 - ease.inOutCubic(prog(t, T.unfreeze, T.unfreeze + 0.5));
  const push = ease.inOutCubic(prog(t, 8.0, 9.9)) * release;
  const back = ease.inOutCubic(prog(t, 10.55, 11.25)) * release;
  const joy = ease.outBack(prog(t, T.posted, T.posted + 0.6));
  const outro = ease.inCubic(prog(t, T.outro - 0.05, T.outro + 0.3));

  let x = 540 + 110 * push;
  let y = 1044 + (1 - enter) * 1500 + 120 * push;
  let s = 2 + 0.04 * settle + 0.24 * push - 0.08 * joy;
  let r = -2 + 2 * settle - (1 - enter) * 10;
  x = lerp(x, 540, back);
  y = lerp(y, 712, back);
  s = lerp(s, 1.42, back);
  r = lerp(r, -4, back);
  if (t > T.notif && t < T.notif + 0.6) x += Math.sin((t - T.notif) * 95) * 7 * Math.exp(-(t - T.notif) * 7);
  if (t > 17.4) y += Math.sin((t - 17.4) * 1.3) * 6;
  s *= 1 - 0.8 * outro;
  r += 25 * outro;
  return { x, y, s, r, rx: 16 * back, ry: -12 * back, opacity: 1 - outro };
}

/** Fingertip position (phone units) and hover height h (1 = lifted, 0 = touching). */
export function fingerPose(t) {
  if (t >= 7.9 && t < 19.6) {
    const tf = t >= T.freeze && t < T.unfreeze ? T.freeze : t;
    const inP = ease.outCubic(prog(tf, 7.9, 8.3));
    let x = lerp(-330, POST_BTN[0] + 16, inP);
    let y = lerp(300, POST_BTN[1] + 40, inP);
    let h = 1;
    const near = ease.inOutQuad(prog(tf, 9.35, 10.0));
    x = lerp(x, POST_BTN[0] + 6, near);
    y = lerp(y, POST_BTN[1] + 14, near);
    h = lerp(h, 0.32, near);
    const flinch = ease.outBack(prog(tf, T.notif, T.notif + 0.35));
    x = lerp(x, -70, flinch);
    y = lerp(y, -40, flinch);
    h = lerp(h, 1, flinch);
    const go = ease.inOutCubic(prog(tf, 18.35, 18.78));
    x = lerp(x, BANNER_TAP[0], go);
    y = lerp(y, BANNER_TAP[1] + 6, go);
    const press = tf >= T.notifTap && tf < T.notifTap + 0.16 ? 1 - Math.abs(tf - T.notifTap - 0.06) / 0.1 : 0;
    h = lerp(h, 0.55, go) * (1 - clamp(press));
    const leave = ease.inCubic(prog(tf, 18.98, 19.5));
    x -= 520 * leave;
    y += 260 * leave;
    const tremble = tf >= 8.25 && tf < 17.7 ? 1 : 0;
    x += noise(tf * 16, 1) * 2.6 * tremble;
    y += noise(tf * 16, 2) * 2.6 * tremble;
    return { x, y, h, press: clamp(press) };
  }
  if (t >= 28.9 && t < 29.95) {
    const inP = ease.outCubic(prog(t, 28.9, 29.22));
    const press = t >= T.postTap && t < T.postTap + 0.16 ? 1 - Math.abs(t - T.postTap - 0.06) / 0.1 : 0;
    const leave = ease.inCubic(prog(t, 29.45, 29.95));
    return {
      x: lerp(-330, POST_BTN[0] + 4, inP) - 520 * leave,
      y: lerp(300, POST_BTN[1] + 10, inP) + 240 * leave,
      h: (1 - inP * 0.5) * (1 - clamp(press)),
      press: clamp(press),
    };
  }
  return null;
}

/* ---------------------------------------------------------------------- pieces */

function StatusBar() {
  return (
    <div
      className="absolute inset-x-0 top-0 flex items-center justify-between font-ui font-semibold text-white"
      style={{ height: 47, padding: "12px 30px 0 34px", fontSize: 16 }}
    >
      <span dir="ltr">9:41</span>
      <div dir="ltr" className="flex items-center gap-[6px]">
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 4.6} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="1" fill="#fff" />
          ))}
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
          <path
            d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.6 7a6.2 6.2 0 0 1 8.8 0l-1.4 1.4a4.2 4.2 0 0 0-6 0zM1.4 4.8a9.3 9.3 0 0 1 13.2 0l-1.4 1.4a7.3 7.3 0 0 0-10.4 0z"
            fill="#fff"
          />
        </svg>
        <div
          className="relative rounded-[4px]"
          style={{ width: 25, height: 12, border: "1.4px solid rgba(255,255,255,.55)" }}
        >
          <div className="absolute rounded-[2px] bg-white" style={{ inset: 1.5, right: 5 }} />
        </div>
      </div>
    </div>
  );
}

function Avatar({ mood, t, size }) {
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{ width: size, height: size, background: "linear-gradient(160deg,#3a2f4a,#15111f)" }}
    >
      <Saud
        mood={mood}
        t={t}
        size={size * 1.05}
        style={{ marginTop: size * 0.06, marginInlineStart: -size * 0.025 }}
      />
    </div>
  );
}

const ROWS = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ذ", "ء", "ؤ", "ر", "ى", "ة", "و", "ز", "ظ", "د"],
];
const LETTERS = new Set(ROWS.flat());

function keyFor(ch) {
  if (!ch) return null;
  if (ch === "⌫") return "⌫";
  if (/\s/.test(ch)) return "space";
  const base = ch.normalize("NFD")[0];
  if (LETTERS.has(base)) return base;
  if (/\p{Extended_Pictographic}/u.test(ch)) return "emoji";
  return "123";
}

function Key({ label, w, pressed, dark, children }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-[6px]"
      style={{
        width: w,
        height: 42,
        background: pressed ? "#9a9aa0" : dark ? "#3a3a3d" : "#6b6b70",
        boxShadow: "0 1.5px 0 rgba(0,0,0,.55)",
        fontSize: 21,
        color: "#fff",
      }}
    >
      {children ?? label}
      {pressed && label && label.length === 1 ? (
        <div
          className="absolute flex items-start justify-center rounded-[10px]"
          style={{
            bottom: 30,
            width: w + 16,
            height: 62,
            background: "#9a9aa0",
            fontSize: 32,
            paddingTop: 6,
            boxShadow: "0 4px 10px rgba(0,0,0,.5)",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

function Keyboard({ tl }) {
  const key = lastKeyAt(tl);
  const pressed = key && tl - key.time < 0.1 ? keyFor(key.ch) : null;
  const holdBack = tl >= T.deleteStart && tl < T.deleteEnd + 0.05;
  const happy = tl >= T.retypeStart;
  const angry = tl < T.deleteStart;
  const sugg = happy ? ["كِيو", "شكراً", "👏"] : angry ? ["أسوأ", "والله", "🤬"] : ["امسح", "خلاص", "😅"];
  return (
    <div className="absolute inset-x-0 bottom-0 font-ui" style={{ height: 291, background: "#1f1f22" }}>
      <div
        className="flex items-center justify-around text-white"
        style={{ height: 44, fontSize: 17, borderBottom: "1px solid #2c2c30" }}
      >
        {sugg.map((s, i) => (
          <span key={i} style={{ opacity: i === 1 ? 1 : 0.8 }}>
            {s}
          </span>
        ))}
      </div>
      <div dir="ltr" className="flex flex-col items-center" style={{ paddingTop: 8, gap: 11 }}>
        {ROWS.map((row, r) => (
          <div key={r} className="flex" style={{ gap: 5 }}>
            {row.map((k) => (
              <Key key={k} label={k} w={r === 2 ? 28.5 : 30.4} pressed={pressed === k} />
            ))}
            {r === 2 ? (
              <Key w={46} dark pressed={holdBack || pressed === "⌫"}>
                <Delete size={22} />
              </Key>
            ) : null}
          </div>
        ))}
        <div className="flex" style={{ gap: 6 }}>
          <Key label="123" w={44} dark pressed={pressed === "123"}>
            <span style={{ fontSize: 15 }}>123</span>
          </Key>
          <Key w={40} dark pressed={pressed === "emoji"}>
            <Smile size={22} />
          </Key>
          <Key w={184} pressed={pressed === "space"}>
            <span style={{ fontSize: 15 }}>مسافة</span>
          </Key>
          <Key w={84} dark>
            <span style={{ fontSize: 15 }}>إدخال</span>
          </Key>
        </div>
      </div>
    </div>
  );
}

function XCompose({ tl, t }) {
  const text = draftAt(tl);
  const key = lastKeyAt(tl);
  const typing = key && tl - key.time < 0.45;
  const caretOn = typing || Math.floor(tl * 2.4) % 2 === 0;
  const tension = fadeWindow(tl, 8.2, 17.8, 0.3, 0.3);
  const glow = 0.5 + 0.5 * Math.sin(tl * 12);
  const pressed = t >= T.postTap && t < T.postTap + 0.2;
  const mood = tl < T.notif ? (tl < 7.85 ? "angry" : "furious") : tl < T.deleteStart ? "curious" : "delight";
  const count = [...text].length;
  return (
    <div className="absolute inset-0 bg-black font-ui text-white">
      <div
        className="absolute flex items-center justify-between"
        style={{ top: 50, left: 16, right: 18, height: 44 }}
      >
        <span style={{ fontSize: 17 }}>إلغاء</span>
        <div className="flex items-center gap-[14px]">
          <span style={{ fontSize: 15, color: X_BLUE, fontWeight: 600 }}>المسودات</span>
          <span
            className="rounded-full font-bold"
            style={{
              padding: "7px 19px",
              fontSize: 16,
              background: count ? X_BLUE : "#0e4d78",
              color: count ? "#fff" : "rgba(255,255,255,.55)",
              transform: pressed ? "scale(.9)" : undefined,
              boxShadow: tension > 0 ? `0 0 0 ${3 + 4 * glow}px rgba(244,63,94,${0.55 * tension})` : "none",
            }}
          >
            نشر
          </span>
        </div>
      </div>
      <div className="absolute flex items-start" style={{ top: 104, right: 16, left: 16, gap: 10 }}>
        <Avatar mood={mood} t={tl} size={44} />
        <div className="flex-1">
          <span
            className="inline-block rounded-full font-bold"
            style={{
              border: `1px solid ${X_BLUE}`,
              color: X_BLUE,
              fontSize: 13,
              padding: "2px 12px",
              marginTop: 2,
            }}
          >
            الجميع ⌄
          </span>
          <div
            style={{ marginTop: 12, fontSize: 21, lineHeight: 1.5, minHeight: 64, wordBreak: "break-word" }}
          >
            {text ? <span>{text}</span> : <span style={{ color: "#71767b" }}>ماذا يحدث؟!</span>}
            <span
              className="inline-block align-middle"
              style={{
                width: 2.5,
                height: 27,
                marginInline: 2,
                background: X_BLUE,
                opacity: caretOn ? 1 : 0,
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      </div>
      <div
        className="absolute flex items-center gap-[6px] font-bold"
        style={{
          top: 470,
          right: 16,
          left: 16,
          height: 32,
          color: X_BLUE,
          fontSize: 14.5,
          borderBottom: "1px solid #2f3336",
        }}
      >
        <Globe size={16} strokeWidth={2.4} /> يمكن للجميع الرد
      </div>
      <div
        className="absolute flex items-center justify-between"
        style={{ top: 506, right: 16, left: 16, height: 44 }}
      >
        <div className="flex items-center gap-[20px]" style={{ color: X_BLUE }}>
          {[Image, ImagePlay, ListOrdered, Smile, CalendarClock, MapPin].map((I, i) => (
            <I key={i} size={21} strokeWidth={2} />
          ))}
        </div>
        <div className="flex items-center gap-[10px]">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="10" fill="none" stroke="#2f3336" strokeWidth="2.6" />
            <circle
              cx="13"
              cy="13"
              r="10"
              fill="none"
              stroke={X_BLUE}
              strokeWidth="2.6"
              strokeDasharray={`${(Math.min(count, 280) / 280) * 62.8} 62.8`}
              transform="rotate(-90 13 13)"
              strokeLinecap="round"
            />
          </svg>
          <div style={{ width: 1, height: 26, background: "#2f3336" }} />
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 26, height: 26, border: `1.5px solid ${X_BLUE}`, color: X_BLUE }}
          >
            <Plus size={16} strokeWidth={2.6} />
          </div>
        </div>
      </div>
      <Keyboard tl={tl} />
    </div>
  );
}

function NotificationBanner({ t }) {
  const inP = spring(t, T.notif, { stiffness: 260, damping: 17 });
  const tapK = t >= T.notifTap ? Math.exp(-(t - T.notifTap) * 12) * Math.sin((t - T.notifTap) * 30) : 0;
  const fade = 1 - ease.inOutQuad(prog(t, T.chatOpen + 0.05, T.chatOpen + 0.3));
  return (
    <div
      className="absolute font-ui text-white"
      style={{
        top: 54,
        left: 8,
        right: 8,
        opacity: fade,
        transform: `translateY(${(1 - inP) * -130}px) scale(${1 - 0.04 * Math.abs(tapK)})`,
        borderRadius: 26,
        padding: "12px 14px 13px",
        background: "rgba(28,28,33,.94)",
        border: "1.5px solid rgba(74,222,128,.75)",
        boxShadow: "0 0 22px rgba(74,222,128,.5)",
      }}
    >
      <div className="flex items-start gap-[10px]">
        <WhatsAppGlyph size={38} style={{ flexShrink: 0, borderRadius: 9 }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between" style={{ fontSize: 13, color: "#a1a1aa" }}>
            <span>واتساب</span>
            <span>الآن</span>
          </div>
          <div className="flex items-center gap-[5px] font-bold" style={{ fontSize: 15.5 }}>
            كِيو QEU <VerifiedBadge size={15} color="#22c55e" />
          </div>
          <div
            style={{
              fontSize: 14.5,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {WA_MESSAGE} 🎁
          </div>
        </div>
      </div>
    </div>
  );
}

const WA_DOODLE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='none' stroke='%23ffffff' stroke-opacity='.05' stroke-width='2'><circle cx='20' cy='22' r='8'/><path d='M60 14h22v14H66l-6 6z'/><path d='M14 72l10-10 10 10-10 10z'/><circle cx='92' cy='80' r='11'/><path d='M50 98h20M60 88v20'/></g></svg>\")";

function countUp(t, t0, dur, target) {
  return target * ease.outCubic(prog(t, t0, t0 + dur));
}

function WhatsAppChat({ t }) {
  const dots = t >= T.typingDots && t < T.bubble;
  const bubble = spring(t, T.bubble, { stiffness: 300, damping: 18 });
  const wallet = spring(t, T.wallet, { stiffness: 300, damping: 18 });
  const delivery = spring(t, T.scooter, { stiffness: 300, damping: 18 });
  const scroll = -150 * ease.inOutCubic(prog(t, T.scooter - 0.05, T.scooter + 0.4));
  const shine = prog(t, T.bubble + 0.1, T.bubble + 0.8);
  const amount = countUp(t, T.wallet + 0.1, 0.8, 50);
  const ride = ease.inOutQuad(prog(t, T.scooter + 0.2, T.back));
  const eta = Math.max(19, Math.round(25 - 6 * ride));
  return (
    <div
      className="absolute inset-0 font-ui text-white"
      style={{ background: "#0b141a", backgroundImage: WA_DOODLE }}
    >
      <div className="absolute inset-0" style={{ transform: `translateY(${scroll}px)` }}>
        <div className="absolute inset-x-0 flex justify-center" style={{ top: 118 }}>
          <span
            className="rounded-[8px]"
            style={{ background: "#1f2c34", color: "#8696a0", fontSize: 12.5, padding: "4px 12px" }}
          >
            اليوم
          </span>
        </div>

        {dots ? (
          <div
            className="absolute flex items-center gap-[5px] rounded-[16px]"
            style={{ top: 160, right: 12, background: "#1f2c34", padding: "12px 16px" }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: "#8696a0",
                  transform: `translateY(${Math.sin(t * 14 - i) * 3}px)`,
                }}
              />
            ))}
          </div>
        ) : null}

        {t >= T.bubble ? (
          <div
            className="absolute overflow-hidden"
            style={{
              top: 156,
              right: 12,
              width: 312,
              transformOrigin: "100% 0%",
              transform: `scale(${0.6 + 0.4 * bubble})`,
              opacity: clamp(bubble * 1.5),
              borderRadius: "4px 18px 18px 18px",
              background: "linear-gradient(160deg, rgba(31,44,52,.98), rgba(14,33,30,.98))",
              border: "1.5px solid rgba(52,211,153,.85)",
              boxShadow: "0 0 26px rgba(52,211,153,.45), inset 0 0 18px rgba(52,211,153,.12)",
              padding: "10px 12px 8px",
            }}
          >
            <div className="flex items-center gap-[6px]" style={{ fontSize: 13 }}>
              <span className="font-bold" style={{ color: "#34d399" }}>
                كِيو QEU
              </span>
              <span
                className="flex items-center gap-[4px] rounded-full"
                style={{
                  background: "rgba(109,40,217,.35)",
                  border: "1px solid rgba(167,139,250,.6)",
                  padding: "1px 8px 1px 4px",
                  fontSize: 11,
                  color: "#ddd6fe",
                }}
              >
                <MeqyasMark size={14} /> مدعوم بـ مِقياس AI
              </span>
            </div>
            <div style={{ fontSize: 16.5, lineHeight: 1.65, marginTop: 6 }}>
              <div>اعتذارنا يا سعود.. 🙏</div>
              <div>
                نزل <b style={{ color: "#6ee7b7" }}>50 ريال</b> بمحفظتك فوراً 💸
              </div>
              <div>وبوكس جديد طالع لك الآن! 🚚</div>
            </div>
            <div style={{ fontSize: 11, color: "#8696a0", textAlign: "left" }}>9:41 م</div>
            {shine > 0 && shine < 1 ? (
              <div
                className="absolute inset-y-0"
                style={{
                  width: 90,
                  left: `${-30 + 130 * shine}%`,
                  background: "linear-gradient(100deg, transparent, rgba(255,255,255,.22), transparent)",
                  transform: "skewX(-18deg)",
                }}
              />
            ) : null}
          </div>
        ) : null}

        {t >= T.wallet - 0.05 ? (
          <div
            className="absolute"
            style={{
              top: 352,
              right: 12,
              width: 312,
              transformOrigin: "100% 0%",
              transform: `scale(${0.6 + 0.4 * wallet})`,
              opacity: clamp(wallet * 1.5),
              borderRadius: "4px 18px 18px 18px",
              padding: "12px 14px",
              background: "linear-gradient(135deg, #065f46, #10b981 70%, #34d399)",
              boxShadow: "0 0 30px rgba(16,185,129,.55)",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[8px] font-bold" style={{ fontSize: 15 }}>
                <Wallet size={22} /> محفظة كِيو
              </div>
              <span
                className="rounded-full font-bold"
                style={{ background: "rgba(0,0,0,.22)", fontSize: 11.5, padding: "2px 10px" }}
              >
                تعويض فوري ⚡
              </span>
            </div>
            <div
              className="font-black"
              dir="ltr"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 40,
                lineHeight: 1.15,
                marginTop: 4,
                textAlign: "right",
              }}
            >
              +{amount.toFixed(2)} <span style={{ fontSize: 20 }}>ر.س</span>
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>أُضيفت لرصيدك الآن · بدون طلب ولا انتظار</div>
            {[0, 1, 2].map((i) => {
              const c = prog(t, T.wallet + 0.05 + i * 0.12, T.wallet + 0.55 + i * 0.12);
              return c > 0 && c < 1 ? (
                <span
                  key={i}
                  className="absolute flex items-center justify-center rounded-full font-black"
                  style={{
                    width: 26,
                    height: 26,
                    fontSize: 13,
                    color: "#713f12",
                    background: "radial-gradient(circle at 35% 30%, #fef08a, #eab308)",
                    border: "2px solid #a16207",
                    right: 40 + 120 * c + i * 18,
                    top: 70 - 90 * Math.sin(Math.PI * c),
                    opacity: 1 - c * 0.3,
                  }}
                >
                  ﷼
                </span>
              ) : null;
            })}
          </div>
        ) : null}

        {t >= T.scooter - 0.05 ? (
          <div
            className="absolute"
            style={{
              top: 496,
              right: 12,
              width: 312,
              transformOrigin: "100% 0%",
              transform: `scale(${0.6 + 0.4 * delivery})`,
              opacity: clamp(delivery * 1.5),
              borderRadius: "4px 18px 18px 18px",
              padding: "12px 14px 14px",
              background: "rgba(31,44,52,.98)",
              border: "1.5px solid rgba(52,211,153,.6)",
            }}
          >
            <div className="flex items-center justify-between" style={{ fontSize: 14.5 }}>
              <div className="flex items-center gap-[8px] font-bold">
                <Package size={20} color="#34d399" /> بوكس بديل · #4821
              </div>
              <span className="flex items-center gap-[5px]" style={{ fontSize: 12, color: "#6ee7b7" }}>
                <span
                  className="inline-block rounded-full"
                  style={{ width: 8, height: 8, background: "#34d399", opacity: 0.5 + 0.5 * Math.sin(t * 9) }}
                />
                طالع لك الآن
              </span>
            </div>
            <div className="relative" style={{ height: 46, marginTop: 10 }}>
              <div
                className="absolute"
                style={{
                  top: 22,
                  left: 26,
                  right: 26,
                  height: 3,
                  background: "repeating-linear-gradient(90deg,#34d399 0 8px,transparent 8px 14px)",
                  opacity: 0.6,
                }}
              />
              <div
                className="absolute"
                style={{
                  top: 22,
                  right: 26,
                  width: `calc((100% - 52px) * ${ride})`,
                  height: 3,
                  background: "#34d399",
                }}
              />
              <Store size={24} className="absolute" style={{ right: 0, top: 11 }} color="#a7f3d0" />
              <House size={24} className="absolute" style={{ left: 0, top: 11 }} color="#a7f3d0" />
              <div
                className="absolute flex items-center justify-center rounded-full"
                style={{
                  top: 5,
                  right: `calc(14px + (100% - 64px) * ${ride})`,
                  width: 36,
                  height: 36,
                  background: "#10b981",
                  boxShadow: "0 0 16px rgba(16,185,129,.8)",
                }}
              >
                <Bike size={22} style={{ transform: "scaleX(-1)" }} />
              </div>
            </div>
            <div className="flex items-center justify-between" style={{ fontSize: 13, marginTop: 6 }}>
              <span style={{ color: "#8696a0" }}>يوصلك خلال</span>
              <b style={{ fontSize: 16, color: "#6ee7b7" }}>{eta} دقيقة</b>
            </div>
          </div>
        ) : null}
      </div>
      <div
        className="absolute inset-x-0 top-0 flex items-end"
        style={{ height: 108, background: "#1f2c34", padding: "0 12px 10px" }}
      >
        <div className="flex w-full items-center gap-[10px]">
          <ChevronRight size={26} />
          <QeuMark size={40} style={{ borderRadius: 999 }} />
          <div className="flex-1">
            <div className="flex items-center gap-[5px] font-bold" style={{ fontSize: 17 }}>
              كِيو QEU <VerifiedBadge size={16} color="#22c55e" />
            </div>
            <div style={{ fontSize: 12.5, color: "#8696a0" }}>حساب تجاري رسمي · متصل الآن</div>
          </div>
          <Video size={22} />
          <Phone size={20} style={{ marginInlineStart: 14 }} />
        </div>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex items-center gap-[10px]"
        style={{ height: 76, background: "#1f2c34", padding: "0 12px 22px" }}
      >
        <Plus size={24} color="#8696a0" />
        <div
          className="flex-1 rounded-full"
          style={{ background: "#2a3942", color: "#8696a0", fontSize: 15, padding: "8px 14px" }}
        >
          رسالة
        </div>
        <Camera size={22} color="#8696a0" />
        <Mic size={22} color="#8696a0" />
      </div>
    </div>
  );
}

function fmtK(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} ألف` : String(Math.round(n));
}

function PostedTweet({ t }) {
  const age = t - T.posted;
  const likes = 12400 * ease.outQuad(clamp(age / 1.4));
  const reposts = 3100 * ease.outQuad(clamp(age / 1.4));
  const views = 284000 * ease.outQuad(clamp(age / 1.4));
  const glow = fadeWindow(t, T.posted, 32, 0.2, 0.5);
  const reply = spring(t, 30.15, { stiffness: 280, damping: 18 });
  const toast = fadeWindow(t, T.posted + 0.1, T.posted + 1.2, 0.15, 0.2);
  const heartPop = spring(t, T.posted + 0.15, { stiffness: 500, damping: 10 });
  return (
    <div className="absolute inset-0 bg-black font-ui text-white">
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: 52 }}>
        <XLogo size={26} />
        <div
          className="mt-[10px] flex w-full justify-around font-bold"
          style={{ fontSize: 15, borderBottom: "1px solid #2f3336" }}
        >
          <span style={{ paddingBottom: 10, borderBottom: `3px solid ${X_BLUE}` }}>لك</span>
          <span style={{ paddingBottom: 10, color: "#71767b" }}>متابَعة</span>
        </div>
      </div>
      <div
        className="absolute inset-x-0"
        style={{
          top: 128,
          padding: "14px 16px",
          borderBottom: "1px solid #2f3336",
          background: `rgba(29,155,240,${0.1 * glow})`,
          boxShadow: `inset 0 0 0 1.5px rgba(29,155,240,${0.5 * glow})`,
        }}
      >
        <div className="flex gap-[10px]">
          <Avatar mood="delight" t={t} size={44} />
          <div className="flex-1">
            <div className="flex items-center gap-[4px]" style={{ fontSize: 15 }}>
              <b>سعود</b> <VerifiedBadge size={16} />
              <span style={{ color: "#71767b" }} dir="ltr">
                @saud_ksa · الآن
              </span>
            </div>
            <div style={{ fontSize: 19, lineHeight: 1.5, marginTop: 4 }}>{HAPPY_TWEET}</div>
            <div
              className="mt-[12px] flex items-center justify-between"
              style={{ color: "#71767b", fontSize: 13.5 }}
            >
              <span className="flex items-center gap-[4px]">
                <MessageCircle size={17} /> {fmtK(420 * clamp(age / 1.4))}
              </span>
              <span className="flex items-center gap-[4px]" style={{ color: "#00ba7c" }}>
                <Repeat2 size={18} /> {fmtK(reposts)}
              </span>
              <span className="relative flex items-center gap-[4px]" style={{ color: "#f91880" }}>
                <Heart size={17} fill="#f91880" style={{ transform: `scale(${0.6 + 0.4 * heartPop})` }} />{" "}
                {fmtK(likes)}
                {[0, 1, 2, 3, 4].map((i) => {
                  const p = (age * 1.4 + i * 0.2) % 1;
                  return age > 0 ? (
                    <Heart
                      key={i}
                      size={14}
                      fill="#f91880"
                      color="#f91880"
                      className="absolute"
                      style={{ right: 4 + (hash(i) - 0.5) * 20, top: -6 - 70 * p, opacity: 1 - p }}
                    />
                  ) : null;
                })}
              </span>
              <span className="flex items-center gap-[4px]">
                <BarChart2 size={17} /> {fmtK(views)}
              </span>
              <span className="flex items-center gap-[12px]">
                <Bookmark size={17} />
                <Share size={17} />
              </span>
            </div>
          </div>
        </div>
      </div>
      {t >= 30.15 ? (
        <div
          className="absolute inset-x-0"
          style={{
            top: 318,
            padding: "12px 16px",
            opacity: reply,
            transform: `translateY(${(1 - reply) * 18}px)`,
            borderBottom: "1px solid #2f3336",
          }}
        >
          <div className="flex gap-[10px]">
            <QeuMark size={40} style={{ borderRadius: 999 }} />
            <div className="flex-1">
              <div className="flex items-center gap-[4px]" style={{ fontSize: 14.5 }}>
                <b>كِيو QEU</b> <VerifiedBadge size={15} color="#e2b719" />
                <span style={{ color: "#71767b" }} dir="ltr">
                  @QEU_app · الآن
                </span>
              </div>
              <div style={{ fontSize: 16.5, lineHeight: 1.5, marginTop: 2 }}>
                تسلم يا سعود 💚 شرفتنا، وطلبك الجديد على الطريق!
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {toast > 0 ? (
        <div className="absolute inset-x-0 flex justify-center" style={{ bottom: 44, opacity: toast }}>
          <span
            className="rounded-full font-bold"
            style={{
              background: X_BLUE,
              fontSize: 15,
              padding: "10px 20px",
              boxShadow: "0 8px 24px rgba(0,0,0,.5)",
            }}
          >
            تم إرسال منشورك ✓
          </span>
        </div>
      ) : null}
    </div>
  );
}

const FINGER_PATH = "M-300 -23 L-46 -23 C-16 -23 6 -14 6 0 C6 14 -16 23 -46 23 L-300 23 Z";

function Finger({ pose }) {
  if (!pose) return null;
  const { x, y, h } = pose;
  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y, width: 0, height: 0 }}>
      <svg
        width="320"
        height="70"
        viewBox="-310 -35 320 70"
        style={{
          position: "absolute",
          left: -310 + (8 + 16 * h),
          top: -35 + (12 + 20 * h),
          overflow: "visible",
          opacity: 0.3 - 0.12 * h,
          transform: "rotate(18deg)",
          transformOrigin: "310px 35px",
        }}
        aria-hidden="true"
      >
        <path d={FINGER_PATH} fill="#000" />
      </svg>
      <svg
        width="320"
        height="70"
        viewBox="-310 -35 320 70"
        style={{
          position: "absolute",
          left: -310,
          top: -35,
          overflow: "visible",
          transform: `rotate(18deg) scale(${1 + 0.05 * h})`,
          transformOrigin: "310px 35px",
        }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fingerSkin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e7b48a" />
            <stop offset=".55" stopColor="#d39a6c" />
            <stop offset="1" stopColor="#b77d52" />
          </linearGradient>
        </defs>
        <path d={FINGER_PATH} fill="url(#fingerSkin)" stroke="#9a6440" strokeWidth="1.5" />
        <path
          d="M-36 -16 C-14 -16 0 -9 0 0 C0 9 -14 16 -36 16 C-43 16 -45 9 -45 0 C-45 -9 -43 -16 -36 -16 Z"
          fill="#f3cfb0"
          stroke="#c99470"
          strokeWidth="1.4"
        />
        <path
          d="M-34 -11 C-20 -11 -10 -7 -8 -2"
          stroke="#fff"
          strokeOpacity=".6"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M-104 -14 q5 14 0 28 M-112 -12 q4 12 0 24 M-178 -16 q6 16 0 32"
          stroke="#9a6440"
          strokeOpacity=".55"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    </div>
  );
}

/** Freeze annotation pinned to the Post button: target ring + «300ms قبل النشر». */
function FreezeCallout({ t, fz }) {
  const p = ease.outBack(prog(t, T.freeze + 0.25, T.freeze + 0.7));
  if (p <= 0) return null;
  const dash = (t * 40) % 24;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity: fz }}>
      <svg
        className="absolute"
        style={{ left: POST_BTN[0] - 46, top: POST_BTN[1] - 46, overflow: "visible" }}
        width="92"
        height="92"
        viewBox="-46 -46 92 92"
        aria-hidden="true"
      >
        <circle
          r={40 * p}
          fill="none"
          stroke="#67e8f9"
          strokeWidth="2.5"
          strokeDasharray="8 4"
          strokeDashoffset={dash}
        />
        <circle r={4} fill="#67e8f9" />
        <path d="M-52 0h18M34 0h18M0 -52v18M0 34v18" stroke="#67e8f9" strokeWidth="2" />
      </svg>
      <div
        className="absolute font-ui font-bold"
        style={{
          left: POST_BTN[0] + 44,
          top: POST_BTN[1] + 34,
          transform: `scale(${p})`,
          transformOrigin: "0 0",
          background: "rgba(8,8,16,.9)",
          border: "1.5px solid #67e8f9",
          borderRadius: 12,
          padding: "5px 10px",
          color: "#cffafe",
          fontSize: 14,
          whiteSpace: "nowrap",
          boxShadow: "0 0 18px rgba(103,232,249,.45)",
        }}
      >
        <span dir="ltr" style={{ fontFamily: "var(--font-mono)", color: "#67e8f9", fontSize: 18 }}>
          300ms
        </span>{" "}
        قبل النشر ⚠
      </div>
    </div>
  );
}

function Screen({ t, fz }) {
  const tl = fz > 0 && t < T.unfreeze ? Math.min(t, T.freeze) : t;
  const waOpen = ease.inOutCubic(prog(t, T.chatOpen, T.chatOpen + 0.32));
  const swap = ease.inOutCubic(prog(t, T.back, T.back + 0.34));
  const post = ease.inOutCubic(prog(t, T.posted, T.posted + 0.32));
  const showCompose = t < T.chatOpen + 0.35 || (t >= T.back && t < T.posted + 0.35);
  const showWA = t >= T.chatOpen && t < T.back + 0.35;
  const inset = (a, b) => lerp(a, b, waOpen);
  return (
    <>
      {t >= T.posted ? (
        <div className="absolute inset-0" style={{ transform: `scale(${0.94 + 0.06 * post})` }}>
          <PostedTweet t={t} />
        </div>
      ) : null}
      {showCompose ? (
        <div
          className="absolute inset-0"
          style={{
            transform: t >= T.back ? `translate(${-120 * (1 - swap)}px, ${PHONE_H * post}px)` : undefined,
            filter: t >= T.back && swap < 1 ? `brightness(${0.6 + 0.4 * swap})` : undefined,
          }}
        >
          <XCompose tl={tl} t={t} />
        </div>
      ) : null}
      {showWA ? (
        <div
          className="absolute inset-0"
          style={{
            clipPath: `inset(${inset(54, 0)}px ${inset(8, 0)}px ${inset(PHONE_H - 152, 0)}px ${inset(8, 0)}px round ${inset(26, 0)}px)`,
            transform: `translateX(${PHONE_W * swap}px)`,
          }}
        >
          <WhatsAppChat t={t} />
        </div>
      ) : null}
      <StatusBar />
      <div
        className="absolute rounded-full bg-black"
        style={{ top: 11, left: "50%", width: 122, height: 35, transform: "translateX(-50%)" }}
      />
      {t >= T.notif && t < T.chatOpen + 0.32 ? <NotificationBanner t={t} /> : null}
      {fz > 0 ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: fz,
            background: "linear-gradient(160deg, rgba(103,232,249,.22), rgba(124,58,237,.22))",
            mixBlendMode: "screen",
          }}
        />
      ) : null}
    </>
  );
}

/** Digital tearing: offset colour bars that jump every frame while the glitch burst lasts. */
function GlitchBars({ t, g }) {
  if (g <= 0.02) return null;
  const f = tick(t, 30);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: 54 }}>
      {Array.from({ length: 8 }, (_, i) => {
        const r1 = hash(f * 7.13 + i * 3.7);
        const r2 = hash(f * 3.31 + i * 9.1);
        const r3 = hash(f * 5.77 + i);
        const color =
          i % 3 === 0 ? "rgba(103,232,249,.5)" : i % 3 === 1 ? "rgba(244,63,94,.45)" : "rgba(0,0,0,.7)";
        return r2 > 0.25 ? (
          <div
            key={i}
            className="absolute inset-x-0"
            style={{
              top: r1 * PHONE_H,
              height: 6 + r2 * 46,
              background: color,
              transform: `translateX(${(r3 - 0.5) * 90 * g}px)`,
            }}
          />
        ) : null;
      })}
    </div>
  );
}

/** Scenes 2–5 · the phone: angry draft → freeze → WhatsApp → happy post. */
export function PhoneRig({ t }) {
  if (t < T.phoneIn - 0.05 || t > T.outro + 0.35) return null;
  const p = rigPose(t);
  const fz = frozenAmount(t);
  const g = glitchAmount(t);
  const f = tick(t, 30);
  const filters = [];
  if (g > 0.02) {
    filters.push(
      `hue-rotate(${Math.round((hash(f) - 0.5) * 140 * g)}deg) saturate(${1 + g}) contrast(${1 + 0.4 * g})`,
    );
    if (t >= T.freeze && t < T.freeze + 0.07) filters.push("invert(1)");
  }
  if (fz > 0) filters.push(`grayscale(${0.8 * fz}) contrast(${1 + 0.15 * fz}) brightness(${1 - 0.1 * fz})`);
  const jx = g > 0.02 ? (hash(f * 1.7) - 0.5) * 46 * g : 0;
  const skew = g > 0.02 ? (hash(f * 2.3) - 0.5) * 14 * g : 0;
  return (
    <div
      className="absolute"
      style={{
        left: p.x - PHONE_W / 2,
        top: p.y - PHONE_H / 2,
        width: PHONE_W,
        height: PHONE_H,
        opacity: p.opacity,
        transform: `translateX(${jx}px) perspective(1800px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotate(${p.r}deg) skewX(${skew}deg) scale(${p.s})`,
        filter: filters.length ? filters.join(" ") : undefined,
        willChange: "transform",
      }}
    >
      <div
        className="absolute"
        style={{
          inset: -11,
          borderRadius: 64,
          background: "linear-gradient(145deg, #52525b, #0a0a0a 38%, #18181b 70%, #3f3f46)",
          boxShadow: "0 40px 80px rgba(0,0,0,.65), inset 0 0 0 1.5px rgba(255,255,255,.12)",
          willChange: "transform",
        }}
      />
      <div
        className="absolute rounded-[2px]"
        style={{ left: -13, top: 160, width: 3, height: 60, background: "#3f3f46" }}
      />
      <div
        className="absolute rounded-[2px]"
        style={{ right: -13, top: 190, width: 3, height: 90, background: "#3f3f46" }}
      />
      <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 54, background: "#000" }}>
        <Screen t={t} fz={fz} />
      </div>
      <GlitchBars t={t} g={g} />
      <Finger pose={fingerPose(t)} />
      {fz > 0 ? <FreezeCallout t={t} fz={fz} /> : null}
    </div>
  );
}
