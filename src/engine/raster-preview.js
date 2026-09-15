import { RasterCacheCoordinator, staticPreviewKey } from "./raster-cache.js";
import {
  applyTimelineState,
  createTimelineRuntime,
  createTimelineState,
  evaluateTimelineStateInto,
  prepareTimelineStaticState,
} from "./timeline-state.js";

const SMALL_LAYER_AREA_RATIO = 0.25;
const PART_PADDING = 6;

export class RasterPreviewRenderer {
  constructor(svg, pack, host, { staticLimit = 2, partLimit = 32 } = {}) {
    this.backend = "raster";
    this.sourceSvg = svg;
    this.pack = pack;
    this.host = host;
    this.timeline = createTimelineRuntime();
    this.cache = new RasterCacheCoordinator({ staticLimit, partLimit });
    this.dynamicSlots = collectDynamicSlots(pack.config.controllers);
    this.dynamicPartIds = new Set([...this.dynamicSlots].flatMap((slot) => pack.config.partSlots[slot] ?? []));
    this.dynamicPartIdsForBase = new Set([...this.dynamicPartIds, ...(pack.config.effectParts ?? [])]);
    this.effectIds = new Set(pack.config.effectParts ?? []);
    this.alwaysPartIds = new Set();
    this.layerTargets = new Map();
    this.layers = new Map();
    this.compositeWrappers = new Map();
    this.appliedTransforms = new Map();
    this.currentDesired = new Set();
    this.currentStatic = null;
    this.pendingLayerRequests = new Set();
    this.staticRequest = 0;
    this.active = true;
    this.animationRunning = true;
    this.prewarmQueue = [];
    this.prewarmScheduled = false;
    this.onInvalidate = null;
    this.viewBox = readViewBox(svg, pack.config.canvas);
    this.pixelScale = 1;
  }

  static supported() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("2d") && globalThis.Image && globalThis.XMLSerializer && URL?.createObjectURL);
    } catch {
      return false;
    }
  }

  async initialize(snapshot) {
    if (!RasterPreviewRenderer.supported()) throw new Error("Raster Previewに必要なCanvas/SVG画像化APIがありません");
    this.host.replaceChildren(this.sourceSvg);
    this.sourceSvg.classList.add("raster-measure-source");
    this.indexSource();
    this.buildLayerPlan();
    this.buildScene();
    this.sourceSvg.classList.remove("raster-measure-source");
    this.sourceSvg.remove();
    await this.prepareStatic(snapshot, { rebuildBase: true });
    this.schedulePrewarm();
  }

  async prepareStatic(snapshot, { rebuildBase = true } = {}) {
    prepareTimelineStaticState(this.pack, snapshot, this.timeline);
    const fixedSnapshot = {
      ...snapshot,
      emoteVisible: [...(snapshot.emoteVisible ?? [])],
      gaze: { x: 0, y: 0 },
      reducedMotion: true,
    };
    const state = createTimelineState(this.pack, fixedSnapshot, 0, { level: 0 });
    const request = ++this.staticRequest;
    if (rebuildBase) {
      const key = `${staticPreviewKey(state)}@${this.pixelScale.toFixed(3)}`;
      await this.cache.ensureStatic(key, () => this.rasterizeBase(state)).then((entry) => {
        if (!this.active || request !== this.staticRequest) return;
        this.attachStatic(entry);
      });
    }
    await this.ensurePartsForState(state);
    if (this.active && request === this.staticRequest) this.onInvalidate?.();
  }

  render(snapshot, time, source = {}) {
    const startedAt = performance.now();
    const state = evaluateTimelineStateInto(this.pack, snapshot, time, source, this.timeline);
    const desired = this.desiredParts(state);
    this.currentDesired = desired;
    let updates = 0;
    for (const [id, layer] of this.layers) updates += setLayerVisible(layer.canvas, desired.has(id));
    for (const id of desired) {
      const entry = this.cache.partCache.get(id);
      if (entry) {
        updates += this.attachPart(id, entry);
        updates += this.applyPartTransform(id, entry, state);
      } else {
        this.requestPart(id);
      }
    }
    for (const [id, wrapper] of this.compositeWrappers) {
      updates += setCssTransform(wrapper, id, state.transforms[id], this.appliedTransforms, this.sceneScale);
    }
    const cacheMetrics = this.cache.metrics([...this.layers.values()].filter((layer) => layer.canvas.style.display !== "none").length + (this.currentStatic ? 1 : 0));
    return { state, updates, processingMs: performance.now() - startedAt, backend: this.backend, ...cacheMetrics };
  }

  destroy() {
    this.active = false;
    this.staticRequest += 1;
    this.resizeObserver?.disconnect();
    this.cache.clear();
    for (const layer of this.layers.values()) layer.canvas.remove();
    this.layers.clear();
    this.pendingLayerRequests.clear();
    this.root?.remove();
    this.sourceSvg.remove?.();
  }

  setRunning(running) {
    this.animationRunning = Boolean(running);
    if (this.animationRunning) this.schedulePrewarmStep();
  }

  indexSource() {
    this.byId = new Map();
    for (const node of this.sourceSvg.querySelectorAll("[id]")) this.byId.set(node.id, node);
    this.bboxes = new Map();
  }

  buildLayerPlan() {
    const targets = new Set([
      ...(this.pack.motionTargets ?? []),
      ...(this.pack.poseTargets ?? []),
      ...(this.pack.config.controllers.gaze?.targets ?? []),
    ]);
    const measuredIds = new Set([...targets, ...this.dynamicPartIdsForBase]);
    for (const id of measuredIds) {
      const box = safeBBox(this.byId.get(id));
      if (box) this.bboxes.set(id, box);
    }
    const masterNodes = Object.values(this.pack.config.assetModel.masters).map((item) => this.byId.get(item.root)).filter(Boolean);
    this.compositeTargetIds = [...targets].filter((id) => {
      const node = this.byId.get(id);
      return node && masterNodes.length > 0 && masterNodes.every((master) => node !== master && node.contains(master));
    }).sort((left, right) => nodeDepth(this.byId.get(left)) - nodeDepth(this.byId.get(right)));

    for (const id of targets) {
      if (this.compositeTargetIds.includes(id)) continue;
      const node = this.byId.get(id);
      const box = this.bboxes.get(id);
      if (!node || !box || !node.hasAttribute("data-export-part")) continue;
      if (box.width * box.height <= this.viewBox.width * this.viewBox.height * SMALL_LAYER_AREA_RATIO) {
        this.alwaysPartIds.add(id);
        this.dynamicPartIdsForBase.add(id);
      }
    }

    for (const id of this.dynamicPartIdsForBase) {
      const node = this.byId.get(id);
      if (!node) continue;
      this.layerTargets.set(id, [...targets].filter((target) => {
        if (this.compositeTargetIds.includes(target)) return false;
        const targetNode = this.byId.get(target);
        return targetNode && (targetNode === node || targetNode.contains(node));
      }).sort((left, right) => nodeDepth(this.byId.get(left)) - nodeDepth(this.byId.get(right))));
    }
  }

  buildScene() {
    this.root = element("div", "raster-preview");
    this.scene = element("div", "raster-preview-scene");
    this.scene.style.width = `${this.viewBox.width}px`;
    this.scene.style.height = `${this.viewBox.height}px`;
    this.root.append(this.scene);
    let parent = this.scene;
    for (const id of this.compositeTargetIds) {
      const wrapper = element("div", "raster-preview-transform");
      wrapper.dataset.target = id;
      parent.append(wrapper);
      parent = wrapper;
      this.compositeWrappers.set(id, wrapper);
    }
    this.contentRoot = parent;
    this.host.replaceChildren(this.root);
    this.updateSceneScale();
    if (globalThis.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.updateSceneScale());
      this.resizeObserver.observe(this.host);
    }
  }

  updateSceneScale() {
    const width = this.host.clientWidth || this.viewBox.width;
    const height = this.host.clientHeight || this.viewBox.height;
    this.sceneScale = Math.min(width / this.viewBox.width, height / this.viewBox.height) || 1;
    this.scene.style.setProperty("--scene-scale", String(this.sceneScale));
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    this.pixelScale = Math.min(1, Math.max(0.35, this.sceneScale * dpr));
  }

  async rasterizeBase(state) {
    const clone = this.sourceSvg.cloneNode(true);
    applyTimelineState(clone, this.pack, { ...state, transforms: {} });
    pruneInvisibleParts(clone, this.pack, state);
    for (const id of this.dynamicPartIdsForBase) hideById(clone, id);
    const canvas = await rasterize(clone, this.viewBox, this.pixelScale);
    canvas.className = "raster-layer raster-static-layer";
    positionCanvas(canvas, this.viewBox, this.viewBox);
    return { canvas, bbox: this.viewBox, bytes: canvas.width * canvas.height * 4 };
  }

  async ensurePartsForState(state) {
    for (const id of this.desiredParts(state)) await this.ensurePart(id);
  }

  ensurePart(id) {
    return this.cache.ensurePart(id, () => this.rasterizePart(id));
  }

  requestPart(id) {
    if (this.pendingLayerRequests.has(id)) return;
    this.pendingLayerRequests.add(id);
    this.ensurePart(id).then(() => {
      if (this.active) this.onInvalidate?.();
    }).catch(() => {}).finally(() => this.pendingLayerRequests.delete(id));
  }

  async rasterizePart(id) {
    const sourceNode = this.byId.get(id);
    if (!sourceNode) throw new Error(`Raster part ${id} がcharacter.svgにありません`);
    const clone = this.sourceSvg.cloneNode(true);
    isolateExportPart(clone, id);
    const measured = paddedBox(this.bboxes.get(id) ?? this.viewBox, PART_PADDING, this.viewBox);
    const isLarge = measured.width * measured.height > this.viewBox.width * this.viewBox.height * SMALL_LAYER_AREA_RATIO;
    const renderBox = isLarge ? this.viewBox : measured;
    const full = await rasterize(clone, renderBox, this.pixelScale);
    const entry = isLarge ? trimTransparentCanvas(full, renderBox, this.pixelScale) : { canvas: full, bbox: renderBox };
    entry.canvas.className = "raster-layer raster-part-layer";
    positionCanvas(entry.canvas, entry.bbox, this.viewBox);
    entry.bytes = entry.canvas.width * entry.canvas.height * 4;
    entry.targets = this.layerTargets.get(id) ?? [];
    return entry;
  }

  desiredParts(state) {
    const desired = new Set(this.alwaysPartIds);
    for (const slot of this.dynamicSlots) {
      const id = state.parts[slot];
      if (id) desired.add(id);
    }
    for (const id of state.effects) if (this.effectIds.has(id)) desired.add(id);
    return desired;
  }

  attachStatic(entry) {
    if (this.currentStatic === entry) return;
    this.currentStatic?.canvas.remove();
    this.currentStatic = entry;
    this.contentRoot.prepend(entry.canvas);
  }

  attachPart(id, entry) {
    const existing = this.layers.get(id);
    if (existing?.canvas === entry.canvas) return setLayerVisible(entry.canvas, true);
    existing?.canvas.remove();
    this.layers.set(id, entry);
    this.contentRoot.append(entry.canvas);
    entry.canvas.style.display = "";
    return 1;
  }

  applyPartTransform(id, entry, state) {
    const value = entry.targets.map((target) => state.transforms[target]).filter(Boolean).join(" ");
    return setCssTransform(entry.canvas, `part:${id}`, value, this.appliedTransforms, this.sceneScale, entry.bbox);
  }

  schedulePrewarm() {
    const blinkParts = Object.entries(this.pack.config.controllers.blink ?? {})
      .filter(([key, value]) => key.endsWith("Parts") && value && !Array.isArray(value))
      .flatMap(([, value]) => Object.values(value));
    const lipParts = this.pack.config.controllers.lipSync?.parts ?? [];
    this.prewarmQueue = [...new Set([...blinkParts, ...lipParts])].filter((id) => !this.cache.partCache.get(id));
    this.schedulePrewarmStep();
  }

  schedulePrewarmStep() {
    if (!this.active || !this.animationRunning || !this.prewarmQueue.length || this.prewarmScheduled) return;
    if (document.hidden) {
      document.addEventListener("visibilitychange", () => this.schedulePrewarmStep(), { once: true });
      return;
    }
    this.prewarmScheduled = true;
    scheduleIdle(() => {
      this.prewarmScheduled = false;
      if (!this.active || !this.animationRunning || document.hidden || !this.prewarmQueue.length) return this.schedulePrewarmStep();
      this.ensurePart(this.prewarmQueue.shift()).catch(() => {}).finally(() => this.schedulePrewarmStep());
    });
  }
}

export function collectDynamicSlots(controllers = {}) {
  const slots = new Set([controllers.lipSync?.slot].filter(Boolean));
  for (const [key, value] of Object.entries(controllers.blink ?? {})) {
    if (key.endsWith("Parts") && value && !Array.isArray(value)) for (const slot of Object.keys(value)) slots.add(slot);
  }
  return slots;
}

function readViewBox(svg, canvas) {
  const value = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (value?.length === 4 && value.every(Number.isFinite)) return { x: value[0], y: value[1], width: value[2], height: value[3] };
  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

function safeBBox(node) {
  try {
    const box = node.getBBox();
    if (Number.isFinite(box.width) && Number.isFinite(box.height) && box.width >= 0 && box.height >= 0) return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch {}
  return null;
}

function paddedBox(box, padding, bounds) {
  const x = Math.max(bounds.x, box.x - padding);
  const y = Math.max(bounds.y, box.y - padding);
  const right = Math.min(bounds.x + bounds.width, box.x + box.width + padding);
  const bottom = Math.min(bounds.y + bounds.height, box.y + box.height + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

async function rasterize(svg, box, scale) {
  const width = Math.max(1, Math.ceil(box.width * scale));
  const height = Math.max(1, Math.ceil(box.height * scale));
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function trimTransparentCanvas(canvas, box, scale) {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, bbox: { x: box.x, y: box.y, width: 1 / scale, height: 1 / scale } };
  }
  const padding = Math.max(1, Math.ceil(PART_PADDING * scale));
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(canvas.width - 1, right + padding);
  bottom = Math.min(canvas.height - 1, bottom + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const cropped = document.createElement("canvas");
  cropped.width = width;
  cropped.height = height;
  cropped.getContext("2d", { alpha: true }).drawImage(canvas, left, top, width, height, 0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return {
    canvas: cropped,
    bbox: { x: box.x + left / scale, y: box.y + top / scale, width: width / scale, height: height / scale },
  };
}

function isolateExportPart(svg, id) {
  const selected = findById(svg, id);
  if (!selected) return;
  for (const node of svg.querySelectorAll("[data-export-part]")) {
    if (node === selected || node.contains(selected)) continue;
    node.setAttribute("display", "none");
  }
  selected.removeAttribute("display");
  selected.style.display = "";
  selected.style.opacity = "1";
}

function hideById(svg, id) {
  const node = findById(svg, id);
  if (node) node.setAttribute("display", "none");
}

function pruneInvisibleParts(svg, pack, state) {
  for (const [name, definition] of Object.entries(pack.config.assetModel.masters)) {
    if (name !== state.master) hideById(svg, definition.root);
  }
  for (const [slot, ids] of Object.entries(pack.config.partSlots)) {
    for (const id of ids) if (id !== state.parts[slot]) hideById(svg, id);
  }
  const effects = new Set(state.effects);
  for (const id of pack.config.effectParts ?? []) if (!effects.has(id)) hideById(svg, id);
}

function findById(svg, id) {
  if (!id) return null;
  const escape = globalThis.CSS?.escape ?? ((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  return svg.querySelector(`#${escape(id)}`);
}

function positionCanvas(canvas, box, viewBox) {
  canvas.style.left = `${box.x - viewBox.x}px`;
  canvas.style.top = `${box.y - viewBox.y}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
}

function setLayerVisible(canvas, visible) {
  const value = visible ? "" : "none";
  if (canvas.style.display === value) return 0;
  canvas.style.display = value;
  return 1;
}

function setCssTransform(node, key, svgTransform, applied, sceneScale, bbox = null) {
  const parsed = parseSvgTransform(svgTransform);
  const value = parsed.css;
  const origin = bbox && parsed.origin
    ? `${parsed.origin.x - bbox.x}px ${parsed.origin.y - bbox.y}px`
    : parsed.origin ? `${parsed.origin.x}px ${parsed.origin.y}px` : "0 0";
  const signature = `${value}|${origin}|${sceneScale}`;
  if (applied.get(key) === signature) return 0;
  node.style.transform = value;
  node.style.transformOrigin = origin;
  applied.set(key, signature);
  return 1;
}

export function parseSvgTransform(value = "") {
  const translate = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(value);
  const rotate = /rotate\(([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\)/.exec(value);
  const scale = /scale\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(value);
  const x = Number(translate?.[1] ?? 0);
  const y = Number(translate?.[2] ?? 0);
  const degrees = Number(rotate?.[1] ?? 0);
  const scaleX = Number(scale?.[1] ?? 1);
  const scaleY = Number(scale?.[2] ?? 1);
  return {
    css: `translate3d(${x}px, ${y}px, 0) rotate(${degrees}deg) scale(${scaleX}, ${scaleY})`,
    origin: rotate ? { x: Number(rotate[2]), y: Number(rotate[3]) } : null,
  };
}

function nodeDepth(node) {
  let depth = 0;
  for (let current = node; current?.parentElement; current = current.parentElement) depth += 1;
  return depth;
}

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Realtime Preview用SVGを画像化できませんでした"));
    image.src = url;
  });
}

function scheduleIdle(callback) {
  if (globalThis.requestIdleCallback) requestIdleCallback(callback, { timeout: 500 });
  else setTimeout(callback, 32);
}
