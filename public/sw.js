const shellCache = "flarebot-shell-v5";
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

self.addEventListener("push", (event) => {
  const message = event.data?.json() ?? {};
  const title = typeof message.title === "string" ? message.title : "flarebot";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === "string" ? message.body : "",
      tag: typeof message.tag === "string" ? message.tag : undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: typeof message.url === "string" ? message.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open === undefined) return self.clients.openWindow(target.href);
      open.postMessage({ type: "flarebot-open", url: target.pathname + target.search });
      return open.focus();
    }),
  );
});
