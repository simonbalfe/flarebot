const shellCache = "flarebot-shell-v2";
const serverPaths = ["/api/", "/mac/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(shellCache).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== shellCache).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate" || request.destination !== "document") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || serverPaths.some((path) => url.pathname.startsWith(path))) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
          const copy = response.clone();
          void caches.open(shellCache).then((cache) => cache.put("/", copy));
        }
        return response;
      })
      .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
  );
});
