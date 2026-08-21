// Service worker for the EPE field-orders PWA (spec S27). Runtime-caches GET requests so the
// /m shell loads offline; order submission is a POST (server action) and bypasses the cache —
// offline orders are queued in IndexedDB by the app and synced when connectivity returns.
const CACHE = "epe-m-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache POSTs (server actions)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches
          .open(CACHE)
          .then((c) => c.put(req, copy))
          .catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/m"))),
  );
});
