import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const project = new URL("../", import.meta.url);

test("PWA manifest and icons are complete", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", project), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait-primary");
  for (const icon of manifest.icons) assert((await stat(new URL(icon.src, project))).size > 0);
});

test("service worker cache entries exist", async () => {
  const source = await readFile(new URL("sw.js", project), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("package.json", project), "utf8"));
  assert.match(source, new RegExp(`svg-character-studio-v${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(source, /caches\.keys\(\).*key !== CACHE/s);
  assert.match(source, /src\/engine\/realtime-preview\.js/);
  assert.match(source, /src\/engine\/gaze-input\.js/);
  assert(!source.includes(".js.js"));
  const paths = [...source.matchAll(/"(\.\/[^"`]+)"/g)].map((match) => match[1]);
  for (const path of paths) await stat(new URL(path, project));
});
