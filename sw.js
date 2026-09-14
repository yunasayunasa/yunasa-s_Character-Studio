const CACHE = "svg-character-studio-v2.0.2";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/main.js",
  "./src/engine/audio-lip-sync.js",
  "./src/engine/audio-analysis.js",
  "./src/engine/character-engine.js",
  "./src/engine/character-loader.js",
  "./src/engine/pack-schema.js",
  "./src/engine/pack-store.js",
  "./src/engine/psd-inspector.js",
  "./src/engine/subtitle-lip-sync.js",
  "./src/engine/timeline-state.js",
  "./src/engine/zip-reader.js",
  "./src/export/canvas-renderer.js",
  "./src/export/export-manager.js",
  "./src/export/gif-encoder.js",
  "./src/export/psd-writer.js",
  "./src/export/webm-encoder.js",
  "./src/export/zip-store.js",
  "./public/characters/index.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplication().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })),
  );
});

async function cacheApplication() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  const manifest = await fetch("./public/characters/index.json").then((response) => response.json());
  for (const character of manifest.characters) {
    const configUrl = `${character.path}character.json`;
    const config = await fetch(configUrl).then((response) => response.json());
    await cache.addAll([
      configUrl,
      `${character.path}${config.files.svg}`,
      `${character.path}${config.files.expressions}`,
      `${character.path}${config.files.motions}`,
      ...[config.files.poses, config.files.emotes].filter(Boolean).map((file) => `${character.path}${file}`),
    ]);
  }
}
