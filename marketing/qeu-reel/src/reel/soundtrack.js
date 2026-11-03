/**
 * Procedural soundtrack — every SFX and the music bed are synthesized from math at the beats in
 * timeline.js. No samples, no licensed music, fully deterministic: the browser player and the
 * Node renderer (scripts/render-audio.mjs → Remotion) produce the same waveform.
 *
 * Pure JS (no DOM, no Web Audio) so it runs anywhere.
 */
import {
  ANGRY_CHARS,
  ANGRY_TYPING,
  DELETE_TIMES,
  DURATION,
  HAPPY_CHARS,
  HAPPY_TYPING,
  HEARTBEATS,
  T,
  rng,
} from "./timeline.js";

export const SAMPLE_RATE = 48000;

const TAU = Math.PI * 2;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const saw = (p) => 2 * (p - Math.floor(p)) - 1;

class Bus {
  constructor(n) {
    this.l = new Float32Array(n);
    this.r = new Float32Array(n);
  }
}

class Biquad {
  constructor(sr) {
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.b0 = 1;
    this.b1 = this.b2 = this.a1 = this.a2 = 0;
  }
  set(type, freq, q = 0.707) {
    const f = Math.max(20, Math.min(freq, this.sr * 0.45));
    const w = (TAU * f) / this.sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    let b0;
    let b1;
    let b2;
    if (type === "lp") {
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = b0;
    } else if (type === "hp") {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = b0;
    } else {
      b0 = al;
      b1 = 0;
      b2 = -al;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class OnePole {
  constructor(sr, f) {
    this.y = 0;
    this.a = 1 - Math.exp((-TAU * f) / sr);
  }
  run(x) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/**
 * Write one voice into a bus. `gen(tt, k)` is called once per sample, in order, with the local
 * time in seconds and the sample index, so generators can keep phase/filter state in closures.
 */
function play(S, { bus, t0, dur, gain = 1, pan = 0, send = 0, panAt = null }, gen) {
  const out = bus ?? S.sfx;
  const s0 = Math.round(t0 * S.sr);
  const len = Math.round(dur * S.sr);
  const to = Math.min(out.l.length, s0 + len);
  const inv = 1 / S.sr;
  let gl = 0;
  let gr = 0;
  const setPan = (p) => {
    const a = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4;
    gl = Math.cos(a) * gain;
    gr = Math.sin(a) * gain;
  };
  setPan(pan);
  for (let i = s0; i < to; i++) {
    const k = i - s0;
    const tt = k * inv;
    if (panAt && (k & 63) === 0) setPan(panAt(tt));
    const s = gen(tt, k);
    if (i < 0) continue;
    out.l[i] += s * gl;
    out.r[i] += s * gr;
    if (send) {
      S.verb.l[i] += s * gl * send;
      S.verb.r[i] += s * gr * send;
    }
  }
}

/* ------------------------------------------------------------------ instruments */

/** Per-sample factor of exp(-t / tau). */
const decayK = (S, tau) => Math.exp(-1 / (tau * S.sr));

function kick(S, t0, gain = 0.9, bus = S.music) {
  let ph = 0;
  const r = rng(Math.floor(t0 * 1000) + 1);
  const kp = decayK(S, 0.04);
  const ka = decayK(S, 0.17);
  const kc = decayK(S, 0.0025);
  let ep = 1;
  let ea = 1;
  let ec = 1;
  play(S, { bus, t0, dur: 0.45, gain }, () => {
    ph += (46 + 120 * ep) / S.sr;
    const body = Math.sin(TAU * ph) * ea;
    const click = (r() * 2 - 1) * ec * 0.35;
    ep *= kp;
    ea *= ka;
    ec *= kc;
    return Math.tanh(1.6 * (body + click));
  });
}

function thump(S, t0, f0, f1, decay, gain) {
  let ph = 0;
  const lp = new OnePole(S.sr, 180);
  const r = rng(Math.floor(t0 * 977) + 3);
  const k1 = decayK(S, 0.03);
  const k2 = decayK(S, 0.004);
  const k3 = decayK(S, decay);
  let e1 = 1;
  let e2 = 1;
  let e3 = 1;
  play(S, { bus: S.sfx, t0, dur: decay * 6, gain }, () => {
    ph += (f1 + (f0 - f1) * e1) / S.sr;
    const env = (1 - e2) * e3;
    e1 *= k1;
    e2 *= k2;
    e3 *= k3;
    return Math.tanh(2.2 * (Math.sin(TAU * ph) * env + lp.run(r() * 2 - 1) * env * 0.8));
  });
}

function heartbeat(S, t0, gain = 1) {
  thump(S, t0, 95, 48, 0.09, gain);
  thump(S, t0 + 0.17, 108, 56, 0.075, gain * 0.72);
}

function boom(S, t0, gain = 1, dur = 1.6) {
  let ph = 0;
  const r = rng(Math.floor(t0 * 331) + 5);
  const lp = new Biquad(S.sr).set("lp", 1600, 0.7);
  const k1 = decayK(S, 0.12);
  const k2 = decayK(S, 0.55);
  const k3 = decayK(S, 0.09);
  let e1 = 1;
  let e2 = 1;
  let e3 = 1;
  play(S, { bus: S.sfx, t0, dur, gain, send: 0.35 }, () => {
    ph += (30 + 62 * e1) / S.sr;
    const sub = Math.sin(TAU * ph) * e2;
    const n = lp.run(r() * 2 - 1) * e3 * 0.8;
    e1 *= k1;
    e2 *= k2;
    e3 *= k3;
    return Math.tanh(1.8 * (sub + n));
  });
}

/** Brassy saw stab — the "dun dun DUNNN" hits of the hook. */
function stab(S, t0, notes, dur, gain) {
  notes.forEach((n, j) => {
    const f = midi(n);
    let p1 = j * 0.31;
    let p2 = j * 0.57;
    let p3 = 0;
    const lp = new Biquad(S.sr);
    play(S, { bus: S.music, t0, dur: dur + 0.8, gain: gain / notes.length, send: 0.35 }, (tt, k) => {
      const vib = 1 + 0.005 * Math.sin(TAU * 5.5 * tt) * Math.min(1, tt / 0.4);
      p1 += (f * vib) / S.sr;
      p2 += (f * 1.007 * vib) / S.sr;
      p3 += (f * 0.5) / S.sr;
      const env =
        Math.min(1, tt / 0.02) * (tt < dur ? 1 - (0.3 * tt) / dur : 0.7 * Math.exp(-(tt - dur) / 0.2));
      if ((k & 31) === 0) lp.set("lp", 350 + 2800 * Math.exp(-tt / 0.3) * env, 0.9);
      return lp.run((saw(p1) + saw(p2) + 0.7 * saw(p3)) * 0.45) * env;
    });
  });
}

function tapeRip(S, t0, dur = 0.5) {
  const r = rng(4242);
  const bp = new Biquad(S.sr);
  let crack = 0;
  play(S, { bus: S.sfx, t0, dur, gain: 0.5, pan: 0.25 }, (tt, k) => {
    if ((k & 15) === 0) bp.set("bp", 900 + 2300 * (tt / dur), 0.9);
    if (r() < 0.006) crack = 1;
    crack *= 0.995;
    const env = Math.min(1, tt / 0.015) * Math.min(1, (dur - tt) / 0.06);
    return bp.run((r() * 2 - 1) * (0.35 + 1.5 * crack)) * env * 2.4;
  });
}

function crash(S, t0) {
  [0, 0.018, 0.041, 0.07].forEach((d, i) => {
    const r = rng(900 + i);
    const bp = new Biquad(S.sr).set("bp", 3200 + i * 650, 1.4);
    play(S, { bus: S.sfx, t0: t0 + d, dur: 0.05, gain: 0.85 - i * 0.12, pan: -0.3 + i * 0.2 }, (tt) => {
      return bp.run(r() * 2 - 1) * Math.exp(-tt / 0.006) * 3;
    });
  });
  {
    const r = rng(77);
    const bp = new Biquad(S.sr).set("bp", 1300, 0.8);
    play(S, { bus: S.sfx, t0, dur: 0.35, gain: 0.5 }, (tt) => {
      return bp.run(r() * 2 - 1) * Math.exp(-tt / 0.09) * (0.6 + 0.4 * Math.sin(TAU * 37 * tt)) * 2;
    });
  }
  {
    const r = rng(78);
    const lp = new Biquad(S.sr);
    play(S, { bus: S.sfx, t0: t0 + 0.03, dur: 0.75, gain: 0.55, send: 0.2 }, (tt, k) => {
      if ((k & 31) === 0) lp.set("lp", 600 + 2400 * Math.exp(-tt / 0.18), 0.7);
      return lp.run(r() * 2 - 1) * Math.min(1, tt / 0.008) * Math.exp(-tt / 0.22) * 1.6;
    });
  }
  const r = rng(79);
  for (let i = 0; i < 9; i++) {
    const at = t0 + 0.08 + r() * 0.6;
    const f0 = 300 + r() * 400;
    let ph = 0;
    play(S, { bus: S.sfx, t0: at, dur: 0.06, gain: 0.16, pan: r() * 1.4 - 0.7 }, (tt) => {
      ph += (f0 + 9000 * tt) / S.sr;
      return Math.sin(TAU * ph) * Math.sin((Math.PI * tt) / 0.06);
    });
  }
}

function whoosh(S, t0, dur = 0.45, up = true, gain = 0.45) {
  const r = rng(Math.floor(t0 * 101) + 9);
  const bp = new Biquad(S.sr);
  play(
    S,
    {
      bus: S.sfx,
      t0,
      dur,
      gain,
      send: 0.15,
      panAt: (tt) => (up ? -0.7 : 0.7) + (up ? 1.4 : -1.4) * (tt / dur),
    },
    (tt, k) => {
      const p = tt / dur;
      if ((k & 15) === 0) bp.set("bp", up ? 300 + 3300 * p * p : 3600 - 3200 * p, 0.8);
      return bp.run(r() * 2 - 1) * Math.pow(Math.sin(Math.PI * p), 2) * 2.6;
    },
  );
}

function keyClick(S, t0, gain = 0.3, pitch = 1, seed = 0) {
  const r = rng(seed + 17);
  const bp = new Biquad(S.sr).set("bp", 3400 * pitch, 1.1);
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur: 0.045, gain, pan: (r() - 0.5) * 0.5 }, (tt) => {
    ph += (190 * pitch) / S.sr;
    return (
      bp.run(r() * 2 - 1) * Math.exp(-tt / 0.0045) * 2.2 + Math.sin(TAU * ph) * Math.exp(-tt / 0.012) * 0.5
    );
  });
}

function riser(S, t0, dur, gain = 0.3) {
  const r = rng(5150);
  const bp = new Biquad(S.sr);
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur, gain, send: 0.2 }, (tt, k) => {
    const p = tt / dur;
    if ((k & 31) === 0) bp.set("bp", 400 + 5200 * p * p, 1.2);
    ph += (180 + 900 * p * p) / S.sr;
    const trem = 0.75 + 0.25 * Math.sin(TAU * (4 + 18 * p) * tt);
    return (bp.run(r() * 2 - 1) * 1.8 + Math.sin(TAU * ph) * 0.25) * p * p * trem;
  });
}

function brake(S, t0, dur = 0.75) {
  const r = rng(1010);
  const bp = new Biquad(S.sr);
  let ph = 0;
  let wob = 0;
  play(S, { bus: S.sfx, t0, dur, gain: 0.26, send: 0.3, pan: 0.15 }, (tt, k) => {
    const p = tt / dur;
    wob += (r() * 2 - 1 - wob) * 0.004;
    const f = 2650 - 750 * p + 70 * Math.sin(TAU * 13 * tt) + 900 * wob;
    ph += f / S.sr;
    if ((k & 15) === 0) bp.set("bp", f, 3);
    const env = Math.min(1, tt / 0.02) * Math.min(1, (dur - tt) / 0.18);
    return (Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph) + bp.run(r() * 2 - 1) * 1.2) * env;
  });
}

function glitch(S, t0, dur, seed = 1, gain = 0.35) {
  const r = rng(seed);
  let at = t0;
  while (at < t0 + dur) {
    const seg = 0.018 + r() * 0.05;
    const kind = r();
    const f = 120 + r() * 1800;
    const g = gain * (0.4 + r() * 0.6);
    const pan = r() * 1.6 - 0.8;
    if (kind < 0.35) {
      let ph = 0;
      play(S, { bus: S.sfx, t0: at, dur: seg, gain: g * 0.45, pan }, () => {
        ph += f / S.sr;
        return ph - Math.floor(ph) < 0.5 ? 0.6 : -0.6;
      });
    } else if (kind < 0.7) {
      const rr = rng(Math.floor(at * 1e4));
      const step = 4 + Math.floor(r() * 24);
      let hold = 0;
      let cnt = 0;
      play(S, { bus: S.sfx, t0: at, dur: seg, gain: g * 0.55, pan }, () => {
        if (cnt++ % step === 0) hold = Math.round((rr() * 2 - 1) * 4) / 4;
        return hold;
      });
    } else if (kind < 0.85) {
      let ph = 0;
      play(S, { bus: S.sfx, t0: at, dur: seg, gain: g * 0.4, pan }, () => {
        ph += 55 / S.sr;
        const x = ph - Math.floor(ph);
        return x < 0.1 ? 1 : x < 0.5 ? 0.2 : -0.6;
      });
    }
    at += seg + (r() < 0.3 ? r() * 0.03 : 0);
  }
}

function drone(S, t0, dur, gain = 0.26, root = 41.2) {
  let a = 0;
  let b = 0;
  let c = 0;
  const r = rng(31337);
  const lp = new OnePole(S.sr, 380);
  play(S, { bus: S.music, t0, dur, gain, send: 0.3 }, (tt) => {
    const env = Math.min(1, tt / 0.6) * Math.min(1, (dur - tt) / 0.5);
    a += root / S.sr;
    b += (root * 1.5) / S.sr;
    c += 1760 / S.sr;
    const lfo = 0.7 + 0.3 * Math.sin(TAU * 0.35 * tt);
    return (
      env *
      (Math.sin(TAU * a) * 0.55 +
        Math.sin(TAU * b) * 0.3 * lfo +
        lp.run(r() * 2 - 1) * 0.35 +
        Math.sin(TAU * c) * 0.02 * (0.5 + 0.5 * Math.sin(TAU * 0.8 * tt)))
    );
  });
}

function blip(S, t0, f, gain = 0.2, dur = 0.08, pan = 0) {
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur, gain, pan, send: 0.25 }, (tt) => {
    ph += f / S.sr;
    const x = TAU * ph;
    return (Math.sin(x) + 0.25 * Math.sin(3 * x)) * Math.min(1, tt / 0.003) * Math.exp(-tt / (dur * 0.35));
  });
}

function aiBoot(S, t0) {
  [72, 76, 79, 84, 88, 91].forEach((n, i) => blip(S, t0 + i * 0.055, midi(n), 0.2, 0.09, (i - 2.5) * 0.15));
  let ph = 0;
  const lp = new Biquad(S.sr);
  play(S, { bus: S.sfx, t0, dur: 0.6, gain: 0.22, send: 0.3 }, (tt, k) => {
    if ((k & 31) === 0) lp.set("lp", 200 + 5000 * (tt / 0.6), 3);
    ph += (55 + 220 * tt) / S.sr;
    return lp.run(saw(ph)) * Math.sin((Math.PI * tt) / 0.6);
  });
}

function radarPing(S, t0, gain = 0.26) {
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur: 1.1, gain, send: 0.6, pan: -0.1 }, (tt) => {
    ph += (1180 - 40 * tt) / S.sr;
    return Math.sin(TAU * ph) * Math.min(1, tt / 0.004) * Math.exp(-tt / 0.28);
  });
}

/** FM bell. */
function bell(S, t0, f, { gain = 0.25, dur = 1.2, ratio = 3.5, index = 2.2, pan = 0, send = 0.4, bus } = {}) {
  let pc = 0;
  let pm = 0;
  const dc = f / S.sr;
  const dm = (f * ratio) / S.sr;
  const ke = decayK(S, dur * 0.28);
  const ki = decayK(S, dur * 0.15);
  let ee = 1;
  let ei = index;
  play(S, { bus: bus ?? S.sfx, t0, dur, gain, pan, send }, (tt) => {
    pc += dc;
    if (pc >= 1) pc -= 1;
    pm += dm;
    if (pm >= 1) pm -= 1;
    const out = Math.sin(TAU * pc + ei * Math.sin(TAU * pm)) * ee * (tt < 0.002 ? tt / 0.002 : 1);
    ee *= ke;
    ei *= ki;
    return out;
  });
}

function notifPing(S, t0) {
  bell(S, t0, 1568, { gain: 0.3, dur: 0.35, ratio: 2, index: 0.8, send: 0.25 });
  bell(S, t0 + 0.095, 2093, { gain: 0.32, dur: 0.9, ratio: 2, index: 0.9, send: 0.35 });
}

function tap(S, t0, gain = 0.3) {
  const r = rng(Math.floor(t0 * 733) + 2);
  const bp = new Biquad(S.sr).set("bp", 2200, 1);
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur: 0.05, gain }, (tt) => {
    ph += 700 / S.sr;
    return (
      bp.run(r() * 2 - 1) * Math.exp(-tt / 0.004) * 1.5 + Math.sin(TAU * ph) * Math.exp(-tt / 0.01) * 0.6
    );
  });
}

function bubblePop(S, t0, gain = 0.3) {
  let ph = 0;
  play(S, { bus: S.sfx, t0, dur: 0.11, gain, send: 0.15 }, (tt) => {
    ph += (380 + 9000 * tt) / S.sr;
    return Math.sin(TAU * ph) * Math.sin(Math.PI * Math.min(1, tt / 0.11));
  });
}

function kaching(S, t0) {
  {
    const r = rng(5);
    const bp = new Biquad(S.sr).set("bp", 1500, 1.2);
    let ph = 0;
    play(S, { bus: S.sfx, t0, dur: 0.08, gain: 0.5 }, (tt) => {
      ph += 140 / S.sr;
      return (
        bp.run(r() * 2 - 1) * Math.exp(-tt / 0.012) * 2 + Math.sin(TAU * ph) * Math.exp(-tt / 0.02) * 0.7
      );
    });
  }
  [2637, 3951, 5274].forEach((f, i) =>
    bell(S, t0 + 0.07, f, {
      gain: 0.2 - i * 0.04,
      dur: 1.4,
      ratio: 1.41,
      index: 1.2,
      pan: 0.2 - i * 0.2,
      send: 0.4,
    }),
  );
  const r = rng(6);
  for (let i = 0; i < 7; i++) {
    bell(S, t0 + 0.12 + r() * 0.45, 3800 + r() * 3000, {
      gain: 0.07,
      dur: 0.25,
      ratio: 2.7,
      index: 1.5,
      pan: r() * 1.6 - 0.8,
      send: 0.3,
    });
  }
}

function vroom(S, t0, dur = 1.1) {
  let ph = 0;
  let am = 0;
  const lp = new Biquad(S.sr);
  const r = rng(88);
  play(S, { bus: S.sfx, t0, dur, gain: 0.32, send: 0.1, panAt: (tt) => 0.8 - 1.6 * (tt / dur) }, (tt, k) => {
    const p = tt / dur;
    const f = 85 + 110 * Math.min(1, p * 1.6) - 40 * Math.max(0, p - 0.7);
    ph += f / S.sr;
    am += (f * 0.25) / S.sr;
    if ((k & 31) === 0) lp.set("lp", 700 + 1500 * Math.sin(Math.PI * p), 1.5);
    const env = Math.min(1, tt / 0.08) * Math.min(1, (dur - tt) / 0.25) * (0.5 + 0.5 * Math.sin(Math.PI * p));
    return Math.tanh(2 * lp.run(saw(ph) * (0.7 + 0.3 * Math.sin(TAU * am)) + (r() * 2 - 1) * 0.15)) * env;
  });
}

function applause(S, t0, dur = 1.4, gain = 0.5) {
  const r = rng(2024);
  const count = Math.floor(dur * 60);
  for (let i = 0; i < count; i++) {
    const at = t0 + Math.pow(r(), 0.85) * dur;
    const rr = rng(3000 + i);
    const bp = new Biquad(S.sr).set("bp", 1000 + r() * 1500, 0.9);
    const env = Math.min(1, (at - t0) / 0.12) * Math.min(1, (t0 + dur - at) / 0.5);
    play(
      S,
      {
        bus: S.sfx,
        t0: at,
        dur: 0.06,
        gain: gain * env * (0.4 + r() * 0.6),
        pan: r() * 1.8 - 0.9,
        send: 0.25,
      },
      (tt) => {
        return bp.run(rr() * 2 - 1) * Math.exp(-tt / 0.012) * 2.5;
      },
    );
  }
  let ph = 0;
  play(S, { bus: S.sfx, t0: t0 + 0.25, dur: 0.6, gain: 0.07, pan: 0.5, send: 0.3 }, (tt) => {
    ph += (1900 + 500 * Math.sin((Math.PI * tt) / 0.6) + 30 * Math.sin(TAU * 7 * tt)) / S.sr;
    return Math.sin(TAU * ph) * Math.sin((Math.PI * tt) / 0.6);
  });
}

function sparkle(S, t0, dur = 0.7) {
  const r = rng(999);
  const scale = [0, 2, 4, 7, 9];
  for (let i = 0; i < 14; i++) {
    const at = t0 + (i / 14) * dur * 0.8 + r() * 0.03;
    const n = 86 + scale[Math.floor(r() * 5)] + 12 * Math.floor(r() * 2);
    bell(S, at, midi(n), { gain: 0.06, dur: 0.5, ratio: 3.01, index: 0.6, pan: r() * 1.6 - 0.8, send: 0.6 });
  }
}

function impact(S, t0) {
  const r = rng(4);
  const hp = new Biquad(S.sr).set("hp", 2500, 0.7);
  play(
    S,
    { bus: S.sfx, t0: t0 - 0.45, dur: 0.45, gain: 0.3, send: 0.3 },
    (tt) => hp.run(r() * 2 - 1) * Math.pow(tt / 0.45, 3),
  );
  boom(S, t0, 1.0, 2.2);
}

/* ------------------------------------------------------------------------ drums */

function hat(S, t0, gain = 0.1, open = false, bus = S.music) {
  const r = rng(Math.floor(t0 * 7919) + 7);
  const hp = new Biquad(S.sr).set("hp", 7500, 0.8);
  const d = open ? 0.09 : 0.022;
  play(S, { bus, t0, dur: d * 5, gain, pan: 0.25 }, (tt) => hp.run(r() * 2 - 1) * Math.exp(-tt / d) * 1.6);
}

function clap(S, t0, gain = 0.38, bus = S.music) {
  const r = rng(Math.floor(t0 * 6151) + 11);
  const bp = new Biquad(S.sr).set("bp", 1500, 1.1);
  play(S, { bus, t0, dur: 0.3, gain, pan: -0.05, send: 0.2 }, (tt) => {
    const e = tt < 0.03 ? Math.exp(-((tt % 0.01) / 0.0025)) : Math.exp(-(tt - 0.03) / 0.07);
    return bp.run(r() * 2 - 1) * e * 2.2;
  });
}

function snare(S, t0, gain = 0.32, bus = S.music) {
  const r = rng(Math.floor(t0 * 4513) + 13);
  const bp = new Biquad(S.sr).set("bp", 1900, 0.8);
  let ph = 0;
  play(S, { bus, t0, dur: 0.22, gain, send: 0.15 }, (tt) => {
    ph += (180 + 60 * Math.exp(-tt / 0.02)) / S.sr;
    return bp.run(r() * 2 - 1) * Math.exp(-tt / 0.06) * 1.8 + Math.sin(TAU * ph) * Math.exp(-tt / 0.04) * 0.6;
  });
}

function bass808(S, t0, note, dur, gain = 0.5, bus = S.music) {
  const f = midi(note);
  let ph = 0;
  const kg = decayK(S, 0.03);
  const ke = decayK(S, dur * 0.7);
  let eg = 1;
  let ee = 1;
  play(S, { bus, t0, dur: dur + 0.1, gain }, (tt) => {
    ph += (f * (1 + 0.6 * eg)) / S.sr;
    const env = Math.min(1, tt / 0.004) * ee * Math.min(1, (dur + 0.1 - tt) / 0.05);
    eg *= kg;
    ee *= ke;
    return Math.tanh(1.8 * Math.sin(TAU * ph)) * env;
  });
}

/** Karplus–Strong string. */
function pluck(S, t0, note, gain = 0.16, pan = 0, decay = 0.996, bus = S.music) {
  const f = midi(note);
  const N = Math.max(2, Math.round(S.sr / f));
  const buf = new Float32Array(N);
  const r = rng(Math.floor(t0 * 3571) + note);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    prev += 0.5 * (r() * 2 - 1 - prev);
    buf[i] = prev;
  }
  let idx = 0;
  play(S, { bus, t0, dur: 0.65, gain, pan, send: 0.3 }, () => {
    const a = buf[idx];
    const next = idx + 1 === N ? 0 : idx + 1;
    buf[idx] = decay * 0.5 * (a + buf[next]);
    idx = next;
    return a;
  });
}

function pad(S, t0, notes, dur, gain = 0.11, cutoff = 1600, bus = S.music) {
  notes.forEach((n, j) => {
    const f = midi(n);
    const ph = [j * 0.13, 0.33 + j * 0.07, 0.66];
    const det = [1, 1.0042, 0.9958];
    const inc = det.map((d) => (f * d) / S.sr);
    const lp = new OnePole(S.sr, cutoff);
    play(
      S,
      {
        bus,
        t0,
        dur: dur + 0.7,
        gain: gain / Math.sqrt(notes.length),
        send: 0.35,
        pan: (j / Math.max(1, notes.length - 1) - 0.5) * 0.6,
      },
      (tt) => {
        let s = 0;
        for (let v = 0; v < 3; v++) {
          let x = ph[v] + inc[v];
          if (x >= 1) x -= 1;
          ph[v] = x;
          s += 2 * x - 1;
        }
        const env = Math.min(1, tt / 0.25) * (tt < dur ? 1 : Math.exp(-(tt - dur) / 0.22));
        return lp.run(s / 3) * env;
      },
    );
  });
}

/* ------------------------------------------------------------------------- mixing */

function tapeStop(bus, sr, t0, dur) {
  const s0 = Math.round(t0 * sr);
  const len = Math.round(dur * sr);
  const srcL = bus.l.slice(s0, s0 + len + 2);
  const srcR = bus.r.slice(s0, s0 + len + 2);
  let pos = 0;
  for (let k = 0; k < len && s0 + k < bus.l.length; k++) {
    const p = k / len;
    const i = Math.floor(pos);
    const f = pos - i;
    const fade = 1 - p * p;
    bus.l[s0 + k] = (srcL[i] * (1 - f) + srcL[i + 1] * f) * fade;
    bus.r[s0 + k] = (srcR[i] * (1 - f) + srcR[i + 1] * f) * fade;
    pos += Math.pow(1 - p, 1.5);
  }
  bus.l.fill(0, s0 + len);
  bus.r.fill(0, s0 + len);
}

function addInto(dst, src, gain = 1) {
  for (let i = 0; i < dst.l.length; i++) {
    dst.l[i] += src.l[i] * gain;
    dst.r[i] += src.r[i] * gain;
  }
}

/** Freeverb-style stereo reverb: parallel damped combs → series allpasses (filter by filter). */
function reverb(input, sr, room = 0.84, damp = 0.25) {
  const scale = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => Math.round(d * scale));
  const apT = [556, 441, 341].map((d) => Math.round(d * scale));
  const n = input.l.length;
  const out = new Bus(n);
  for (const [ch, spread] of [
    ["l", 0],
    ["r", 23],
  ]) {
    const src = input[ch];
    const acc = out[ch];
    for (const d0 of combT) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0;
      let store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = src[i] * 0.015 + store * room;
        if (++idx === d) idx = 0;
        acc[i] += y;
      }
    }
    for (const d0 of apT) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx];
        const x = acc[i];
        buf[idx] = x + b * 0.5;
        if (++idx === d) idx = 0;
        acc[i] = b - x;
      }
    }
    for (let i = 0; i < n; i++) acc[i] *= 3;
  }
  return out;
}

/* ---------------------------------------------------------------------- the score */

function scoreHook(S) {
  whoosh(S, 0.0, 0.32, false, 0.35);
  boom(S, T.boxLand - 0.01, 0.55, 0.9);
  thump(S, T.boxLand, 140, 60, 0.07, 0.8);
  tapeRip(S, T.tapeRip, 0.5);
  crash(S, T.crash);
  drone(S, 0.0, 4.85, 0.1, 55);
  // "dun · dun · DUNNN" — boom + brass stab on each dramatic zoom
  stab(S, T.zoom1, [52, 59], 0.32, 0.4);
  stab(S, T.zoom2, [53, 60], 0.32, 0.4);
  stab(S, T.zoom3, [51, 58, 63], 0.85, 0.5);
  [T.zoom1, T.zoom2, T.zoom3].forEach((z, i) => boom(S, z, 0.36 + i * 0.1, 1.1));
  for (const h of HEARTBEATS.filter((b) => b < 5)) heartbeat(S, h, 0.95);
  tap(S, T.pulseTap, 0.45);
  boom(S, T.pulseTap, 0.25, 0.4);
  whoosh(S, T.pulseOut, 0.28, true, 0.25);
  whoosh(S, T.whoosh, 0.42, true, 0.55);
}

function scoreTweet(S) {
  // angry 140 BPM drill-ish loop, cut by a tape stop at the freeze
  const A = new Bus(S.n);
  const beat = 60 / 140;
  const step = beat / 4;
  const bar = beat * 4;
  const t0 = T.beatA;
  kick(S, t0, 1, A);
  boom(S, t0, 0.35, 0.8);
  const bassBars = [
    [33, 33, 31],
    [29, 29, 28],
    [33, 33, 33],
  ];
  const riff = [45, 45, 48, 45, 50, 45, 48, 52];
  for (let b = 0; b < 3; b++) {
    const bt = t0 + b * bar;
    const tension = b === 2;
    [0, 7, 10].forEach((s, i) => {
      if (tension && s > 8) return;
      kick(S, bt + s * step, 0.85, A);
      bass808(S, bt + s * step, bassBars[b][i], tension && s === 0 ? 1.4 : 0.55, 0.34, A);
    });
    [4, 12].forEach((s) => clap(S, bt + s * step, 0.32, A));
    for (let s = 0; s < 16; s += tension ? 1 : 2)
      hat(S, bt + s * step, tension ? 0.06 + 0.004 * s : 0.08, false, A);
    if (b === 1) for (let s = 12; s < 16; s += 0.5) hat(S, bt + s * step, 0.07, false, A);
    riff.forEach((n, i) =>
      pluck(S, bt + i * 2 * step, n, tension ? 0.08 : 0.11, (i % 2) * 0.3 - 0.15, 0.995, A),
    );
    if (tension) for (let s = 8; s < 16; s += 0.5) snare(S, bt + s * step, 0.08 + 0.022 * (s - 8), A);
  }
  tapeStop(A, S.sr, T.freeze, 0.45);
  addInto(S.music, A);

  ANGRY_TYPING.forEach((tk, i) => {
    const ch = ANGRY_CHARS[i];
    keyClick(S, tk, ch === " " ? 0.34 : 0.28, ch === " " ? 0.75 : 0.9 + ((i * 37) % 10) / 40, i);
  });
  whoosh(S, T.fingerIn, 0.35, true, 0.18);
  for (const h of HEARTBEATS.filter((b) => b > 5)) heartbeat(S, h, 1.05);
  riser(S, 8.15, 1.85, 0.3);
}

function scoreFreeze(S) {
  brake(S, T.freeze, 0.75);
  boom(S, T.freeze, 0.9, 1.8);
  glitch(S, T.freeze + 0.02, 0.6, 3, 0.32);
  drone(S, 10.35, 6.7, 0.22);
  aiBoot(S, T.aiBoot);
  for (let p = 11.0; p < 16.6; p += 1.0) radarPing(S, p, 0.22);
  T.checks.forEach((c, i) => {
    blip(S, c, midi(84 + i * 2), 0.17, 0.07, 0.2);
    blip(S, c + 0.06, midi(91 + i * 2), 0.12, 0.06, -0.2);
  });
  bell(S, T.decision, midi(84), { gain: 0.2, dur: 1.1, ratio: 2, index: 1.2, send: 0.5 });
  bell(S, T.decision + 0.11, midi(91), { gain: 0.22, dur: 1.4, ratio: 2, index: 1.2, send: 0.5 });
  glitch(S, T.unfreeze - 0.05, 0.22, 9, 0.25);
  whoosh(S, T.unfreeze, 0.5, true, 0.45);
}

function scoreContainment(S) {
  const beat = 0.5;
  const start = T.groove;
  const chords = [
    { at: 0, len: 2, root: 38, notes: [50, 54, 57] }, // D
    { at: 2, len: 2, root: 35, notes: [47, 50, 54] }, // Bm
    { at: 4, len: 2, root: 31, notes: [43, 47, 50] }, // G
    { at: 6, len: 2, root: 33, notes: [45, 49, 52] }, // A
    { at: 8, len: 2, root: 35, notes: [47, 50, 54] }, // Bm
    { at: 10, len: 1, root: 31, notes: [43, 47, 50] }, // G
    { at: 11, len: 1, root: 33, notes: [45, 49, 52] }, // A (build)
    { at: 12, len: 1.45, root: 38, notes: [50, 54, 57, 62] }, // D — the drop when the new tweet posts
  ];
  const end = T.outro;
  for (const c of chords) {
    const ct = start + c.at;
    const drop = c.at >= 12;
    pad(S, ct, c.notes, Math.min(c.len, end - ct), drop ? 0.16 : 0.12, drop ? 2600 : 1600);
    bass808(S, ct, c.root + 12, 0.42, 0.38);
    if (c.len >= 2) bass808(S, ct + 1.25, c.root + 12, 0.3, 0.3);
    const arp = [...c.notes.map((n) => n + 12), c.notes[0] + 24];
    if (c.at >= 2) {
      for (let s = 0; s < c.len / 0.25 && ct + s * 0.25 < end - 0.05; s++) {
        pluck(S, ct + s * 0.25, arp[s % arp.length], drop ? 0.13 : 0.09, (s % 2) * 0.4 - 0.2);
      }
    }
  }
  for (let t = start; t < end - 0.05; t += beat) {
    const inBuild = t >= start + 10 && t < start + 12;
    const g = Math.min(1, (t - start) / 2 + 0.45);
    kick(S, t, 0.78 * g);
    const n = Math.round((t - start) / beat);
    if (n % 2 === 1) clap(S, t, 0.38 * g);
    hat(S, t + beat / 2, t >= start + 4 ? 0.09 : 0.06, t >= start + 4);
    if (t >= start + 2) hat(S, t + beat / 4, 0.04);
    if (inBuild) {
      const d = (t - (start + 10)) / 2;
      const sub = d < 0.5 ? 2 : 4;
      for (let k = 0; k < sub; k++) snare(S, t + (k * beat) / sub, 0.07 + 0.2 * d);
    }
  }
  riser(S, start + 10.8, 1.2, 0.22);

  whoosh(S, T.unfreeze + 0.25, 0.4, false, 0.2);
  notifPing(S, T.notif);
  tap(S, T.notifTap, 0.4);
  whoosh(S, T.chatOpen, 0.3, true, 0.25);
  bubblePop(S, T.typingDots + 0.05, 0.12);
  bubblePop(S, T.bubble, 0.34);
  kaching(S, T.wallet);
  bubblePop(S, T.wallet - 0.05, 0.22);
  vroom(S, T.scooter, 1.2);
  bubblePop(S, T.scooter - 0.05, 0.22);
  whoosh(S, T.back, 0.34, false, 0.3);
}

function scoreDelight(S) {
  DELETE_TIMES.forEach((dt, i) => {
    if (i % 2 === 0) keyClick(S, dt, 0.2, 1.25, 500 + i);
  });
  HAPPY_TYPING.forEach((tk, i) => {
    const ch = HAPPY_CHARS[i];
    keyClick(S, tk, ch === " " ? 0.22 : 0.17, ch === " " ? 0.8 : 1.05, 900 + i);
  });
  tap(S, T.postTap, 0.5);
  whoosh(S, T.postTap + 0.04, 0.26, true, 0.32);
  boom(S, T.posted, 0.45, 0.9);
  applause(S, T.posted + 0.05, 1.4, 0.42);
  sparkle(S, T.iqal, 0.75);
}

function scoreOutro(S) {
  whoosh(S, T.outro - 0.1, 0.4, true, 0.4);
  impact(S, T.sting);
  pad(S, T.sting, [50, 57, 61, 64, 66], 3.2, 0.12, 1900);
  bass808(S, T.sting, 26, 2.2, 0.45);
  [0, 0.12, 0.24].forEach((d, i) => blip(S, T.logo + 0.18 + d, midi(79 + i * 5), 0.14, 0.12, (i - 1) * 0.3));
  bell(S, T.wordmark, midi(81), { gain: 0.14, dur: 1.6, ratio: 3.01, index: 0.9, send: 0.5 });
  bell(S, T.tagline, midi(86), { gain: 0.12, dur: 1.6, ratio: 3.01, index: 0.9, send: 0.5 });
  bell(S, T.url, midi(90), { gain: 0.14, dur: 1.4, ratio: 3.01, index: 0.9, send: 0.55 });
  sparkle(S, T.url, 0.6);
}

/**
 * Render the whole 35 s soundtrack. Returns de-interleaved stereo Float32 channels in [-1, 1].
 */
export function renderSoundtrack({ sampleRate = SAMPLE_RATE, duration = DURATION } = {}) {
  const n = Math.ceil(duration * sampleRate);
  const S = { sr: sampleRate, n, sfx: new Bus(n), music: new Bus(n), verb: new Bus(n) };
  scoreHook(S);
  scoreTweet(S);
  scoreFreeze(S);
  scoreContainment(S);
  scoreDelight(S);
  scoreOutro(S);

  const wet = reverb(S.verb, sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let peak = 0;
  const fadeOut = Math.round(0.35 * sampleRate);
  // gentle high-pass (~28 Hz) on the master: removes infrasonic rumble and DC that only eat headroom
  const hpK = Math.exp((-2 * Math.PI * 28) / sampleRate);
  let hlx = 0;
  let hly = 0;
  let hrx = 0;
  let hry = 0;
  for (let i = 0; i < n; i++) {
    const g = i > n - fadeOut ? (n - i) / fadeOut : 1;
    const ml = S.sfx.l[i] + S.music.l[i] * 0.62 + wet.l[i] * 0.45;
    const mr = S.sfx.r[i] + S.music.r[i] * 0.62 + wet.r[i] * 0.45;
    hly = hpK * (hly + ml - hlx);
    hlx = ml;
    hry = hpK * (hry + mr - hrx);
    hrx = mr;
    const l = Math.tanh(hly * 1.1) * g;
    const r = Math.tanh(hry * 1.1) * g;
    left[i] = l;
    right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const norm = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) {
    left[i] *= norm;
    right[i] *= norm;
  }
  return { sampleRate, left, right };
}

/** 16-bit PCM stereo WAV. */
export function encodeWav({ sampleRate, left, right }) {
  const frames = left.length;
  const bytes = 44 + frames * 4;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, frames * 4, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, right[i])) * 32767, true);
    o += 4;
  }
  return new Uint8Array(buf);
}
