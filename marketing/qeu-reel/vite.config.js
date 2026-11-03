import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `pnpm build` produces one self-contained dist/index.html (scripts, styles and fonts inlined)
// that plays offline. public/ only holds the WAV rendered for Remotion — the player synthesizes
// its own audio, so it is not copied into the build.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  publicDir: false,
  server: { host: "127.0.0.1" },
  build: { assetsInlineLimit: 100_000_000 },
});
