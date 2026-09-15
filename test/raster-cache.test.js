import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewBackend } from "../src/engine/preview-backend.js";
import { BoundedRasterCache, RasterCacheCoordinator, staticPreviewKey } from "../src/engine/raster-cache.js";
import { collectDynamicSlots, parseSvgTransform } from "../src/engine/raster-preview.js";

test("same static state across frames does not rebuild the raster cache", async () => {
  const cache = new RasterCacheCoordinator();
  const state = { master: "normal", pose: "normal", expression: "neutral" };
  let builds = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    await cache.ensureStatic(staticPreviewKey(state), async () => entry(++builds));
  }
  assert.equal(builds, 1);
  assert.equal(cache.rebuildCount, 1);
});

test("blink changes only a cropped part cache and never rebuilds the static character", async () => {
  const cache = await initializedCache();
  await cache.ensurePart("eye_closed", async () => entry(2, 120, 48));
  assert.equal(cache.rebuildCount, 1);
  assert.equal(cache.partCache.get("eye_closed").bytes, 120 * 48 * 4);
});

test("mouth changes only a cropped part cache and never rebuilds the static character", async () => {
  const cache = await initializedCache();
  await cache.ensurePart("mouth_wide", async () => entry(2, 72, 36));
  assert.equal(cache.rebuildCount, 1);
  assert.equal(cache.partCache.get("mouth_wide").bytes, 72 * 36 * 4);
});

test("gaze transform does not trigger either static or part rasterization", async () => {
  const cache = await initializedCache();
  const before = cache.rasterizationCount;
  const transform = parseSvgTransform("translate(7.0000 -5.0000) rotate(0.0000 0.0000 0.0000) translate(0.0000 0.0000) scale(1.0000 1.0000) translate(0.0000 0.0000)");
  assert.match(transform.css, /translate3d\(7px, -5px, 0\)/);
  assert.equal(cache.rebuildCount, 1);
  assert.equal(cache.rasterizationCount, before);
});

test("expression changes rebuild only a bounded static state and cached states are reused", async () => {
  const cache = new RasterCacheCoordinator({ staticLimit: 2 });
  let builds = 0;
  const normal = { master: "normal", pose: "normal", expression: "neutral" };
  const happy = { ...normal, expression: "happy" };
  await cache.ensureStatic(staticPreviewKey(normal), async () => entry(++builds));
  await cache.ensureStatic(staticPreviewKey(happy), async () => entry(++builds));
  await cache.ensureStatic(staticPreviewKey(normal), async () => entry(++builds));
  assert.equal(builds, 2);
  assert.equal(cache.staticCache.size, 2);
});

test("character disposal releases old canvases and pending generations cannot repopulate cache", async () => {
  const disposed = [];
  const cache = new RasterCacheCoordinator({ dispose: (value) => disposed.push(value.id) });
  await cache.ensureStatic("character-a", async () => entry("base-a"));
  await cache.ensurePart("eye-a", async () => entry("eye-a"));
  let completeLateRaster;
  const late = cache.ensurePart("late-a", () => new Promise((resolve) => { completeLateRaster = () => resolve(entry("late-a")); }));
  await Promise.resolve();
  cache.clear();
  completeLateRaster();
  await assert.rejects(late, /generation was disposed/);
  assert.deepEqual(disposed.sort(), ["base-a", "eye-a", "late-a"]);
  assert.equal(cache.metrics().cacheBytes, 0);
  assert.equal(cache.metrics().cacheEntries, 0);
});

test("static and part raster caches have hard entry limits", () => {
  const disposed = [];
  const cache = new BoundedRasterCache(3, (value) => disposed.push(value.id));
  for (let index = 0; index < 10; index += 1) cache.set(`part-${index}`, entry(index));
  assert.equal(cache.size, 3);
  assert.equal(disposed.length, 7);
  assert.equal(cache.get("part-9").id, 9);
});

test("unsupported raster initialization falls back to the legacy SVG backend", async () => {
  let rasterDisposed = false;
  let legacyPrepared = false;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const backend = await createPreviewBackend({
      snapshot: { expression: "neutral" },
      rasterFactory: () => ({ initialize: async () => { throw new Error("unsupported"); }, destroy: () => { rasterDisposed = true; } }),
      legacyFactory: () => ({ backend: "legacy-svg", prepareStatic: () => { legacyPrepared = true; } }),
    });
    assert.equal(backend.backend, "legacy-svg");
    assert.equal(rasterDisposed, true);
    assert.equal(legacyPrepared, true);
  } finally {
    console.warn = originalWarn;
  }
});

test("blink and lip sync slots are the only time-driven part slots", () => {
  const slots = collectDynamicSlots({
    blink: { closedParts: { eye_left: "eye_left_closed", eye_right: "eye_right_closed" } },
    lipSync: { slot: "mouth", parts: ["mouth_closed", "mouth_wide"] },
  });
  assert.deepEqual([...slots].sort(), ["eye_left", "eye_right", "mouth"]);
});

async function initializedCache() {
  const cache = new RasterCacheCoordinator();
  await cache.ensureStatic("normal|normal|neutral", async () => entry(1, 512, 512));
  return cache;
}

function entry(id, width = 16, height = 16) {
  return { id, bytes: width * height * 4 };
}
