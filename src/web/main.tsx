import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { trackVisualViewport } from "./mobile";
import "./styles.css";

trackVisualViewport();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  registerServiceWorker();
}

function registerServiceWorker(): void {
  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update();
      });
    });
  });
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
