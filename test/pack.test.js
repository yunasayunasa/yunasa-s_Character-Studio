import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { isEmbeddedRaster } from "../src/engine/character-loader.js";
import {
  assertCharacterConfig,
  assertEmotes,
  assertExpressions,
  assertMotions,
  assertPoses,
  normalizePackData,
} from "../src/engine/pack-schema.js";

const project = new URL("../", import.meta.url);
const charactersRoot = new URL("../public/characters/", import.meta.url);

test("manifest references every character pack", async () => {
  const manifest = await json(new URL("index.json", charactersRoot));
  const folders = (await readdir(charactersRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const referenced = manifest.characters.map((entry) => entry.path.split("/").filter(Boolean).at(-1)).sort();
  assert.deepEqual(referenced, folders);
});

test("all packs have valid JSON and required SVG ids", async () => {
  const manifest = await json(new URL("index.json", charactersRoot));
  for (const item of manifest.characters) {
    const folder = new URL(item.path.replace("./public/characters/", ""), charactersRoot);
    const config = assertCharacterConfig(await json(new URL("character.json", folder)));
    for (const [key, path] of Object.entries(config.files)) {
      await assert.doesNotReject(() => readFile(new URL(path, folder)), `${config.id}: files.${key} is declared but missing`);
    }
    assertExpressions(await json(new URL(config.files.expressions, folder)), config);
    assertMotions(await json(new URL(config.files.motions, folder)));
    if (config.files.poses) assertPoses(await json(new URL(config.files.poses, folder)), config);
    if (config.files.emotes) assertEmotes(await json(new URL(config.files.emotes, folder)), config);
    const svg = await readFile(new URL(config.files.svg, folder), "utf8");
    const foundIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const ids = new Set(foundIds);
    assert.equal(ids.size, foundIds.length, `${config.id}: duplicate SVG ids found`);
    for (const id of [...config.requiredParts, ...config.effectParts, ...Object.values(config.partSlots).flat()]) {
      assert(ids.has(id), `${config.id}: SVG ID ${id} is missing`);
    }
    for (const layer of config.psdLayers) {
      assert.equal(layer.name, layer.partId, `${config.id}: PSD/SVG/JSON part ID must match`);
      assert.match(svg, new RegExp(`data-export-part="${layer.partId}"`));
      assert(ids.has(layer.partId), `${config.id}: PSD part ${layer.partId} has no SVG ID`);
    }
    if (config.id === "pilot-standing") assert.equal(config.psdLayers.length, 34, "pilot PSD must retain all 34 editable part layers");
    for (const idsInSlot of Object.values(config.assetModel.sharedParts)) for (const id of idsInSlot) assert(ids.has(id), `${config.id}: shared part ${id} is missing`);
    assert(!/<(?:script|foreignObject|style)\b/i.test(svg), `${config.id}: unsafe element found`);
    for (const tag of svg.matchAll(/<([\w:]+)\b([^>]*)>/g)) {
      for (const reference of tag[2].matchAll(/\b(?:href|xlink:href)="([^"]*)"/g)) {
        assert(reference[1].startsWith("#") || isEmbeddedRaster(tag[1], reference[1]), `${config.id}: unsafe SVG reference on ${tag[1]}`);
      }
    }
  }
});

test("entry page wires the mobile viewport and common engine", async () => {
  const html = await readFile(new URL("index.html", project), "utf8");
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /src\/main\.js/);
  assert.match(html, /audio\/\*,\.m4a/);
  assert.match(html, /manifest\.webmanifest/);
  for (const type of ["png", "gif", "video", "subtitleBatch", "pack", "psd"]) assert.match(html, new RegExp(`data-export="${type}"`));
  assert.match(html, /id="pack-files"/);
});

test("schemaVersion 1 packs migrate to generic tracks without changing app code", () => {
  const migrated = normalizePackData({
    config: { schemaVersion: 1, id: "legacy", files: {}, requiredParts: ["body"], partSlots: { mouth: ["mouth_closed"] } },
    expressions: { schemaVersion: 1, default: "neutral", expressions: { neutral: { parts: { mouth: "mouth_closed" } } } },
    motions: { schemaVersion: 1, default: "idle", motions: { idle: { breathing: { target: "body", period: 4, y: 2 } } } },
    poses: null,
    emotes: null,
  });
  assert.equal(migrated.config.schemaVersion, 2);
  assert.equal(migrated.config.assetModel.defaultMaster, "normal");
  assert.deepEqual(migrated.motions.motions.idle.tracks.map((track) => track.property), ["translateY"]);
});

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
