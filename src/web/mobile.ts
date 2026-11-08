import { useEffect, useState } from "react";

const mobileQuery = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function trackVisualViewport(): void {
  const viewport = window.visualViewport;
  if (viewport === null) return;
  const update = () => {
    document.documentElement.style.setProperty("--fb-viewport-height", `${viewport.height}px`);
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
}
