/**
 * The single source of truth for the reel: scenes, beats, texts, captions and SFX cues.
 * Pure data + pure helpers (no React, no DOM) so the player, the Remotion composition and
 * the soundtrack renderer (Node) all read the same timings.
 */

export const FPS = 30;
export const DURATION = 35;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const TOTAL_FRAMES = FPS * DURATION;

export const SCENES = [
  {
    id: "hook",
    n: 1,
    start: 0,
    end: 5,
    title: "الصدمة!",
    en: "The Drama Hook",
    color: "#f43f5e",
    brief: "فتح كرتون المقاضي: عصير منفجر وبيض مكسّر، زوم درامي «دُم دُم» ومؤشر نبض يقفز.",
  },
  {
    id: "tweet",
    n: 2,
    start: 5,
    end: 10,
    title: "الانتقام الرقمي",
    en: "The Angry Tweet",
    color: "#fb923c",
    brief: "سعود يكتب تغريدة غاضبة في إكس، وإصبعه معلّق فوق زر «نشر».",
  },
  {
    id: "freeze",
    n: 3,
    start: 10,
    end: 17,
    title: "التجميد التقني",
    en: "The AI Matrix Freeze",
    color: "#a78bfa",
    brief: "فرامل وتجمّد للزمن، ورادار مِقياس AI يحلّل التقييم ويكتشف الخطر قبل النشر بـ 300ms.",
  },
  {
    id: "contain",
    n: 4,
    start: 17,
    end: 26,
    title: "الاحتواء الفوري",
    en: "Instant Containment",
    color: "#34d399",
    brief: "إشعار واتساب من كِيو مدعوم بمِقياس: اعتذار و50 ريال في المحفظة وبوكس جديد في الطريق.",
  },
  {
    id: "delight",
    n: 5,
    start: 26,
    end: 31,
    title: "الانبهار",
    en: "Customer Delight",
    color: "#facc15",
    brief: "سعود يمسح التغريدة الغاضبة ويكتب: «كِيو أرفع لكم العقال!»",
  },
  {
    id: "outro",
    n: 6,
    start: 31,
    end: 35,
    title: "الشعار والدعوة",
    en: "Outro & Branding",
    color: "#818cf8",
    brief: "شعار مِقياس AI: من الفكرة إلى الدليل · احمِ متجرك قبل أن يشتكي عميلك.",
  },
];

/** Key beats in seconds — visuals, captions and the soundtrack all hit these. */
export const T = {
  // 1 · hook
  boxLand: 0.3,
  tapeRip: 0.82,
  flapsOpen: 0.92,
  flapsOpened: 1.45,
  crash: 1.6,
  zoom1: 2.12,
  zoom2: 2.56,
  zoom3: 3.0,
  angry: 3.38,
  pulseIn: 3.8,
  pulseTap: 4.16,
  pulseOut: 4.52,
  whoosh: 4.66,
  // 2 · angry tweet
  phoneIn: 4.78,
  beatA: 5.0,
  typeStart: 5.42,
  typeEnd: 7.82,
  fingerIn: 7.9,
  hoverStart: 8.25,
  // 3 · freeze
  freeze: 10.0,
  aiBoot: 10.55,
  radarIn: 10.85,
  checks: [11.5, 12.2, 12.9, 13.6, 15.05, 15.75],
  decision: 15.05,
  unfreeze: 16.95,
  // 4 · containment
  groove: 17.5,
  notif: 17.7,
  notifTap: 18.8,
  chatOpen: 18.95,
  typingDots: 19.05,
  bubble: 19.55,
  wallet: 21.5,
  scooter: 23.5,
  back: 25.95,
  // 5 · delight
  deleteStart: 26.32,
  deleteEnd: 27.3,
  retypeStart: 27.5,
  retypeEnd: 29.15,
  postTap: 29.3,
  posted: 29.5,
  iqal: 29.9,
  // 6 · outro
  outro: 30.95,
  sting: 31.1,
  logo: 31.15,
  wordmark: 31.7,
  tagline: 32.15,
  cta: 32.55,
  url: 33.4,
};

export const HEARTBEATS = [2.12, 2.56, 3.0, 3.42, 3.8, 4.15, 4.45, 8.25, 8.6, 8.92, 9.2, 9.45, 9.67, 9.86];

export const ANGRY_TWEET = "أسوأ تطبيق مقاضي شفته بحياتي! 🤬 والله ما أعديها...";
export const HAPPY_TWEET = "خدمة عملاء تسبقك بخطوة.. كِيو أرفع لكم العقال! 👏💚";
export const WA_MESSAGE = "اعتذارنا يا سعود.. نزل 50 ريال بمحفظتك فوراً وبوكس جديد طالع لك الآن!";

/* ------------------------------------------------------------------ helpers */

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("ar", { granularity: "grapheme" })
    : null;

/** User-perceived characters (keeps emoji sequences and Arabic diacritics whole). */
export function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Deterministic PRNG (mulberry32) — identical in the browser, Remotion and Node. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Human-ish key times for `count` keystrokes spread over [start, end]. */
export function typingTimes(count, start, end, seed) {
  const r = rng(seed);
  const gaps = Array.from({ length: count }, () => 0.55 + r() * 0.9 + (r() < 0.1 ? 1.1 : 0));
  const total = gaps.reduce((a, b) => a + b, 0) - gaps[count - 1];
  let acc = 0;
  return gaps.map((g) => {
    const time = start + (acc / total) * (end - start);
    acc += g;
    return time;
  });
}

/** Evenly spaced times (held backspace auto-repeat). */
export function evenTimes(count, start, end) {
  return Array.from({ length: count }, (_, i) => start + (i / Math.max(1, count - 1)) * (end - start));
}

export const ANGRY_CHARS = graphemes(ANGRY_TWEET);
export const HAPPY_CHARS = graphemes(HAPPY_TWEET);
export const ANGRY_TYPING = typingTimes(ANGRY_CHARS.length, T.typeStart, T.typeEnd, 7);
export const DELETE_TIMES = evenTimes(ANGRY_CHARS.length, T.deleteStart, T.deleteEnd);
export const HAPPY_TYPING = typingTimes(HAPPY_CHARS.length, T.retypeStart, T.retypeEnd, 11);

/** How many of `times` have happened by `t`. */
export function countAt(times, t) {
  let n = 0;
  while (n < times.length && times[n] <= t) n++;
  return n;
}

/** The tweet draft as it reads at time `t` (typed → deleted → retyped). */
export function draftAt(t) {
  if (t < T.deleteStart) return ANGRY_CHARS.slice(0, countAt(ANGRY_TYPING, t)).join("");
  if (t < T.retypeStart) {
    return ANGRY_CHARS.slice(0, ANGRY_CHARS.length - countAt(DELETE_TIMES, t)).join("");
  }
  return HAPPY_CHARS.slice(0, countAt(HAPPY_TYPING, t)).join("");
}

/** Last keystroke (time + typed grapheme) at or before t — drives the key highlight. */
export function lastKeyAt(t) {
  const pick = (chars, times) => {
    const n = countAt(times, t);
    return n ? { time: times[n - 1], ch: chars[n - 1] } : null;
  };
  if (t >= T.retypeStart) return pick(HAPPY_CHARS, HAPPY_TYPING);
  if (t >= T.deleteStart) {
    const n = countAt(DELETE_TIMES, t);
    return n ? { time: DELETE_TIMES[n - 1], ch: "⌫" } : null;
  }
  return pick(ANGRY_CHARS, ANGRY_TYPING);
}

export function sceneAt(t) {
  return SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];
}

export function formatTime(t) {
  const s = Math.max(0, t);
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  return `00:${String(whole).padStart(2, "0")}.${tenth}`;
}

/* ---------------------------------------------------------------- captions */

/**
 * Karaoke captions. `who` picks the speaker chip + highlight colour.
 * `y` (optional) moves a line when a scene needs the default band (centre y = 1268).
 */
export const SUBTITLES = [
  { start: 0, end: 1.55, who: "saud", text: "أخيييراً.. وصلت المقاضي! 😍" },
  { start: 1.62, end: 3.3, who: "saud", text: "لاااا! البيض تكسّر.. والعصير غرّق الكرتون 😱" },
  { start: 3.38, end: 4.9, who: "saud", text: "طيب يا كِيو.. والله لأفضحكم! 😤" },
  { start: 5.2, end: 7.85, who: "narrator", text: "فتح إكس.. والأصابع تولّع 🔥" },
  { start: 8.0, end: 9.98, who: "saud", text: "ثلاث.. اثنين.. وا—" },
  { start: 10.3, end: 11.5, who: "ai", text: "لحظة! ⏸ رصدنا عميل زعلان", y: 1365 },
  { start: 11.6, end: 14.05, who: "ai", text: "تقييم 1 من 5.. واحتمال شكوى علنية 94%", y: 1365 },
  { start: 14.15, end: 16.9, who: "ai", text: "اعتذار وتعويض فوري.. قبل النشر بـ 300ms ✅", y: 1365 },
  { start: 17.45, end: 19.3, who: "narrator", text: "وقبل لا يضغط «نشر».. وصله هذا 📲" },
  { start: 19.6, end: 22.9, who: "qeu", text: "اعتذارنا يا سعود.. نزل 50 ريال بمحفظتك فوراً" },
  { start: 23.05, end: 25.85, who: "saud", text: "لحظة لحظة.. خمسين ريال؟ وبوكس جديد؟! 😳" },
  { start: 26.3, end: 27.45, who: "saud", text: "امسح امسح امسح! 😅" },
  { start: 27.55, end: 30.85, who: "saud", text: "خدمة عملاء تسبقك بخطوة.. كِيو أرفع لكم العقال! 👏" },
];

/** Word timings: each word gets a share of the line proportional to its length. */
export function captionWords(line) {
  const words = line.text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => graphemes(w).length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = line.end - line.start - 0.22;
  let acc = line.start + 0.04;
  return words.map((word, i) => {
    const start = acc;
    acc += (weights[i] / total) * span;
    return { word, start, end: acc };
  });
}

/* -------------------------------------------------------------------- SFX */

/**
 * Visual sound-effect stickers (onomatopoeia + English tag). The soundtrack renders the real
 * sounds at the same beats. Positions are stage pixels (1080 × 1920), rot in degrees.
 */
export const SFX = [
  {
    id: "thud",
    start: 0.3,
    end: 0.95,
    ar: "طُب!",
    en: "BOX DROP",
    color: "#fbbf24",
    x: 250,
    y: 1150,
    rot: -10,
  },
  {
    id: "rip",
    start: 0.82,
    end: 1.4,
    ar: "شرررخ!",
    en: "TAPE RIP",
    color: "#fde68a",
    x: 800,
    y: 730,
    rot: 9,
  },
  {
    id: "crash",
    start: 1.6,
    end: 2.25,
    ar: "طَراااخ!",
    en: "CRACK & SPLASH",
    color: "#fb923c",
    x: 840,
    y: 1060,
    rot: 8,
  },
  {
    id: "heart",
    start: 2.12,
    end: 3.5,
    ar: "دُم.. دُم!",
    en: "HEARTBEAT · DUN DUN!",
    color: "#fb7185",
    x: 290,
    y: 1095,
    rot: -7,
    beats: [2.12, 2.56, 3.0],
  },
  {
    id: "keys",
    start: 5.45,
    end: 7.85,
    ar: "طَق طَق طَق!",
    en: "KEYBOARD · TACK TACK!",
    color: "#38bdf8",
    x: 330,
    y: 960,
    rot: -6,
    jitter: true,
  },
  {
    id: "heart2",
    start: 8.25,
    end: 9.95,
    ar: "دُم دُم دُم!",
    en: "HEARTBEAT ×2",
    color: "#fb7185",
    x: 740,
    y: 990,
    rot: 7,
    beats: [8.25, 8.6, 8.92, 9.2, 9.45, 9.67, 9.86],
  },
  {
    id: "brake",
    start: 10.0,
    end: 10.8,
    ar: "إيييييك!",
    en: "BRAKES!",
    color: "#f0abfc",
    x: 250,
    y: 1020,
    rot: -8,
  },
  {
    id: "glitch",
    start: 10.15,
    end: 11.0,
    ar: "تجمّد!",
    en: "GLITCH FREEZE!",
    color: "#67e8f9",
    x: 840,
    y: 1020,
    rot: 6,
  },
  {
    id: "lock",
    start: 15.05,
    end: 15.9,
    ar: "تِشك ✓",
    en: "DECISION LOCKED",
    color: "#6ee7b7",
    x: 250,
    y: 1500,
    rot: -6,
  },
  {
    id: "unfreeze",
    start: 16.95,
    end: 17.5,
    ar: "ووووش!",
    en: "UNFREEZE",
    color: "#c4b5fd",
    x: 540,
    y: 980,
    rot: -4,
  },
  {
    id: "ping",
    start: 17.7,
    end: 18.7,
    ar: "تِنْغ!",
    en: "WHATSAPP PING!",
    color: "#4ade80",
    x: 820,
    y: 640,
    rot: 8,
  },
  {
    id: "cash",
    start: 21.5,
    end: 22.45,
    ar: "كا-تشينغ!",
    en: "KA-CHING! +50",
    color: "#facc15",
    x: 280,
    y: 1130,
    rot: -8,
  },
  {
    id: "vroom",
    start: 23.5,
    end: 24.5,
    ar: "فرررم!",
    en: "VROOM",
    color: "#6ee7b7",
    x: 800,
    y: 1135,
    rot: 7,
  },
  {
    id: "delete",
    start: 26.32,
    end: 27.35,
    ar: "مسح! مسح!",
    en: "BACKSPACE ×50",
    color: "#fb7185",
    x: 300,
    y: 1150,
    rot: -7,
    jitter: true,
  },
  {
    id: "applause",
    start: 29.55,
    end: 30.9,
    ar: "تصفيق!",
    en: "APPLAUSE",
    color: "#fde047",
    x: 265,
    y: 1080,
    rot: -8,
  },
  {
    id: "sparkle",
    start: 29.9,
    end: 30.85,
    ar: "تِرِنْن ✨",
    en: "IQAL LIFT",
    color: "#e9d5ff",
    x: 640,
    y: 300,
    rot: -6,
  },
  {
    id: "sting",
    start: 31.1,
    end: 31.95,
    ar: "بووم!",
    en: "BRAND STING",
    color: "#a5b4fc",
    x: 540,
    y: 1500,
    rot: -5,
  },
];
