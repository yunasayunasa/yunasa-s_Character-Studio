import {
  createTimelineRuntime,
  evaluateTimelineStateInto,
  prepareTimelineStaticState,
} from "./timeline-state.js";

export function buildPreviewDomCache(svg, pack) {
  const byId = new Map();
  for (const node of svg.querySelectorAll("[id]")) byId.set(node.id, node);
  const slots = new Map(Object.entries(pack.config.partSlots).map(([slot, ids]) => [slot, ids.map((id) => [id, byId.get(id)]).filter(([, node]) => node)]));
  const dynamicSlots = new Set([pack.config.controllers.lipSync?.slot].filter(Boolean));
  for (const [key, parts] of Object.entries(pack.config.controllers.blink ?? {})) {
    if (key.endsWith("Parts") && parts && !Array.isArray(parts)) for (const slot of Object.keys(parts)) dynamicSlots.add(slot);
  }
  const transformIds = new Set([
    ...(pack.motionTargets ?? []),
    ...(pack.poseTargets ?? []),
    ...(pack.config.controllers.gaze?.targets ?? []),
  ]);
  return {
    byId,
    masters: Object.entries(pack.config.assetModel.masters).map(([name, definition]) => [name, definition.root, byId.get(definition.root)]).filter(([, , node]) => node),
    slots,
    effects: (pack.config.effectParts ?? []).map((id) => [id, byId.get(id)]).filter(([, node]) => node),
    transforms: [...transformIds].map((id) => [id, byId.get(id)]).filter(([, node]) => node),
    dynamicSlots,
  };
}

export class RealtimePreviewRenderer {
  constructor(svg, pack) {
    this.backend = "legacy-svg";
    this.pack = pack;
    this.cache = buildPreviewDomCache(svg, pack);
    this.timeline = createTimelineRuntime();
    this.appliedVisibility = new Map();
    this.appliedTransforms = new Map();
    this.staticDirty = true;
  }

  prepareStatic(snapshot) {
    prepareTimelineStaticState(this.pack, snapshot, this.timeline);
    this.staticDirty = true;
  }

  render(snapshot, time, source = {}) {
    const startedAt = performance.now();
    const state = evaluateTimelineStateInto(this.pack, snapshot, time, source, this.timeline);
    let updates = 0;
    if (this.staticDirty) {
      for (const [name, id, node] of this.cache.masters) updates += setVisible(node, id, name === state.master, this.appliedVisibility);
      for (const [slot, entries] of this.cache.slots) updates += applySlot(entries, state.parts[slot], this.appliedVisibility);
      const visibleEffects = new Set(state.effects);
      for (const [id, node] of this.cache.effects) updates += setVisible(node, id, visibleEffects.has(id), this.appliedVisibility);
      this.staticDirty = false;
    } else {
      for (const slot of this.cache.dynamicSlots) {
        const entries = this.cache.slots.get(slot);
        if (entries) updates += applySlot(entries, state.parts[slot], this.appliedVisibility);
      }
    }
    for (const [id, node] of this.cache.transforms) updates += setTransform(node, id, state.transforms[id], this.appliedTransforms);
    return {
      state,
      updates,
      processingMs: performance.now() - startedAt,
      backend: this.backend,
      cacheRebuilds: 0,
      rasterizations: 0,
      activeRasterLayers: 0,
      cacheBytes: 0,
      cacheEntries: 0,
    };
  }
}

function applySlot(entries, selected, applied) {
  if (!entries.length) return 0;
  let updates = 0;
  for (const [id, node] of entries) updates += setVisible(node, id, id === selected, applied);
  return updates;
}

function setVisible(node, id, visible, applied) {
  if (applied.get(id) === visible) return 0;
  node.style.display = visible ? "" : "none";
  node.style.opacity = visible ? "1" : "0";
  node.style.pointerEvents = visible ? "auto" : "none";
  applied.set(id, visible);
  return 1;
}

function setTransform(node, id, value, applied) {
  const normalized = value ?? "";
  if (applied.get(id) === normalized) return 0;
  if (normalized) node.setAttribute("transform", normalized);
  else node.removeAttribute("transform");
  applied.set(id, normalized);
  return 1;
}
