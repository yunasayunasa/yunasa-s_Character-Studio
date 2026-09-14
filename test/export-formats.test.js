import test from "node:test";
import assert from "node:assert/strict";
import { encodeGif } from "../src/export/gif-encoder.js";
import { inspectPsd } from "../src/engine/psd-inspector.js";
import { readZipBytes } from "../src/engine/zip-reader.js";
import { compositeVisibleLayers, writePsd } from "../src/export/psd-writer.js";
import { chooseTransparentCodec, encodeTimelineWebm } from "../src/export/webm-encoder.js";
import { createStoredZip } from "../src/export/zip-store.js";

const decoder = new TextDecoder();

test("stored ZIP has local, central and end records", () => {
  const zip = createStoredZip([{ name: "character.json", data: "{}\n" }, { name: "character.svg", data: "<svg/>" }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert(decoder.decode(zip).includes("character.json"));
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
});

test("stored character ZIP is readable and corrupt paths are rejected", async () => {
  const zip = createStoredZip([{ name: "sample/character.json", data: "{}\n" }, { name: "sample/character.svg", data: "<svg/>" }]);
  const files = await readZipBytes(zip);
  assert.equal(decoder.decode(files.get("sample/character.json")), "{}\n");
  await assert.rejects(() => readZipBytes(createStoredZip([{ name: "../bad.json", data: "{}" }])), /パスが不正/);
});

test("GIF encoder writes a transparent animated GIF89a stream", () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
  const gif = encodeGif([{ data: pixels }, { data: pixels }], 2, 1, 10);
  assert.equal(decoder.decode(gif.subarray(0, 6)), "GIF89a");
  assert.equal(gif.at(-1), 0x3b);
  assert(decoder.decode(gif).includes("NETSCAPE2.0"));
});

test("PSD writer emits version 1 RGB document with layers", () => {
  const pixels = new Uint8ClampedArray([40, 80, 120, 255]);
  const hiddenPixels = new Uint8ClampedArray([255, 0, 0, 255]);
  const layers = [{ name: "body", pixels, visible: true }, { name: "mouth_wide", pixels: hiddenPixels, visible: false }];
  const composite = compositeVisibleLayers(layers, 1, 1);
  const psd = writePsd(1, 1, layers, composite);
  const view = new DataView(psd.buffer);
  assert.equal(decoder.decode(psd.subarray(0, 4)), "8BPS");
  assert.equal(view.getUint16(4, false), 1);
  assert.equal(view.getUint16(12, false), 4);
  assert.equal(view.getUint32(14, false), 1);
  assert.equal(view.getUint32(18, false), 1);
  const inspected = inspectPsd(psd, { includeComposite: true });
  assert.deepEqual(inspected.layerNames, ["body", "mouth_wide"]);
  assert.deepEqual(inspected.layerVisibility, [
    { name: "body", visible: true },
    { name: "mouth_wide", visible: false },
  ]);
  assert.deepEqual(inspected.composite, pixels, "flattened composite must equal the visible-layer composition");
});

test("transparent WebM checks and configures WebCodecs with alpha keep", async () => {
  const originalEncoder = globalThis.VideoEncoder;
  const originalFrame = globalThis.VideoFrame;
  const checked = [];
  let configured;
  class EncoderMock {
    static async isConfigSupported(config) {
      checked.push(structuredClone(config));
      return { supported: true, config: structuredClone(config) };
    }
    constructor() { this.encodeQueueSize = 0; }
    configure(config) { configured = structuredClone(config); }
    encode() {}
    flush() { return Promise.resolve(); }
    close() {}
  }
  class FrameMock { close() {} }
  globalThis.VideoEncoder = EncoderMock;
  globalThis.VideoFrame = FrameMock;
  try {
    const result = await encodeTimelineWebm({ width: 2, height: 2, fps: 8, duration: 0.1, renderFrame: async () => ({}) });
    assert.equal(checked[0].alpha, "keep");
    assert.equal(checked[0].latencyMode, "quality");
    assert.equal(configured.alpha, "keep");
    assert.equal(configured.latencyMode, "quality");
    assert(findBytes(result.data, Uint8Array.of(0x53, 0xc0, 0x81, 0x01)), "WebM AlphaMode element is missing");
  } finally {
    globalThis.VideoEncoder = originalEncoder;
    globalThis.VideoFrame = originalFrame;
  }
});

test("transparent WebM rejects codecs that discard or ignore alpha", async () => {
  const originalEncoder = globalThis.VideoEncoder;
  globalThis.VideoEncoder = class {
    static async isConfigSupported(config) { return { supported: true, config: { ...config, alpha: "discard" } }; }
  };
  try {
    await assert.rejects(() => chooseTransparentCodec(320, 320, 8), /透過WebMに対応していません.*透過GIFまたはPNG/);
  } finally {
    globalThis.VideoEncoder = originalEncoder;
  }
});

function findBytes(haystack, needle) {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) if (haystack[index + offset] !== needle[offset]) continue outer;
    return true;
  }
  return false;
}
