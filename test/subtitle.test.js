import test from "node:test";
import assert from "node:assert/strict";
import { parseSubtitles } from "../src/engine/subtitle-lip-sync.js";

test("SRT and WebVTT cues are parsed and sorted", () => {
  const source = `WEBVTT

2
00:00:02.500 --> 00:00:04.000
二つ目！

1
00:00:00,200 --> 00:00:01,400
<b>最初</b>です。`;
  assert.deepEqual(parseSubtitles(source), [
    { start: 0.2, end: 1.4, text: "最初です。" },
    { start: 2.5, end: 4, text: "二つ目！" },
  ]);
});

test("invalid subtitle blocks are ignored", () => {
  assert.deepEqual(parseSubtitles("WEBVTT\n\nnot a cue"), []);
});
