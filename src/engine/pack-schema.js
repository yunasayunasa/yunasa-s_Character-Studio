const SAFE_RELATIVE_PATH = /^(?![a-z]+:|\/|\\)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+/i;
const SUPPORTED_VERSIONS = new Set([1, 2]);
const TRACK_PROPERTIES = new Set(["translateX", "translateY", "rotation", "scaleX", "scaleY"]);
const TRACK_WAVES = new Set(["sin", "triangle", "saw", "pulse"]);

export function normalizePackData(input) {
  const config = structuredClone(input.config);
  const expressions = structuredClone(input.expressions);
  const motions = structuredClone(input.motions);
  const poses = input.poses ? structuredClone(input.poses) : null;
  const emotes = input.emotes ? structuredClone(input.emotes) : null;
  const sourceSchemaVersion = config.schemaVersion;
  if (sourceSchemaVersion === 1) migrateV1(config, expressions, motions, poses, emotes);
  config.compatibility = { ...(config.compatibility ?? {}), sourceSchemaVersion };
  return { ...input, config, expressions, motions, poses, emotes };
}

export function assertCharacterConfig(config) {
  assertObject(config, "character.json");
  assert(SUPPORTED_VERSIONS.has(config.schemaVersion), "character.json: schemaVersion は 1 または 2 が必要です");
  assert(/^[a-z0-9][a-z0-9-]*$/.test(config.id ?? ""), "character.json: id は英小文字・数字・ハイフンで指定します");
  assertObject(config.files, "character.json: files");
  for (const key of ["svg", "expressions", "motions"]) assert(typeof config.files[key] === "string", `character.json: files.${key} が必要です`);
  for (const [key, value] of Object.entries(config.files)) assert(typeof value === "string" && SAFE_RELATIVE_PATH.test(value), `character.json: files.${key} が不正です`);
  assertObject(config.canvas, "character.json: canvas");
  assert(Number.isFinite(config.canvas.width) && config.canvas.width > 0, "character.json: canvas.width が不正です");
  assert(Number.isFinite(config.canvas.height) && config.canvas.height > 0, "character.json: canvas.height が不正です");
  assertObject(config.partSlots, "character.json: partSlots");
  for (const [slot, ids] of Object.entries(config.partSlots)) assert(Array.isArray(ids) && ids.length > 0 && ids.every(Boolean), `character.json: partSlots.${slot} が不正です`);
  assertObject(config.controllers, "character.json: controllers");
  assertControllers(config);
  if (config.schemaVersion === 2) assertAssetModel(config);
  return config;
}

export function assertExpressions(data, config) {
  assertVersionedObject(data, "expressions.json");
  assertObject(data.expressions, "expressions.json: expressions");
  assert(data.expressions[data.default], "expressions.json: default の表情がありません");
  for (const [name, expression] of Object.entries(data.expressions)) {
    assertObject(expression.parts, `expressions.json: ${name}.parts`);
    for (const [slot, id] of Object.entries(expression.parts)) {
      assert(config.partSlots[slot], `expressions.json: expressions.${name}.parts.${slot} refers to an unknown slot`);
      assert(config.partSlots[slot].includes(id), `expressions.json: expressions.${name}.parts.${slot} "${id}" is not registered in partSlots.${slot}`);
    }
  }
  return data;
}

export function assertMotions(data) {
  assertVersionedObject(data, "motions.json");
  assertObject(data.motions, "motions.json: motions");
  assert(data.motions[data.default], "motions.json: default のモーションがありません");
  for (const [motionName, motion] of Object.entries(data.motions)) {
    assert(Array.isArray(motion.tracks), `motions.json: ${motionName}.tracks が必要です`);
    for (const [index, track] of motion.tracks.entries()) {
      const label = `motions.json: ${motionName}.tracks[${index}]`;
      assert(typeof track.target === "string" && track.target, `${label}.target が必要です`);
      assert(TRACK_PROPERTIES.has(track.property), `${label}.property が不正です`);
      assert(TRACK_WAVES.has(track.wave ?? "sin"), `${label}.wave が不正です`);
      assert(Number.isFinite(track.amplitude), `${label}.amplitude が不正です`);
      assert(Number.isFinite(track.period) && track.period > 0, `${label}.period が不正です`);
    }
  }
  return data;
}

export function assertPoses(data, config) {
  if (!data) return null;
  assertVersionedObject(data, "poses.json");
  assertObject(data.poses, "poses.json: poses");
  assert(data.poses[data.default], "poses.json: default のポーズがありません");
  for (const [name, pose] of Object.entries(data.poses)) {
    assert(config.assetModel.masters[pose.master ?? config.assetModel.defaultMaster], `poses.json: ${name}.master が未登録です`);
    for (const [slot, id] of Object.entries(pose.parts ?? {})) assert(config.partSlots[slot]?.includes(id), `poses.json: poses.${name}.parts.${slot} "${id}" is not registered in partSlots.${slot}`);
  }
  return data;
}

export function assertEmotes(data, config) {
  if (!data) return null;
  assertVersionedObject(data, "emotes.json");
  assertObject(data.emotes, "emotes.json: emotes");
  assert(data.emotes[data.default], "emotes.json: default のエモートがありません");
  const allowed = new Set(config.effectParts ?? []);
  for (const [name, emote] of Object.entries(data.emotes)) for (const [index, id] of (emote.visible ?? []).entries()) assert(allowed.has(id), `emotes.json: emotes.${name}.visible[${index}] "${id}" is not registered in effectParts`);
  return data;
}

export function collectJsonPartIds(config, expressions, poses, emotes) {
  return new Set(collectSvgReferenceEntries(config, expressions, null, poses, emotes).map((entry) => entry.id));
}

export function assertSvgReferences(svgIds, config, expressions, motions, poses, emotes) {
  const ids = svgIds instanceof Set ? svgIds : new Set(svgIds);
  for (const reference of collectSvgReferenceEntries(config, expressions, motions, poses, emotes)) {
    const { file, path, id, slot } = reference;
    assert(typeof id === "string" && id.length > 0, `${file}: ${path} must be a non-empty SVG ID`);
    assert(ids.has(id), `${file}: ${path} "${id}" does not exist in character.svg`);
    if (slot) {
      const allowed = slot === "effects" ? config.effectParts : config.partSlots[slot];
      assert(Array.isArray(allowed), `${file}: ${path} refers to unknown part slot "${slot}"`);
      assert(allowed.includes(id), `${file}: ${path} "${id}" is not registered in partSlots.${slot}`);
    }
  }
}

export function collectSvgReferenceEntries(config, expressions, motions, poses, emotes) {
  const entries = [];
  addRefs(entries, "character.json", "requiredParts", config.requiredParts);
  addRefs(entries, "character.json", "optionalParts", config.optionalParts);
  addRefs(entries, "character.json", "effectParts", config.effectParts);
  for (const [slot, values] of Object.entries(config.partSlots ?? {})) addRefs(entries, "character.json", `partSlots.${slot}`, values, slot);
  for (const [name, master] of Object.entries(config.assetModel?.masters ?? {})) addRefs(entries, "character.json", `assetModel.masters.${name}.root`, master.root);
  for (const [slot, values] of Object.entries(config.assetModel?.sharedParts ?? {})) addRefs(entries, "character.json", `assetModel.sharedParts.${slot}`, values, slot);
  for (const [master, override] of Object.entries(config.assetModel?.masterOverrides ?? {})) {
    for (const [source, replacement] of Object.entries(override.parts ?? {})) {
      entries.push({ file: "character.json", path: `assetModel.masterOverrides.${master}.parts.${source} (source)`, id: source });
      entries.push({ file: "character.json", path: `assetModel.masterOverrides.${master}.parts.${source}`, id: replacement });
    }
  }
  for (const [index, layer] of (config.psdLayers ?? []).entries()) {
    entries.push({ file: "character.json", path: `psdLayers[${index}].${layer.partId != null ? "partId" : "source"}`, id: layer.partId ?? layer.source });
  }
  collectControllerReferences(entries, config.controllers ?? {});
  for (const [name, expression] of Object.entries(expressions?.expressions ?? {})) {
    for (const [slot, id] of Object.entries(expression.parts ?? {})) entries.push({ file: "expressions.json", path: `expressions.${name}.parts.${slot}`, id, slot });
    addRefs(entries, "expressions.json", `expressions.${name}.visible`, expression.visible);
    addRefs(entries, "expressions.json", `expressions.${name}.hidden`, expression.hidden);
  }
  for (const [name, motion] of Object.entries(motions?.motions ?? {})) {
    for (const [index, track] of (motion.tracks ?? []).entries()) entries.push({ file: "motions.json", path: `motions.${name}.tracks[${index}].target`, id: track.target });
  }
  for (const [name, pose] of Object.entries(poses?.poses ?? {})) {
    for (const [slot, id] of Object.entries(pose.parts ?? {})) entries.push({ file: "poses.json", path: `poses.${name}.parts.${slot}`, id, slot });
    if (Object.hasOwn(pose.transform ?? {}, "target")) entries.push({ file: "poses.json", path: `poses.${name}.transform.target`, id: pose.transform.target });
  }
  for (const [name, emote] of Object.entries(emotes?.emotes ?? {})) {
    addRefs(entries, "emotes.json", `emotes.${name}.visible`, emote.visible);
    addRefs(entries, "emotes.json", `emotes.${name}.hidden`, emote.hidden);
  }
  return entries;
}

function assertAssetModel(config) {
  assertObject(config.assetModel, "character.json: assetModel");
  assertObject(config.assetModel.masters, "character.json: assetModel.masters");
  assert(config.assetModel.masters[config.assetModel.defaultMaster], "character.json: assetModel.defaultMaster が未登録です");
  for (const [name, master] of Object.entries(config.assetModel.masters)) assert(typeof master.root === "string" && master.root, `character.json: assetModel.masters.${name}.root が必要です`);
  for (const [slot, ids] of Object.entries(config.assetModel.sharedParts ?? {})) {
    const allowed = slot === "effects" ? config.effectParts : config.partSlots[slot];
    assert(Array.isArray(allowed), `character.json: assetModel.sharedParts.${slot} のスロットが未登録です`);
    assert(Array.isArray(ids), `character.json: assetModel.sharedParts.${slot} must be an array`);
    for (const [index, id] of ids.entries()) assert(allowed.includes(id), `character.json: assetModel.sharedParts.${slot}[${index}] "${id}" is not registered`);
  }
  for (const [master, override] of Object.entries(config.assetModel.masterOverrides ?? {})) {
    assert(config.assetModel.masters[master], `character.json: masterOverrides.${master} のマスターが未登録です`);
    for (const [baseId, replacementId] of Object.entries(override.parts ?? {})) {
      assert(Object.values(config.partSlots).some((ids) => ids.includes(baseId)), `character.json: assetModel.masterOverrides.${master}.parts source "${baseId}" is not registered`);
      assert(Object.values(config.partSlots).some((ids) => ids.includes(replacementId)), `character.json: assetModel.masterOverrides.${master}.parts.${baseId} "${replacementId}" is not registered`);
    }
  }
}

function assertControllers(config) {
  const blink = config.controllers.blink;
  for (const [key, value] of Object.entries(blink ?? {})) {
    if (!key.endsWith("Parts")) continue;
    if (Array.isArray(value)) continue;
    assertObject(value, `character.json: controllers.blink.${key}`);
    for (const [slot, id] of Object.entries(value)) {
      assert(config.partSlots[slot]?.includes(id), `character.json: controllers.blink.${key}.${slot} "${id}" is not registered in partSlots.${slot}`);
    }
  }
  const lipSync = config.controllers.lipSync;
  if (lipSync) {
    assert(config.partSlots[lipSync.slot], `character.json: controllers.lipSync.slot "${lipSync.slot}" is not registered`);
    for (const [index, id] of (lipSync.parts ?? []).entries()) assert(config.partSlots[lipSync.slot].includes(id), `character.json: controllers.lipSync.parts[${index}] "${id}" is not registered in partSlots.${lipSync.slot}`);
  }
}

function collectControllerReferences(entries, controllers) {
  const blink = controllers.blink ?? {};
  for (const [key, value] of Object.entries(blink)) {
    if (key.endsWith("Parts")) addRefs(entries, "character.json", `controllers.blink.${key}`, value, null, true);
  }
  const lipSync = controllers.lipSync ?? {};
  addRefs(entries, "character.json", "controllers.lipSync.parts", lipSync.parts, lipSync.slot);
  for (const key of ["closed", "small", "medium", "wide"]) {
    if (Object.hasOwn(lipSync, key)) addRefs(entries, "character.json", `controllers.lipSync.${key}`, lipSync[key], lipSync.slot);
  }
  addRefs(entries, "character.json", "controllers.gaze.targets", controllers.gaze?.targets);
  for (const [controllerName, controller] of Object.entries(controllers)) {
    if (["blink", "lipSync", "gaze"].includes(controllerName) || !controller || typeof controller !== "object") continue;
    for (const [key, value] of Object.entries(controller)) {
      if (key === "target" || key === "targets" || key === "visible" || key === "hidden" || key === "parts" || key.endsWith("Parts")) {
        addRefs(entries, "character.json", `controllers.${controllerName}.${key}`, value, null, true);
      }
    }
  }
}

function addRefs(entries, file, path, value, slot = null, objectValues = false) {
  if (value == null) return;
  if (typeof value === "string") {
    entries.push({ file, path, id: value, slot });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((id, index) => entries.push({ file, path: `${path}[${index}]`, id, slot }));
    return;
  }
  if (objectValues && typeof value === "object") {
    for (const [key, id] of Object.entries(value)) entries.push({ file, path: `${path}.${key}`, id, slot: slot ?? key });
  }
}

function migrateV1(config, expressions, motions, poses, emotes) {
  config.schemaVersion = 2;
  expressions.schemaVersion = 2;
  if (poses) poses.schemaVersion = 2;
  if (emotes) emotes.schemaVersion = 2;
  const defaultRoot = config.requiredParts?.includes("body") ? "body" : (config.requiredParts?.[0] ?? "character");
  config.assetModel = config.assetModel ?? {
    defaultMaster: "normal",
    masters: { normal: { root: defaultRoot, label: "互換マスター" } },
    sharedParts: Object.fromEntries(Object.entries(config.partSlots).filter(([slot]) => slot !== "pose")),
    masterOverrides: {},
  };
  for (const pose of Object.values(poses?.poses ?? {})) pose.master ??= config.assetModel.defaultMaster;
  motions.schemaVersion = 2;
  for (const motion of Object.values(motions.motions ?? {})) {
    if (motion.tracks) continue;
    motion.tracks = legacyTracks(motion);
    delete motion.sway;
    delete motion.breathing;
    delete motion.hairSway;
  }
}

function legacyTracks(motion) {
  const tracks = [];
  const sway = motion.sway;
  if (sway) {
    if (sway.x) tracks.push(track(sway, "translateX", sway.x));
    if (sway.y) tracks.push(track(sway, "translateY", sway.y));
    if (sway.rotateDegrees) tracks.push(track(sway, "rotation", sway.rotateDegrees));
  }
  const breathing = motion.breathing;
  if (breathing) {
    if (breathing.y) tracks.push(track(breathing, "translateY", breathing.y));
    if (breathing.scaleY) tracks.push(track(breathing, "scaleY", breathing.scaleY));
  }
  const hair = motion.hairSway;
  if (hair?.rotateDegrees) tracks.push(track(hair, "rotation", hair.rotateDegrees));
  return tracks;
}

function track(source, property, amplitude) {
  return { target: source.target, property, wave: "sin", amplitude, period: source.period, phase: 0, delay: source.delay ?? 0, origin: source.origin };
}

function assertVersionedObject(value, label) {
  assertObject(value, label);
  assert(SUPPORTED_VERSIONS.has(value.schemaVersion), `${label}: schemaVersion は 1 または 2 が必要です`);
}
function assertObject(value, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} はオブジェクトである必要があります`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
