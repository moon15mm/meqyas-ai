import "@fontsource-variable/cairo";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import MeqyasQeuReel from "./MeqyasQeuReel.jsx";
import { SheetView, StageView } from "./player/StageView.jsx";

const view = new URLSearchParams(window.location.search).get("view");
const App = view === "stage" ? StageView : view === "sheet" ? SheetView : MeqyasQeuReel;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
