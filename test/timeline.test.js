import test from "node:test";
import assert from "node:assert/strict";
import { createTimelineState, envelopeLevelAt } from "../src/engine/timeline-state.js";
import { distributeGifDelays, splitTimeline } from "../src/export/export-manager.js";
import { GifStreamEncoder } from "../src/export/gif-encoder.js";

const pack = {
  config: {
    id: "test-character",
    assetModel: {
      defaultMaster: "normal",
      masters: { normal: { root: "master_normal" }, point: { root: "master_point" } },
      masterOverrides: { point: { parts: { mouth_smile: "mouth_smile_point" } } },
    },
    partSlots: { eyes: ["eyes_open", "eyes_closed"], mouth: ["mouth_closed", "mouth_smile", "mouth_smile_point", "mouth_wide"], pose: ["pose_normal", "pose_point"] },
    effectParts: ["blush"],
    controllers: {
      blink: { closedParts: { eyes: "eyes_closed" }, intervalMs: [1000, 1000], durationMs: 100 },
      lipSync: { slot: "mouth", parts: ["mouth_closed", "mouth_closed", "mouth_smile", "mouth_wide"], thresholds: [0.1, 0.3, 0.6], noiseFloor: 0.02 },
      gaze: { targets: ["eyes_open"], maxX: 4, maxY: 3 },
    },
  },
  expressions: { default: "happy", expressions: { happy: { parts: { eyes: "eyes_open", mouth: "mouth_smile" }, visible: ["blush"] } } },
  poses: { default: "normal", poses: {
    normal: { master: "normal", parts: { pose: "pose_normal" } },
    point: { master: "point", parts: { pose: "pose_point" }, transform: { target: "root", x: 5, origin: { x: 10, y: 20 } } },
  } },
  motions: { default: "idle", motions: { idle: { tracks: [{ target: "root", property: "translateX", wave: "sin", amplitude: 2, period: 1, phase: 0 }] } } },
  motionTargets: ["root"],
  poseTargets: ["root"],
};

test("same input and t always produce the same frame state", () => {
  const snapshot = { expression: "happy", pose: "point", motion: "idle", gaze: { x: 0.5, y: -0.5 }, emoteVisible: [] };
  assert.deepEqual(createTimelineState(pack, snapshot, 12.345), createTimelineState(pack, snapshot, 12.345));
});

test("pose and motion transforms are composed, while master keeps expression and applies override", () => {
  const state = createTimelineState(pack, { expression: "happy", pose: "point", gaze: { x: 0, y: 0 }, emoteVisible: [] }, 0.25);
  assert.equal(state.master, "point");
  assert.equal(state.parts.eyes, "eyes_open");
  assert.equal(state.parts.mouth, "mouth_smile_point");
  assert.match(state.transforms.root, /translate\(7\.0000 0\.0000\)/);
});

test("offline renderer state contract remains exact after the preview backend change", () => {
  const state = createTimelineState(pack, { expression: "happy", pose: "point", gaze: { x: 0.5, y: -0.5 }, emoteVisible: [] }, 0.25, { level: 0.8 });
  assert.deepEqual({
    time: state.time,
    expression: state.expression,
    pose: state.pose,
    master: state.master,
    parts: state.parts,
    effects: state.effects,
    lipLevel: state.lipLevel,
  }, {
    time: 0.25,
    expression: "happy",
    pose: "point",
    master: "point",
    parts: { eyes: "eyes_open", mouth: "mouth_wide", pose: "pose_point" },
    effects: ["blush"],
    lipLevel: 0.8,
  });
  assert.match(state.transforms.root, /translate\(7\.0000 0\.0000\)/);
  assert.match(state.transforms.eyes_open, /translate\(2\.0000 -1\.5000\)/);
});

test("audio envelope interpolation and audio duration segmentation are exact", () => {
  const envelope = { sampleRate: 2, levels: Float32Array.from([0, 1, 0]), duration: 1.5 };
  assert.equal(envelopeLevelAt(envelope, 0.25), 0.5);
  assert.deepEqual(splitTimeline(12.4, 5), [{ start: 0, end: 5 }, { start: 5, end: 10 }, { start: 10, end: 12.4 }]);
  assert.equal(distributeGifDelays(12.4, Math.ceil(12.4 * 12)).reduce((sum, value) => sum + value, 0), 1240);
  assert.equal(distributeGifDelays(2.5, Math.ceil(2.5 * 12)).reduce((sum, value) => sum + value, 0), 250);
  assert.equal(distributeGifDelays(1.2, Math.ceil(1.2 * 12)).reduce((sum, value) => sum + value, 0), 120);
});

test("streaming GIF retains compressed output, not RGBA frame history", () => {
  const encoder = new GifStreamEncoder(1, 1, 10);
  const frame = { width: 1, height: 1, data: Uint8ClampedArray.from([20, 40, 60, 255]) };
  for (let index = 0; index < 100; index += 1) encoder.addFrame(frame);
  assert.equal(encoder.frameCount, 100);
  assert.equal("frames" in encoder, false);
  assert.equal(encoder.finish().at(-1), 0x3b);
});
