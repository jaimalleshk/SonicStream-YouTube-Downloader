const CACHE_NAME = "sonicstream-v2";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// Install Event - Cache Core Assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean Up Old Caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Cache-First for static, Network-First with Cache Fallback for audio/API
self.addEventListener("fetch", (event) => {
  const request = event.request;
  
  // Skip non-GET requests or browser extension requests
  if (request.method !== "GET" || !request.url.startsWith("http")) return;

  // Static Assets Cache-First Strategy
  if (request.destination === "style" || request.destination === "script" || request.destination === "document") {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Update cache in background
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(request);
      })
    );
    return;
  }

  // Audio / Media Request - Network with Cache Fallback
  if (request.destination === "audio" || request.url.includes(".mp3") || request.url.includes("graph.microsoft.com")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Default Network-First Strategy
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
