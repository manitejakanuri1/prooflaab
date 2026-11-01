import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installStaleChunkReload } from "./lib/staleChunkReload";
import "./index.css";

// Before render: a tab open across a deploy fails on its first lazy route, which
// can happen before any component of ours has mounted.
installStaleChunkReload();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
