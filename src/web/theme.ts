const dark = window.matchMedia("(prefers-color-scheme: dark)");

function applySystemMode(): void {
  document.documentElement.dataset["mode"] = dark.matches ? "dark" : "light";
}

dark.addEventListener("change", applySystemMode);
applySystemMode();
