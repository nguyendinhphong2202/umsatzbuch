// Offline-Unterstützung: App-Dateien und Bibliotheken werden zwischengespeichert.
// Bei jeder neuen Version VERSION hochzählen, damit iPhones die Änderungen laden.
const VERSION = "umsatzbuch-v2";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./manifest.webmanifest",
  "./js/app.js", "./js/domain.js", "./js/store.js", "./js/scanner.js", "./js/parser.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Datenbank und Login nie zwischenspeichern
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  // Bibliotheken (fest versioniert): erst Cache, dann Netz
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Eigene Dateien: erst Netz (damit Updates ankommen), offline aus dem Cache
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("./index.html"))));
  }
});
