// Writes public/qeu-reel-audio.wav — the soundtrack the player synthesizes live, for Remotion.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SAMPLE_RATE, encodeWav, renderSoundtrack } from "../src/reel/soundtrack.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/qeu-reel-audio.wav");

const started = performance.now();
const pcm = renderSoundtrack({ sampleRate: SAMPLE_RATE });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodeWav(pcm));

let peak = 0;
for (let i = 0; i < pcm.left.length; i++)
  peak = Math.max(peak, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
const secs = pcm.left.length / pcm.sampleRate;
console.log(
  `qeu-reel-audio.wav · ${secs.toFixed(2)} s · ${pcm.sampleRate} Hz stereo · peak ${peak.toFixed(3)} · ${Math.round(performance.now() - started)} ms`,
);
