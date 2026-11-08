import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { trackVisualViewport } from "./mobile";
import "./styles.css";

trackVisualViewport();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
