import { loadCharacterPackData } from "./character-loader.js";
import { assertCharacterConfig } from "./pack-schema.js";
import { inspectPsd } from "./psd-inspector.js";
import { findPackRoot, readZipFile } from "./zip-reader.js";

const DATABASE = "svg-character-studio";
const STORE = "character-packs";

export async function importPackFiles(fileList) {
  const files = new Map([...fileList].map((file) => [file.name, file]));
  const characterFile = files.get("character.json");
  if (!characterFile) throw new Error("character.json を選択してください");
  let config;
  try { config = assertCharacterConfig(JSON.parse(await characterFile.text())); }
  catch (error) { throw new Error(`character.json: ${error.message}`); }
  validateDeclaredFiles(config, (path) => files.has(leaf(path)), "選択ファイル");
  const runtimePaths = runtimeFilePaths(config).map(leaf);
  const record = {
    id: config.id,
    label: config.label ?? config.id,
    config,
    expressions: JSON.parse(await files.get(leaf(config.files.expressions)).text()),
    motions: JSON.parse(await files.get(leaf(config.files.motions)).text()),
    poses: config.files.poses ? JSON.parse(await files.get(leaf(config.files.poses)).text()) : null,
    emotes: config.files.emotes ? JSON.parse(await files.get(leaf(config.files.emotes)).text()) : null,
    svgText: await files.get(leaf(config.files.svg)).text(),
    auxiliaryFiles: await Promise.all([...files.entries()]
      .filter(([name]) => !["character.json", ...runtimePaths].includes(name))
      .map(async ([path, file]) => ({ path, data: new Uint8Array(await file.arrayBuffer()) }))),
    sourceFiles: await Promise.all([...files.entries()].map(async ([path, file]) => ({ path, data: new Uint8Array(await file.arrayBuffer()) }))),
    updatedAt: Date.now(),
  };
  const pack = loadCharacterPackData({ ...record, baseUrl: `indexeddb:${record.id}` });
  validateOptionalPsd(new Map(record.sourceFiles.map((item) => [item.path, item.data])), "", config, pack);
  await put(record);
  return record;
}

export async function importPackZip(file) {
  if (!file?.name?.toLowerCase().endsWith(".zip")) throw new Error("character-name.zip を選択してください");
  const files = await readZipFile(file);
  const root = findPackRoot(files);
  const record = decodePackEntries(files, root);
  const { config } = record;
  const pack = loadCharacterPackData({ ...record, baseUrl: `indexeddb:${record.id}` });
  validateOptionalPsd(files, root, config, pack);
  await put(record);
  return record;
}

export function decodePackEntries(files, root = "") {
  const text = (path) => {
    const data = files.get(`${root}${path}`);
    if (!data) throw new Error(`${path}: ZIP内に必要なファイルがありません`);
    return new TextDecoder().decode(data);
  };
  let config;
  try { config = assertCharacterConfig(JSON.parse(text("character.json"))); }
  catch (error) { throw new Error(error.message.startsWith("character.json:") ? error.message : `character.json: JSONが不正です (${error.message})`); }
  validateDeclaredFiles(config, (path) => files.has(`${root}${path}`), "ZIP");
  const parseJson = (path) => {
    if (!path) return null;
    try { return JSON.parse(text(path)); }
    catch (error) { throw new Error(`${path}: JSONが不正です (${error.message})`); }
  };
  const runtime = new Set(["character.json", ...runtimeFilePaths(config)]);
  const sourceFiles = [...files.entries()]
    .filter(([name]) => name.startsWith(root) && name.length > root.length && !name.endsWith("/"))
    .map(([name, data]) => ({ path: name.slice(root.length), data: new Uint8Array(data) }));
  return {
    id: config.id,
    label: config.label ?? config.id,
    config,
    expressions: parseJson(config.files.expressions),
    motions: parseJson(config.files.motions),
    poses: parseJson(config.files.poses),
    emotes: parseJson(config.files.emotes),
    svgText: text(config.files.svg),
    auxiliaryFiles: sourceFiles.filter(({ path }) => !runtime.has(path)),
    sourceFiles,
    updatedAt: Date.now(),
  };
}

export function losslessSourceFiles(pack) {
  if (!Array.isArray(pack.sourceFiles) || pack.sourceFiles.length === 0) return null;
  return pack.sourceFiles.map(({ path, data }) => ({ name: path, data: new Uint8Array(data) }));
}

export async function listStoredPacks() {
  const database = await openDatabase();
  return transactionResult(database, "readonly", (store) => store.getAll());
}

export async function loadStoredPack(id) {
  const database = await openDatabase();
  const record = await transactionResult(database, "readonly", (store) => store.get(id));
  if (!record) throw new Error(`端末内パック ${id} が見つかりません`);
  return loadCharacterPackData({ ...record, baseUrl: `indexeddb:${id}` });
}

export async function deleteStoredPack(id) {
  const database = await openDatabase();
  await transactionResult(database, "readwrite", (store) => store.delete(id));
}

function put(record) {
  return openDatabase().then((database) => transactionResult(database, "readwrite", (store) => store.put(record)));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

function leaf(path) {
  return path.split(/[\\/]/).at(-1);
}

function runtimeFilePaths(config) {
  return [config.files.svg, config.files.expressions, config.files.motions, config.files.poses, config.files.emotes].filter(Boolean);
}

function validateDeclaredFiles(config, exists, location) {
  for (const [key, path] of Object.entries(config.files)) {
    if (!exists(path)) throw new Error(`character.json: files.${key} "${path}" is declared but missing from ${location}`);
  }
}

function validateOptionalPsd(files, root, config, pack) {
  const path = config.files?.psd;
  if (!path) return;
  const inspected = inspectPsd(files.get(`${root}${path}`));
  if (inspected.width !== config.canvas.width || inspected.height !== config.canvas.height) {
    throw new Error(`${path}: Canvasサイズ ${inspected.width}x${inspected.height} が character.json と一致しません`);
  }
  const expected = new Set((config.psdLayers ?? []).map((layer) => layer.name));
  const missing = [...expected].filter((name) => !inspected.layerNames.includes(name));
  if (missing.length) throw new Error(`${path}: PSDレイヤーが不足しています: ${missing.join(", ")}`);
  const ids = new Set([...pack.svg.querySelectorAll("[id]")].map((node) => node.id));
  const inconsistent = inspected.layerNames.filter((name) => expected.has(name) && !ids.has(name));
  if (inconsistent.length) throw new Error(`${path}: SVG IDと一致しないPSDレイヤーがあります: ${inconsistent.join(", ")}`);
}
