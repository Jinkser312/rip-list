// Rip List offline support.
// - The page itself: try the network (so updates show up), fall back to the saved copy.
// - The list (list.enc.json): network first with a short timeout, fall back to the last saved copy.
// - Posters from TMDB: saved as they're seen, so they show offline too.
const SHELL = "riplist-shell-v1";
const DATA = "riplist-data";
const IMAGES = "riplist-posters";
const SHELL_FILES = ["./", "index.html", "manifest.webmanifest", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("riplist-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Network first (with timeout), then cache. `key` lets "list.enc.json?t=123" share one saved copy.
async function networkFirst(request, cacheName, key, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request, { cache: "no-store" }), timeoutMs);
    if (response && response.ok) {
      await cache.put(key, response.clone());
      return response;
    }
    const saved = await cache.match(key);
    return saved || response;
  } catch (err) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(req, IMAGES));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const scope = new URL(self.registration.scope);
  if (url.pathname.endsWith("/list.enc.json")) {
    event.respondWith(networkFirst(req, DATA, new URL("list.enc.json", scope).href, 5000));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL, new URL("index.html", scope).href, 3000));
    return;
  }
  event.respondWith(networkFirst(req, SHELL, url.origin + url.pathname, 3000));
});
