import { renderSoundtrack } from "../reel/soundtrack.js";
import SoundWorker from "./soundWorker.js?worker&inline";

// 44.1 kHz is plenty for the preview; the exported WAV (scripts/render-audio.mjs) uses 48 kHz.
const PREVIEW_RATE = 44100;

/**
 * Plays the synthesized soundtrack in sync with the player clock. The waveform is rendered once in
 * a Web Worker from the same timeline the visuals use, then played from any offset.
 */
export class ReelAudio {
  constructor() {
    this.pcm = null;
    this.buffer = null;
    this.ctx = null;
    this.gain = null;
    this.src = null;
    this.t0 = 0;
    this.pending = null;
  }

  get ready() {
    return this.pcm !== null;
  }

  /** Render in a worker (falls back to the main thread when workers are unavailable). */
  prepareAsync() {
    if (this.pcm) return Promise.resolve(this.pcm);
    if (!this.pending) {
      this.pending = new Promise((resolve, reject) => {
        const fallback = () => {
          try {
            resolve(this.accept(renderSoundtrack({ sampleRate: PREVIEW_RATE })));
          } catch (err) {
            reject(err);
          }
        };
        let worker;
        try {
          worker = new SoundWorker();
        } catch {
          fallback();
          return;
        }
        worker.onmessage = (event) => {
          worker.terminate();
          resolve(this.accept(event.data));
        };
        worker.onerror = () => {
          worker.terminate();
          fallback();
        };
        worker.postMessage({ sampleRate: PREVIEW_RATE });
      });
    }
    return this.pending;
  }

  /** Keep the PCM and wrap it in an AudioBuffer (no AudioContext needed yet). */
  accept(pcm) {
    this.pcm = pcm;
    if (typeof AudioBuffer !== "undefined") {
      const buf = new AudioBuffer({
        numberOfChannels: 2,
        length: pcm.left.length,
        sampleRate: pcm.sampleRate,
      });
      buf.copyToChannel(pcm.left, 0);
      buf.copyToChannel(pcm.right, 1);
      this.buffer = buf;
    }
    return pcm;
  }

  /** Create the AudioContext — call from a user gesture (the Play click), even before the PCM is ready. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  ensureContext() {
    return this.buffer !== null && this.unlock();
  }

  /** Start playback at `offset` seconds; returns false when audio is not ready or unavailable. */
  start(offset) {
    this.stop();
    if (!this.ensureContext()) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const at = this.ctx.currentTime + 0.02;
    src.start(at, Math.max(0, offset));
    this.src = src;
    this.t0 = at - offset;
    return true;
  }

  stop() {
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
      this.src.disconnect();
      this.src = null;
    }
  }

  /** True once the audio clock is really advancing (some devices start a context late). */
  get running() {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Current position (seconds) on the audio clock. */
  now() {
    return this.ctx ? Math.max(0, this.ctx.currentTime - this.t0) : 0;
  }
}
