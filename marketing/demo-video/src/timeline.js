// Global timeline for the demo video. All times are in seconds.
// Voiceover segments are placed back to back; every scene and subtitle is timed against the
// pauses detected in the recorded audio (ffmpeg silencedetect, -38 dB / 0.35 s).

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 160;
export const TOTAL_FRAMES = DURATION * FPS;

/** Where each recorded segment starts in the video, and how long it is. */
export const SEG = {
  s1: { at: 1.0, len: 33.23, file: "audio/norm/seg1.wav" },
  s2: { at: 36.0, len: 55.8, file: "audio/norm/seg2.wav" },
  s3: { at: 94.0, len: 36.13, file: "audio/norm/seg3.wav" },
  s4: { at: 132.0, len: 22.13, file: "audio/norm/seg4.wav" },
};

const at = (seg, offset) => +(SEG[seg].at + offset).toFixed(2);

/** Scene boundaries (global seconds). */
export const SCENES = {
  // Part 1 — the problem
  p1Fragile: [0, at("s1", 5.36)],
  p1Hours: [at("s1", 5.36), at("s1", 10.64)],
  p1Dialects: [at("s1", 10.64), at("s1", 15.84)],
  p1Message: [at("s1", 15.84), at("s1", 22.17)],
  p1Generic: [at("s1", 22.17), at("s1", 29.65)],
  p1Gone: [at("s1", 29.65), SEG.s2.at],
  // Part 2 — live agent
  p2Intro: [SEG.s2.at, at("s2", 7.59)],
  p2Flow: [at("s2", 7.59), at("s2", 11.89)],
  p2Live: [at("s2", 11.89), at("s3", 0) - 2.2],
  // Part 3 — architecture
  p3Schema: [SEG.s3.at - 2.2, at("s3", 4.87)],
  p3Repair: [at("s3", 4.87), at("s3", 11.52)],
  p3Rails: [at("s3", 11.52), at("s3", 21.48)],
  p3Why: [at("s3", 21.48), at("s3", 28.29)],
  p3OnPrem: [at("s3", 28.29), SEG.s4.at],
  // Part 4 — proof & close
  p4Tests: [SEG.s4.at, at("s4", 10.86)],
  p4Live: [at("s4", 10.86), at("s4", 17.3)],
  p4Tagline: [at("s4", 17.3), at("s4", 21.54)],
  p4End: [at("s4", 21.54), DURATION],
};

/** Cue points inside the live-run scene (global seconds). */
export const LIVE = {
  send: at("s2", 15.5),
  result: at("s2", 19.98),
  dialect: at("s2", 22.9),
  sentiment: at("s2", 23.75),
  rootCause: at("s2", 24.95),
  urgency: at("s2", 27.95),
  churn: at("s2", 29.03),
  remedy: at("s2", 30.96),
  reply: at("s2", 33.2),
  sarcasm: at("s2", 37.73),
  sarcasmText: at("s2", 40.39),
  sarcasmEn: at("s2", 46.22),
  sarcasmResult: at("s2", 51.06),
};

/** Cue points elsewhere. */
export const CUE = {
  genericPositive: at("s1", 24.2),
  genericMissed: at("s1", 27.46),
  railClamp: at("s3", 14.87),
  railPositive: at("s3", 17.9),
  github: at("s4", 14.2),
};

/** English subtitles: [segment, start offset, end offset, text]. */
const LINES = [
  ["s1", 0.0, 4.8, "In the fast-growing GCC e-commerce market, customer retention is fragile."],
  ["s1", 5.36, 10.18, "When a delivery arrives damaged or late, support teams often take hours to respond."],
  ["s1", 10.64, 14.12, "And most sentiment tools struggle with Gulf and Saudi dialects."],
  ["s1", 14.55, 15.41, "Take this message:"],
  ["s1", 15.84, 21.65, "“Honestly, you did great — but the order was crushed, the soup spilled in the bag, and the food arrived cold!”"],
  ["s1", 22.17, 27.04, "A generic model sees “⁧ما قصرتوا⁩” — “you did great” — and can label it positive…"],
  ["s1", 27.46, 29.22, "…missing that the meal was ruined."],
  ["s1", 29.65, 33.2, "By the time someone replies, the customer may already be gone."],

  ["s2", 0.0, 7.0, "This is Meqyas AI: a customer-intelligence and retention engine for Arabic commerce, running on Meta Llama 3."],
  ["s2", 7.59, 11.46, "Our CX Retention Agent reads each complaint the moment it arrives."],
  ["s2", 11.89, 14.96, "Let’s run it live, on Llama 3.3 70B."],
  ["s2", 15.5, 19.49, "We send the same Saudi complaint, with the order value and customer history."],
  ["s2", 19.98, 24.6, "In seconds, it returns a structured result: the dialect… the sentiment…"],
  ["s2", 24.95, 30.46, "the root cause — a spilled, cold order… the urgency… and a churn-risk score."],
  ["s2", 30.96, 37.15, "It then proposes a remedy within policy, and drafts an apology in the customer’s own dialect, ready to send."],
  ["s2", 37.73, 39.82, "Now a harder case: sarcasm."],
  ["s2", 40.39, 45.65, "“Wow, the fastest restaurant in the world… two hours waiting, and the meal came frozen!”"],
  ["s2", 46.22, 50.5, "“The fastest restaurant in the world… two hours, and the food arrived frozen.”"],
  ["s2", 51.06, 55.8, "The agent sees through the praise, flags the sarcasm, and raises the urgency."],

  ["s3", 0.0, 4.48, "Under the hood, every agent in Meqyas has a strict Pydantic contract."],
  ["s3", 4.87, 11.1, "If the model returns invalid output, the platform asks it to repair the response before anything reaches the merchant."],
  ["s3", 11.52, 14.43, "On top of the model, deterministic rules keep it safe:"],
  ["s3", 14.87, 20.64, "compensation is capped at the order value for new customers, and positive feedback never triggers a payout."],
  ["s3", 21.48, 22.92, "Why Meta open weights?"],
  ["s3", 23.37, 27.92, "Under Saudi Arabia’s Personal Data Protection Law, data residency matters."],
  ["s3", 28.29, 36.1, "Because Llama can run on Ollama or vLLM inside the merchant’s own infrastructure, customer messages never have to leave it."],

  ["s4", 0.0, 1.98, "Meqyas is built test-first."],
  ["s4", 2.38, 10.49, "Our AI test suite — 83 tests covering structured-output repair, prompt-injection defense and the retention rules — runs in seconds."],
  ["s4", 10.86, 16.85, "The platform is live today at meqyas.wardat.xyz, and the code is open source on GitHub."],
  ["s4", 17.3, 21.08, "Meqyas AI… turning a bad moment into a loyal customer."],
  ["s4", 21.54, 22.1, "Thank you."],
];

export const SUBTITLES = LINES.map(([seg, a, b, text]) => ({ start: at(seg, a), end: at(seg, b), text }));
