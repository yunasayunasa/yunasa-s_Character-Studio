export class BoundedRasterCache {
  constructor(limit, dispose = defaultDispose) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.disposeEntry = dispose;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key, entry) {
    const previous = this.entries.get(key);
    if (previous) this.remove(key);
    this.entries.set(key, entry);
    this.bytes += entry.bytes ?? 0;
    while (this.entries.size > this.limit) this.remove(this.entries.keys().next().value);
    return entry;
  }

  remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes -= entry.bytes ?? 0;
    this.disposeEntry(entry);
    return true;
  }

  clear() {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.bytes = 0;
  }

  get size() { return this.entries.size; }
}

export class RasterCacheCoordinator {
  constructor({ staticLimit = 2, partLimit = 32, dispose } = {}) {
    this.disposeEntry = dispose ?? defaultDispose;
    this.staticCache = new BoundedRasterCache(staticLimit, this.disposeEntry);
    this.partCache = new BoundedRasterCache(partLimit, this.disposeEntry);
    this.pendingStatic = new Map();
    this.pendingParts = new Map();
    this.rebuildCount = 0;
    this.rasterizationCount = 0;
    this.generation = 0;
  }

  async ensureStatic(key, factory) {
    const cached = this.staticCache.get(key);
    if (cached) return cached;
    if (this.pendingStatic.has(key)) return this.pendingStatic.get(key);
    const generation = this.generation;
    const pending = Promise.resolve().then(factory).then((entry) => {
      if (generation !== this.generation) {
        this.disposeEntry(entry);
        throw new Error("Raster cache generation was disposed");
      }
      this.rebuildCount += 1;
      this.rasterizationCount += 1;
      return this.staticCache.set(key, entry);
    }).finally(() => this.pendingStatic.delete(key));
    this.pendingStatic.set(key, pending);
    return pending;
  }

  async ensurePart(key, factory) {
    const cached = this.partCache.get(key);
    if (cached) return cached;
    if (this.pendingParts.has(key)) return this.pendingParts.get(key);
    const generation = this.generation;
    const pending = Promise.resolve().then(factory).then((entry) => {
      if (generation !== this.generation) {
        this.disposeEntry(entry);
        throw new Error("Raster cache generation was disposed");
      }
      this.rasterizationCount += 1;
      return this.partCache.set(key, entry);
    }).finally(() => this.pendingParts.delete(key));
    this.pendingParts.set(key, pending);
    return pending;
  }

  clear() {
    this.generation += 1;
    this.staticCache.clear();
    this.partCache.clear();
    this.pendingStatic.clear();
    this.pendingParts.clear();
  }

  metrics(activeLayers = 0) {
    return {
      cacheRebuilds: this.rebuildCount,
      rasterizations: this.rasterizationCount,
      activeRasterLayers: activeLayers,
      cacheBytes: this.staticCache.bytes + this.partCache.bytes,
      cacheEntries: this.staticCache.size + this.partCache.size,
    };
  }
}

export function staticPreviewKey(snapshot) {
  return [snapshot.master ?? "", snapshot.pose ?? "", snapshot.expression ?? ""].join("|");
}

function defaultDispose(entry) {
  entry.bitmap?.close?.();
  entry.element?.remove?.();
  if (entry.canvas) {
    entry.canvas.remove?.();
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
}
