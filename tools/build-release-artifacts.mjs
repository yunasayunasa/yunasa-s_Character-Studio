import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPsd, setPsdLayerVisibility } from "../src/engine/psd-inspector.js";
import { createStoredZip } from "../src/export/zip-store.js";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(project, "..");
const characterFolder = join(project, "public", "characters", "pilot-standing");
const psdPath = join(output, "pilot-standing-structured.psd");
const config = await json(join(characterFolder, "character.json"));
const expressions = await json(join(characterFolder, config.files.expressions));
const poses = config.files.poses ? await json(join(characterFolder, config.files.poses)) : null;
const emotes = config.files.emotes ? await json(join(characterFolder, config.files.emotes)) : null;

const expression = expressions.expressions[expressions.default];
const pose = poses?.poses?.[poses.default] ?? {};
const emote = emotes?.emotes?.[emotes.default] ?? {};
const master = pose.master ?? config.assetModel.defaultMaster;
const controlled = new Set([
  ...Object.values(config.assetModel.masters).map((item) => item.root),
  ...Object.values(config.partSlots).flat(),
  ...(config.effectParts ?? []),
]);
const visible = new Set([
  config.assetModel.masters[master].root,
  ...Object.values(expression.parts ?? {}),
  ...Object.values(pose.parts ?? {}),
  ...(expression.visible ?? []),
  ...(emote.visible ?? []),
  ...(config.psdLayers ?? []).map((layer) => layer.partId ?? layer.source).filter((id) => !controlled.has(id)),
]);

const psd = setPsdLayerVisibility(await readFile(psdPath), visible);
await writeFile(psdPath, psd);
const inspected = inspectPsd(psd);
const actualVisible = inspected.layerVisibility.filter((item) => item.visible).map((item) => item.name);
if (inspected.layerNames.length !== config.psdLayers.length) throw new Error("PSD layer count changed");
if (actualVisible.length !== visible.size || actualVisible.some((name) => !visible.has(name))) throw new Error("PSD visibility does not match the default character state");

const packPaths = [
  "character.json", config.files.svg, config.files.expressions, config.files.motions,
  config.files.poses, config.files.emotes, "pilot-source.svg",
].filter(Boolean);
const files = await Promise.all(packPaths.map(async (path) => ({ name: path, data: await readFile(join(characterFolder, path)) })));
files.push(
  { name: "masters/README.txt", data: "大きな身体構造差の制作元を配置します。\n" },
  { name: "shared_parts/README.txt", data: "再利用可能な目・眉・口・effect等を配置します。\n" },
);
await writeFile(join(output, "pilot-standing-character-pack.zip"), createStoredZip(files));

console.log(JSON.stringify({
  psd: basename(psdPath),
  psdBytes: psd.length,
  layers: inspected.layerNames.length,
  visibleLayers: actualVisible,
  pack: "pilot-standing-character-pack.zip",
  packFiles: files.map((file) => file.name),
}, null, 2));

async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
