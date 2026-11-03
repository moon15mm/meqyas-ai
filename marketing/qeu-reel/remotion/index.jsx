// Remotion entry point: `pnpm studio` · `pnpm render` · `pnpm still` (see README.md).
import "@fontsource-variable/cairo";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "../src/index.css";

import { registerRoot } from "remotion";

import { Root } from "./Root.jsx";

registerRoot(Root);
