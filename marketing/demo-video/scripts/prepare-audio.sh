#!/usr/bin/env bash
# Loudness-normalise the recorded voiceover segments (-16 LUFS, -1.5 dBTP) into WAVs the video uses.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/audio/norm
for i in 1 2 3 4; do
  ffmpeg -hide_banner -loglevel error -y -i "public/audio/seg$i.mp3" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=7" -ar 48000 -ac 1 "public/audio/norm/seg$i.wav"
done
echo "normalised -> public/audio/norm/"
