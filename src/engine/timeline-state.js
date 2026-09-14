const TRANSFORM_ORDER = ["pose", "motion", "expression", "gaze"];

export function createTimelineState(pack, snapshot, time, source = {}) {
  const runtime = createTimelineRuntime();
  prepareTimelineStaticState(pack, snapshot, runtime);
  return evaluateTimelineStateInto(pack, snapshot, time, source, runtime);
}

export function createTimelineRuntime() {
  return {
    baseParts: {},
    baseEffects: [],
    pose: null,
    motion: null,
    expressionName: null,
    poseName: null,
    master: null,
    transformChannels: new Map(),
    state: { time: 0, expression: null, pose: null, master: null, parts: {}, effects: [], transforms: {}, lipLevel: 0 },
  };
}

export function prepareTimelineStaticState(pack, snapshot, runtime) {
  const expressionName = snapshot.expression ?? pack.expressions.default;
  const poseName = snapshot.pose ?? pack.poses?.default;
  const expression = pack.expressions.expressions[expressionName] ?? pack.expressions.expressions[pack.expressions.default];
  const pose = pack.poses?.poses?.[poseName] ?? {};
  runtime.expressionName = expressionName;
  runtime.poseName = poseName;
  runtime.pose = pose;
  runtime.master = pose.master ?? snapshot.master ?? pack.config.assetModel.defaultMaster;
  runtime.motion = pack.motions.motions[snapshot.motion ?? pack.motions.default] ?? pack.motions.motions[pack.motions.default];
  clearObject(runtime.baseParts);
  Object.assign(runtime.baseParts, expression.parts ?? {}, pose.parts ?? {});
  runtime.baseEffects.length = 0;
  for (const id of expression.visible ?? []) if (!runtime.baseEffects.includes(id)) runtime.baseEffects.push(id);
  for (const id of snapshot.emoteVisible ?? []) if (!runtime.baseEffects.includes(id)) runtime.baseEffects.push(id);
  return runtime;
}

export function evaluateTimelineStateInto(pack, snapshot, time, source = {}, runtime) {
  const t = Math.max(0, Number(time) || 0);
  const { state } = runtime;
  clearObject(state.parts);
  Object.assign(state.parts, runtime.baseParts);
  resetTransformChannels(runtime.transformChannels);

  addPoseTransform(runtime.transformChannels, runtime.pose?.transform);
  for (const track of runtime.motion?.tracks ?? []) addTrackTransform(runtime.transformChannels, track, t, snapshot.reducedMotion);
  addGazeTransforms(runtime.transformChannels, pack.config.controllers.gaze, snapshot.gaze);

  const blink = pack.config.controllers.blink;
  if (blink && !snapshot.reducedMotion && isBlinkClosed(t, blink, pack.config.id)) {
    Object.assign(state.parts, blink.closedParts ?? {});
  }

  const lipLevel = resolveLipLevel(source, t);
  applyLipSync(state.parts, pack.config.controllers.lipSync, lipLevel);
  applyMasterOverrides(state.parts, pack.config.assetModel.masterOverrides?.[runtime.master]);
  clearObject(state.transforms);
  for (const [id, value] of runtime.transformChannels) state.transforms[id] = composeTransform(value);
  state.time = t;
  state.expression = runtime.expressionName;
  state.pose = runtime.poseName;
  state.master = runtime.master;
  state.effects = runtime.baseEffects;
  state.lipLevel = lipLevel;
  return state;
}

export function applyTimelineState(svg, pack, state, { transition = false } = {}) {
  const escape = globalThis.CSS?.escape ?? ((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const byId = (id) => id ? svg.querySelector(`#${escape(id)}`) : null;
  for (const [masterId, definition] of Object.entries(pack.config.assetModel.masters)) {
    setVisible(byId(definition.root), masterId === state.master, transition);
  }
  for (const [slot, ids] of Object.entries(pack.config.partSlots)) {
    for (const id of ids) setVisible(byId(id), id === state.parts[slot], transition);
  }
  const visibleEffects = new Set(state.effects);
  for (const id of pack.config.effectParts ?? []) setVisible(byId(id), visibleEffects.has(id), transition);

  const controlledTargets = new Set([
    ...(pack.motionTargets ?? []),
    ...(pack.poseTargets ?? []),
    ...(pack.config.controllers.gaze?.targets ?? []),
  ]);
  for (const id of controlledTargets) {
    const node = byId(id);
    if (!node) continue;
    const value = state.transforms[id];
    if (value) node.setAttribute("transform", value);
    else node.removeAttribute("transform");
  }
}

export function envelopeLevelAt(envelope, time) {
  if (!envelope?.levels?.length || !Number.isFinite(envelope.sampleRate)) return 0;
  const position = Math.max(0, time) * envelope.sampleRate;
  const left = Math.min(envelope.levels.length - 1, Math.floor(position));
  const right = Math.min(envelope.levels.length - 1, left + 1);
  const fraction = position - left;
  return clamp(envelope.levels[left] * (1 - fraction) + envelope.levels[right] * fraction, 0, 1);
}

export function subtitleLevelAt(cues, time) {
  const cue = cues?.find((item) => time >= item.start && time < item.end);
  if (!cue) return 0;
  const plain = cue.text.replace(/\s/g, "");
  if (!plain) return 0;
  const elapsed = Math.max(0, time - cue.start);
  const character = plain[Math.floor(elapsed * 8) % plain.length];
  if (/[、。…,.!?！？]/.test(character)) return 0;
  return [0.34, 0.68, 0.48, 0.82][Math.floor(elapsed * 10) % 4];
}

function resolveLipLevel(source, time) {
  if (Number.isFinite(source.level)) return clamp(source.level, 0, 1);
  const audio = envelopeLevelAt(source.audioEnvelope, time + (source.timeOffset ?? 0));
  const subtitle = subtitleLevelAt(source.cues, time + (source.timeOffset ?? 0));
  if (source.mode === "audio") return audio;
  if (source.mode === "subtitle") return subtitle;
  if (source.mode === "combined") return Math.max(audio, subtitle * 0.7);
  return clamp(source.manualLevel ?? 0, 0, 1);
}

function applyLipSync(parts, controller, level) {
  if (!controller) return;
  const normalized = level < (controller.noiseFloor ?? 0.025) ? 0 : level;
  const thresholds = controller.thresholds ?? [0.08, 0.24, 0.52];
  const index = normalized === 0 ? 0 : normalized < thresholds[0] ? 1 : normalized < thresholds[1] ? 2 : 3;
  if (normalized > 0) parts[controller.slot] = controller.parts[Math.min(index, controller.parts.length - 1)];
}

function applyMasterOverrides(parts, override) {
  for (const [slot, selected] of Object.entries(parts)) {
    const replacement = override?.parts?.[selected];
    if (replacement) parts[slot] = replacement;
  }
}

function addPoseTransform(collection, transform) {
  if (!transform?.target) return;
  addComponent(collection, transform.target, "pose", {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    rotate: transform.rotateDegrees ?? 0,
    scaleX: transform.scaleX ?? 1,
    scaleY: transform.scaleY ?? 1,
    origin: transform.origin,
  });
}

function addTrackTransform(collection, track, time, reducedMotion) {
  if (!track?.target || reducedMotion) return;
  const phase = waveAt(track, time);
  const amplitude = Number(track.amplitude ?? 0);
  const value = amplitude * phase + Number(track.offset ?? 0);
  const component = { origin: track.origin };
  if (track.property === "translateX") component.x = value;
  else if (track.property === "translateY") component.y = value;
  else if (track.property === "rotation") component.rotate = value;
  else if (track.property === "scaleX") component.scaleX = 1 + value;
  else if (track.property === "scaleY") component.scaleY = 1 + value;
  else return;
  addComponent(collection, track.target, "motion", component);
}

function addGazeTransforms(collection, gaze, value = {}) {
  for (const target of gaze?.targets ?? []) {
    addComponent(collection, target, "gaze", {
      x: clamp(value.x ?? 0, -1, 1) * (gaze.maxX ?? 0),
      y: clamp(value.y ?? 0, -1, 1) * (gaze.maxY ?? 0),
    });
  }
}

function addComponent(collection, target, channel, value) {
  const targetState = collection.get(target) ?? {};
  const current = targetState[channel] ?? { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, origin: null, active: false };
  if (!current.active) {
    current.x = 0;
    current.y = 0;
    current.rotate = 0;
    current.scaleX = 1;
    current.scaleY = 1;
    current.origin = null;
    current.active = true;
  }
  current.x += value.x ?? 0;
  current.y += value.y ?? 0;
  current.rotate += value.rotate ?? 0;
  current.scaleX *= value.scaleX ?? 1;
  current.scaleY *= value.scaleY ?? 1;
  current.origin = value.origin ?? current.origin;
  targetState[channel] = current;
  collection.set(target, targetState);
}

function composeTransform(channels) {
  const result = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, origin: { x: 0, y: 0 } };
  for (const name of TRANSFORM_ORDER) {
    const item = channels[name];
    if (!item?.active) continue;
    result.x += item.x ?? 0;
    result.y += item.y ?? 0;
    result.rotate += item.rotate ?? 0;
    result.scaleX *= item.scaleX ?? 1;
    result.scaleY *= item.scaleY ?? 1;
    if (item.origin) result.origin = item.origin;
  }
  const { x, y } = result.origin;
  return `translate(${round(result.x)} ${round(result.y)}) rotate(${round(result.rotate)} ${round(x)} ${round(y)}) translate(${round(x)} ${round(y)}) scale(${round(result.scaleX)} ${round(result.scaleY)}) translate(${round(-x)} ${round(-y)})`;
}

function waveAt(track, time) {
  const period = Math.max(0.001, Number(track.period ?? 1));
  const normalized = ((time - Number(track.delay ?? 0)) / period + Number(track.phase ?? 0)) % 1;
  const p = normalized < 0 ? normalized + 1 : normalized;
  let value;
  if (track.wave === "triangle") value = 1 - 4 * Math.abs(p - 0.5);
  else if (track.wave === "saw") value = p * 2 - 1;
  else if (track.wave === "pulse") value = p < (track.duty ?? 0.5) ? 1 : -1;
  else value = Math.sin(p * Math.PI * 2);
  if (track.easing === "easeInOut") value = Math.sign(value) * (1 - Math.cos(Math.abs(value) * Math.PI)) / 2;
  return value;
}

function isBlinkClosed(time, blink, seedText) {
  const [minMs, maxMs] = blink.intervalMs ?? [2400, 5200];
  const duration = (blink.durationMs ?? 130) / 1000;
  let cursor = 0;
  let cycle = 0;
  const seed = hash(seedText);
  while (cursor <= time && cycle < 100000) {
    const random = pseudoRandom(seed + cycle * 2654435761);
    cursor += (minMs + random * Math.max(0, maxMs - minMs)) / 1000;
    if (time >= cursor && time < cursor + duration) return true;
    cursor += duration;
    cycle += 1;
  }
  return false;
}

function setVisible(node, visible, transition) {
  if (!node) return;
  node.style.transition = transition ? "opacity 150ms ease-out" : "none";
  node.style.opacity = visible ? "1" : "0";
  node.style.pointerEvents = visible ? "auto" : "none";
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function pseudoRandom(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function round(value) { return Number(value || 0).toFixed(4); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clearObject(value) { for (const key in value) delete value[key]; }
function resetTransformChannels(collection) {
  for (const target of collection.values()) {
    for (const channel of Object.values(target)) channel.active = false;
  }
}
