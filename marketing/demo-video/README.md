# Meqyas AI — Demo Video

The 3-minute hackathon demo (1920×1080 · 30 fps), built with Remotion. Narration text:
[`VOICEOVER.md`](VOICEOVER.md); recorded segments: `public/audio/seg1–4.mp3`.

Nothing shown as a result is typed by hand: test output, code excerpts, the live model run and
the site screenshots are all captured from the real thing by the scripts below.

```bash
cd marketing/demo-video
pnpm install --ignore-workspace
./scripts/prepare-audio.sh                                   # loudness-normalise the voiceover
(cd ../.. && uv run python marketing/demo-video/scripts/extract_assets.py)   # code + pytest output
(cd ../.. && OPENAI_API_KEY=<groq key> uv run python marketing/demo-video/scripts/live_run.py)
node scripts/capture_site.mjs                                # screenshots of meqyas.wardat.xyz
pnpm render                                                  # -> out/meqyas-demo.mp4
```

Set `REMOTION_BROWSER_EXECUTABLE` to reuse an installed Chrome Headless Shell. Scene timing
lives in `src/timeline.js` and follows the pauses in the recorded audio.
