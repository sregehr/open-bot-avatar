import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Geist for text, Geist Mono for code: served with the site, latin subsets load on demand.
import "@fontsource-variable/geist";
import "@fontsource/geist-mono/400.css";
import "./studio.css";
import "./site.css";
// Docebo's type and colors, over the studio's own look.
import "@fontsource-variable/figtree";
import "@fontsource/special-gothic-expanded-one/400.css";
import "./docebo.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
