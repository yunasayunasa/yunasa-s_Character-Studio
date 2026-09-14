import test from "node:test";
import assert from "node:assert/strict";
import { createPackExportFiles } from "../src/export/export-manager.js";
import { assertSvgReferences, normalizePackData } from "../src/engine/pack-schema.js";
import { decodePackEntries } from "../src/engine/pack-store.js";
import { findPackRoot, readZipBytes } from "../src/engine/zip-reader.js";
import { createStoredZip } from "../src/export/zip-store.js";
import { writePsd } from "../src/export/psd-writer.js";

const encoder = new TextEncoder();

test("pack ZIP survives import, IndexedDB structured clone, export and re-import losslessly", async () => {
  const original = fixtureFiles({ psd: true, thumbnail: true });
  original.push(
    { name: "sample/masters/normal/source.dat", data: Uint8Array.of(1, 2, 3) },
    { name: "sample/shared_parts/eyes/open.svg", data: "<svg id=\"source\"/>" },
    { name: "sample/source/license.txt", data: "keep me exactly\n" },
  );
  const importedFiles = await readZipBytes(createStoredZip(original));
  const record = decodePackEntries(importedFiles, findPackRoot(importedFiles));
  const storedRecord = structuredClone(record);
  const exportedFiles = createPackExportFiles(storedRecord);
  const reloadedFiles = await readZipBytes(createStoredZip(exportedFiles));
  const reloadedRecord = decodePackEntries(reloadedFiles, findPackRoot(reloadedFiles));

  const expected = new Map(original.map(({ name, data }) => [name.replace(/^sample\//, ""), bytes(data)]));
  const actual = new Map([...reloadedFiles].map(([name, data]) => [name, data]));
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [path, data] of expected) assert.deepEqual(actual.get(path), data, `${path} changed during round-trip`);
  assert(reloadedRecord.sourceFiles.some(({ path }) => path === "character.psd"));
  assert(reloadedRecord.sourceFiles.some(({ path }) => path === "thumbnail.webp"));
  assert(reloadedRecord.sourceFiles.some(({ path }) => path.startsWith("masters/")));
  assert(reloadedRecord.sourceFiles.some(({ path }) => path.startsWith("shared_parts/")));
});

test("every files declaration is required while omitted optional files remain valid", async () => {
  const missingPsd = await readZipBytes(createStoredZip(fixtureFiles({ psd: true, omitPsdBytes: true })));
  assert.throws(() => decodePackEntries(missingPsd, findPackRoot(missingPsd)), /files\.psd.*character\.psd.*missing/);

  const missingThumbnail = await readZipBytes(createStoredZip(fixtureFiles({ thumbnail: true, omitThumbnailBytes: true })));
  assert.throws(() => decodePackEntries(missingThumbnail, findPackRoot(missingThumbnail)), /files\.thumbnail.*thumbnail\.webp.*missing/);

  const optionalOmitted = await readZipBytes(createStoredZip(fixtureFiles({})));
  assert.doesNotThrow(() => decodePackEntries(optionalOmitted, findPackRoot(optionalOmitted)));
});

test("validator reports precise JSON paths for SVG ID typos", () => {
  const base = referenceFixture();
  const cases = [
    ["motion_typo", (data) => { data.motions.motions.idle.tracks[0].target = "hair_side_lef"; }, /motions\.json: motions\.idle\.tracks\[0\]\.target "hair_side_lef" does not exist/],
    ["pose_typo", (data) => { data.poses.poses.normal.transform.target = "pose_roo"; }, /poses\.json: poses\.normal\.transform\.target "pose_roo" does not exist/],
    ["expression_typo", (data) => { data.expressions.expressions.neutral.visible = ["blus"]; }, /expressions\.json: expressions\.neutral\.visible\[0\] "blus" does not exist/],
    ["blink_typo", (data) => { data.config.controllers.blink.closedParts.eye = "eye_close"; }, /controllers\.blink\.closedParts\.eye "eye_close" does not exist/],
    ["lip_typo", (data) => { data.config.controllers.lipSync.parts[1] = "mouth_wid"; }, /controllers\.lipSync\.parts\[1\] "mouth_wid" does not exist/],
    ["gaze_typo", (data) => { data.config.controllers.gaze.targets[0] = "iri"; }, /controllers\.gaze\.targets\[0\] "iri" does not exist/],
    ["master_typo", (data) => { data.config.assetModel.masters.normal.root = "master_norml"; }, /assetModel\.masters\.normal\.root "master_norml" does not exist/],
    ["override_typo", (data) => { data.config.assetModel.masterOverrides.normal.parts.mouth_closed = "mouth_overrid"; }, /masterOverrides\.normal\.parts\.mouth_closed "mouth_overrid" does not exist/],
    ["psd_typo", (data) => { data.config.psdLayers[0].partId = "bod"; }, /psdLayers\[0\]\.partId "bod" does not exist/],
  ];
  for (const [name, mutate, expected] of cases) {
    const data = structuredClone(base);
    mutate(data);
    assert.throws(() => validateReferences(data), expected, name);
  }
});

test("schemaVersion 1 migration is subjected to the same SVG reference validation", () => {
  const data = referenceFixture();
  data.config.schemaVersion = 1;
  delete data.config.assetModel;
  data.expressions.schemaVersion = 1;
  data.motions = { schemaVersion: 1, default: "idle", motions: { idle: { sway: { target: "missing_after_migration", period: 2, x: 1 } } } };
  const migrated = normalizePackData(data);
  assert.throws(() => validateReferences(migrated), /motions\.json: motions\.idle\.tracks\[0\]\.target "missing_after_migration" does not exist/);
});

function validateReferences(data) {
  return assertSvgReferences(new Set(data.ids), data.config, data.expressions, data.motions, data.poses, data.emotes);
}

function referenceFixture() {
  const ids = ["body", "master_normal", "eye_open", "eye_closed", "mouth_closed", "mouth_wide", "iris", "pose_root", "blush"];
  return {
    ids,
    config: {
      schemaVersion: 2,
      id: "sample",
      files: { svg: "character.svg", expressions: "expressions.json", motions: "motions.json" },
      canvas: { width: 1, height: 1 },
      requiredParts: ["body"], optionalParts: [], effectParts: ["blush"],
      partSlots: { eye: ["eye_open", "eye_closed"], mouth: ["mouth_closed", "mouth_wide"] },
      assetModel: {
        defaultMaster: "normal",
        masters: { normal: { root: "master_normal" } },
        sharedParts: { eye: ["eye_open", "eye_closed"], mouth: ["mouth_closed", "mouth_wide"], effects: ["blush"] },
        masterOverrides: { normal: { parts: { mouth_closed: "mouth_wide" } } },
      },
      controllers: {
        blink: { closedParts: { eye: "eye_closed" } },
        lipSync: { slot: "mouth", parts: ["mouth_closed", "mouth_wide"] },
        gaze: { targets: ["iris"] },
      },
      psdLayers: [{ name: "body", partId: "body" }],
    },
    expressions: { schemaVersion: 2, default: "neutral", expressions: { neutral: { parts: { eye: "eye_open", mouth: "mouth_closed" }, visible: [] } } },
    motions: { schemaVersion: 2, default: "idle", motions: { idle: { tracks: [{ target: "body", property: "translateY", amplitude: 1, period: 2 }] } } },
    poses: { schemaVersion: 2, default: "normal", poses: { normal: { master: "normal", parts: {}, transform: { target: "pose_root" } } } },
    emotes: { schemaVersion: 2, default: "none", emotes: { none: { visible: [] } } },
  };
}

function fixtureFiles({ psd = false, thumbnail = false, omitPsdBytes = false, omitThumbnailBytes = false }) {
  const config = referenceFixture().config;
  config.files = {
    svg: "character.svg", expressions: "expressions.json", motions: "motions.json", poses: "poses.json", emotes: "emotes.json",
    ...(psd ? { psd: "character.psd" } : {}),
    ...(thumbnail ? { thumbnail: "thumbnail.webp" } : {}),
  };
  const fixture = referenceFixture();
  const files = [
    { name: "sample/character.json", data: `${JSON.stringify(config)}\n` },
    { name: "sample/character.svg", data: `<svg>${fixture.ids.map((id) => `<g id="${id}"/>`).join("")}</svg>` },
    { name: "sample/expressions.json", data: JSON.stringify(fixture.expressions) },
    { name: "sample/motions.json", data: JSON.stringify(fixture.motions) },
    { name: "sample/poses.json", data: JSON.stringify(fixture.poses) },
    { name: "sample/emotes.json", data: JSON.stringify(fixture.emotes) },
  ];
  if (psd && !omitPsdBytes) {
    const pixel = new Uint8ClampedArray([1, 2, 3, 255]);
    files.push({ name: "sample/character.psd", data: writePsd(1, 1, [{ name: "body", pixels: pixel, visible: true }], pixel) });
  }
  if (thumbnail && !omitThumbnailBytes) files.push({ name: "sample/thumbnail.webp", data: Uint8Array.of(0x52, 0x49, 0x46, 0x46) });
  return files;
}

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
}
