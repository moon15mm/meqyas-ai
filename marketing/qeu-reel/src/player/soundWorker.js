// Renders the soundtrack off the main thread so the page never freezes while it is synthesized.
import { renderSoundtrack } from "../reel/soundtrack.js";

self.onmessage = (event) => {
  const pcm = renderSoundtrack({ sampleRate: event.data?.sampleRate });
  self.postMessage(pcm, [pcm.left.buffer, pcm.right.buffer]);
};
