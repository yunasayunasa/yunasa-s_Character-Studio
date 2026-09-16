import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyTouchGaze, normalizeGazePoint } from "../src/engine/gaze-input.js";
import { RealtimePreviewRenderer, buildPreviewDomCache } from "../src/engine/realtime-preview.js";

const project = new URL("../", import.meta.url);

test("preview DOM cache resolves SVG ids once at mount", () => {
  const fixture = previewFixture();
  const cache = buildPreviewDomCache(fixture.svg, fixture.pack);
  assert.equal(fixture.svg.queries, 1);
  assert.equal(cache.byId.get("eye_open"), fixture.nodes.get("eye_open"));
  assert.equal(cache.transforms[0][0], "iris");
});

test("reapplying the same realtime state performs no DOM writes", () => {
  const fixture = previewFixture();
  const renderer = new RealtimePreviewRenderer(fixture.svg, fixture.pack);
  const snapshot = previewSnapshot();
  renderer.prepareStatic(snapshot);
  const first = renderer.render(snapshot, 0, { level: 0 });
  const writesAfterFirst = totalWrites(fixture.nodes);
  const second = renderer.render(snapshot, 0, { level: 0 });
  assert(first.updates > 0);
  assert.equal(second.updates, 0);
  assert.equal(totalWrites(fixture.nodes), writesAfterFirst);
  assert.equal(fixture.svg.queries, 1);
});

test("static expression changes update only affected parts", () => {
  const fixture = previewFixture();
  const renderer = new RealtimePreviewRenderer(fixture.svg, fixture.pack);
  const snapshot = previewSnapshot();
  renderer.prepareStatic(snapshot);
  renderer.render(snapshot, 0, { level: 0 });
  const masterWrites = fixture.nodes.get("master_normal").writes;
  const irisWrites = fixture.nodes.get("iris").writes;

  snapshot.expression = "happy";
  renderer.prepareStatic(snapshot);
  const changed = renderer.render(snapshot, 0, { level: 0 });

  assert.equal(changed.updates, 5);
  assert.equal(fixture.nodes.get("master_normal").writes, masterWrites);
  assert.equal(fixture.nodes.get("iris").writes, irisWrites);
  assert.equal(fixture.nodes.get("eye_open").style.display, "none");
  assert.equal(fixture.nodes.get("eye_closed").style.display, "");
  assert.equal(fixture.nodes.get("blush").style.display, "");
});

test("touch gaze distinguishes tap, intentional horizontal drag, and scroll", () => {
  assert.deepEqual(normalizeGazePoint({ left: 100, top: 200, width: 200, height: 100 }, 250, 225), { x: 0.5, y: -0.5 });
  assert.equal(classifyTouchGaze(10, 10, 16, 14), "tap");
  assert.equal(classifyTouchGaze(10, 10, 45, 16), "drag");
  assert.equal(classifyTouchGaze(10, 10, 14, 45), "scroll");
});

test("main character add button reuses the existing pack import input", async () => {
  const html = await readFile(new URL("index.html", project), "utf8");
  const main = await readFile(new URL("src/main.js", project), "utf8");
  const css = await readFile(new URL("styles.css", project), "utf8");
  assert.match(html, /for="pack-files"[^>]*>＋ キャラクターを追加/);
  assert.equal((html.match(/id="pack-files"/g) ?? []).length, 1);
  assert.match(main, /elements\.packFiles\.addEventListener\("change"/);
  assert.match(main, /importPackZip\(single, \{ confirmUpdate: confirmPackUpdate \}\)/);
  assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
  assert.doesNotMatch(css, /(?:html|body|\.app-shell)\s*\{[^}]*touch-action:\s*none/s);
});

function previewFixture() {
  const ids = ["master_normal", "eye_open", "eye_closed", "mouth_closed", "mouth_open", "blush", "iris"];
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id)]));
  const svg = {
    queries: 0,
    querySelectorAll(selector) {
      assert.equal(selector, "[id]");
      this.queries += 1;
      return [...nodes.values()];
    },
  };
  const pack = {
    config: {
      id: "preview-fixture",
      assetModel: { defaultMaster: "normal", masters: { normal: { root: "master_normal" } }, masterOverrides: {} },
      partSlots: { eyes: ["eye_open", "eye_closed"], mouth: ["mouth_closed", "mouth_open"] },
      effectParts: ["blush"],
      controllers: {
        blink: { closedParts: { eyes: "eye_closed" }, intervalMs: [1000, 1000], durationMs: 100 },
        lipSync: { slot: "mouth", parts: ["mouth_closed", "mouth_open"], thresholds: [0.1, 0.3, 0.6] },
        gaze: { targets: ["iris"], maxX: 4, maxY: 3 },
      },
    },
    expressions: {
      default: "neutral",
      expressions: {
        neutral: { parts: { eyes: "eye_open", mouth: "mouth_closed" }, visible: [] },
        happy: { parts: { eyes: "eye_closed", mouth: "mouth_open" }, visible: ["blush"] },
      },
    },
    poses: { default: "normal", poses: { normal: { master: "normal" } } },
    motions: { default: "idle", motions: { idle: { tracks: [] } } },
    motionTargets: [],
    poseTargets: [],
  };
  return { nodes, pack, svg };
}

function previewSnapshot() {
  return { expression: "neutral", pose: "normal", motion: "idle", gaze: { x: 0, y: 0 }, emoteVisible: [], reducedMotion: true };
}

function totalWrites(nodes) {
  return [...nodes.values()].reduce((total, node) => total + node.writes, 0);
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.style = {};
    this.attributes = new Map();
    this.writes = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
    this.writes += 1;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    this.writes += 1;
  }
}
