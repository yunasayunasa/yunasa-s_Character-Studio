import { applyTimelineState, createTimelineState } from "../engine/timeline-state.js";
import { losslessSourceFiles } from "../engine/pack-store.js";
import { canvasToBlob, renderSvgToCanvas } from "./canvas-renderer.js";
import { GifStreamEncoder } from "./gif-encoder.js";
import { createLayeredPsd } from "./psd-writer.js";
import { encodeTimelineWebm } from "./webm-encoder.js";
import { createStoredZip } from "./zip-store.js";

export const QUALITY_PRESETS = {
  light: { label: "軽量", width: 320, fps: 8, colorQuality: "fast" },
  standard: { label: "標準", width: 512, fps: 12, colorQuality: "high" },
  high: { label: "高品質", width: 768, fps: 20, colorQuality: "high" },
};

export class ExportManager {
  constructor(engine, onProgress = () => {}, onDownload = () => {}) {
    this.engine = engine;
    this.onProgress = onProgress;
    this.onDownload = onDownload;
    this.settings = { quality: "standard", splitSeconds: 15, manualDuration: 2 };
    this.sources = { mode: "manual", audioEnvelope: null, cues: [] };
  }

  configure(settings = {}) { Object.assign(this.settings, settings); }
  setSources(sources = {}) { Object.assign(this.sources, sources); }

  describe() {
    const { pack } = this.engine.getExportState();
    const preset = this.preset();
    const duration = this.duration();
    const size = outputSize(pack.config, preset.width);
    const frames = Math.max(1, Math.ceil(duration * preset.fps));
    const workingBytes = size.width * size.height * 4 * 2;
    const estimatedBytes = Math.round(size.width * size.height * frames * (preset.colorQuality === "high" ? 0.11 : 0.075));
    return { preset, duration, size, frames, workingBytes, estimatedBytes, splitRecommended: duration > 30 || estimatedBytes > 180 * 1024 * 1024 };
  }

  async png() {
    const { pack, snapshot } = this.engine.getExportState();
    const svg = this.renderSvgAt(0, snapshot);
    const canvas = await renderSvgToCanvas(svg, outputSize(pack.config, 1024));
    this.onDownload(await canvasToBlob(canvas), `${pack.config.id}.png`);
    return "PNGの準備ができました。保存ボタンを押してください";
  }

  async gif() {
    const duration = this.duration();
    const segments = splitTimeline(duration, Number(this.settings.splitSeconds) || 0);
    if (segments.length === 1) {
      const blob = await this.gifSegment(segments[0], 0, 1);
      this.onDownload(blob, `${this.engine.pack.config.id}-${durationLabel(duration)}.gif`);
      return `${duration.toFixed(2)}秒の決定論的GIFを生成しました`;
    }
    const files = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const blob = await this.gifSegment(segment, index, segments.length);
      files.push({ name: `${this.engine.pack.config.id}-part-${String(index + 1).padStart(3, "0")}_${timeToken(segment.start)}-${timeToken(segment.end)}.gif`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    this.onDownload(new Blob([createStoredZip(files)], { type: "application/zip" }), `${this.engine.pack.config.id}-gif-parts.zip`);
    return `${duration.toFixed(2)}秒を${segments.length}分割したGIF ZIPを生成しました`;
  }

  async subtitleBatch() {
    if (!this.sources.cues?.length) throw new Error("SRT / VTTを先に読み込んでください");
    const files = [];
    for (let index = 0; index < this.sources.cues.length; index += 1) {
      const cue = this.sources.cues[index];
      const blob = await this.gifSegment({ start: cue.start, end: cue.end }, index, this.sources.cues.length, "subtitle");
      files.push({
        name: `subtitle-${String(index + 1).padStart(3, "0")}_${timeToken(cue.start)}-${timeToken(cue.end)}.gif`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    this.onDownload(new Blob([createStoredZip(files)], { type: "application/zip" }), `${this.engine.pack.config.id}-subtitle-gifs.zip`);
    return `字幕${files.length}区間を各区間長どおりのGIF ZIPへ書き出しました`;
  }

  async video() {
    const { pack, snapshot } = this.engine.getExportState();
    const preset = this.preset();
    const duration = this.duration();
    const size = outputSize(pack.config, preset.width);
    const svg = this.engine.createExportSvg();
    const result = await encodeTimelineWebm({
      ...size,
      fps: preset.fps,
      duration,
      onProgress: this.onProgress,
      renderFrame: async (time) => {
        applyTimelineState(svg, pack, createTimelineState(pack, snapshot, time, this.timelineSource()), { transition: false });
        return renderSvgToCanvas(svg, size);
      },
    });
    this.onDownload(new Blob([result.data], { type: result.mimeType }), `${pack.config.id}-${durationLabel(duration)}.webm`);
    return `${duration.toFixed(2)}秒のタイムラインをオフラインWebMへ書き出しました`;
  }

  async pack() {
    const { pack } = this.engine.getExportState();
    const files = createPackExportFiles(pack);
    this.onDownload(new Blob([createStoredZip(files)], { type: "application/zip" }), `${pack.config.id}-pack.zip`);
    return "schemaVersion 2の構造化キャラクターパックを生成しました";
  }

  async psd() {
    const { pack, snapshot } = this.engine.getExportState();
    const svg = this.engine.createExportSvg();
    applyTimelineState(svg, pack, createTimelineState(pack, snapshot, 0, this.timelineSource()), { transition: false });
    const data = await createLayeredPsd(svg, pack.config, { width: pack.config.canvas.width, onProgress: this.onProgress });
    this.onDownload(new Blob([data], { type: "image/vnd.adobe.photoshop" }), `${pack.config.id}.psd`);
    return "SVG IDと同名の明示レイヤーPSDを生成しました";
  }

  async gifSegment(segment, segmentIndex, segmentCount, forceMode = null) {
    const { pack, snapshot } = this.engine.getExportState();
    const preset = this.preset();
    const size = outputSize(pack.config, preset.width);
    const duration = segment.end - segment.start;
    const frameCount = Math.max(1, Math.ceil(duration * preset.fps));
    const delays = distributeGifDelays(duration, frameCount);
    const encoder = new GifStreamEncoder(size.width, size.height, delays[0], { colorQuality: preset.colorQuality });
    const svg = this.engine.createExportSvg();
    const timelineSource = { ...this.timelineSource(), mode: forceMode ?? this.sources.mode };
    for (let frame = 0; frame < frameCount; frame += 1) {
      const localTime = frame / preset.fps;
      const timelineTime = Math.min(segment.end, segment.start + localTime);
      const state = createTimelineState(pack, snapshot, timelineTime, timelineSource);
      applyTimelineState(svg, pack, state, { transition: false });
      const canvas = await renderSvgToCanvas(svg, size);
      const image = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, size.width, size.height);
      encoder.addFrame(image, delays[frame]);
      canvas.width = 1;
      canvas.height = 1;
      this.onProgress((segmentIndex + (frame + 1) / frameCount) / segmentCount);
    }
    return new Blob([encoder.finish()], { type: "image/gif" });
  }

  renderSvgAt(time, snapshot) {
    const { pack } = this.engine.getExportState();
    const svg = this.engine.createExportSvg();
    applyTimelineState(svg, pack, createTimelineState(pack, snapshot, time, this.timelineSource()));
    return svg;
  }

  timelineSource() { return { ...this.sources, manualLevel: this.engine.getExportState().previewLip.manualLevel }; }
  preset() { return QUALITY_PRESETS[this.settings.quality] ?? QUALITY_PRESETS.standard; }
  duration() {
    if (["audio", "combined"].includes(this.sources.mode) && this.sources.audioEnvelope?.duration) return this.sources.audioEnvelope.duration;
    if (this.sources.mode === "subtitle" && this.sources.cues?.length) return this.sources.cues.at(-1).end;
    return Math.max(0.1, Number(this.settings.manualDuration) || 2);
  }
}

export function createPackExportFiles(pack) {
  const preserved = losslessSourceFiles(pack);
  if (preserved) return preserved;
  const files = [
    { name: pack.config.files.svg, data: pack.svgSource },
    { name: "character.json", data: pretty(cleanCompatibility(pack.config)) },
    { name: pack.config.files.expressions, data: pretty(pack.expressions) },
    { name: pack.config.files.motions, data: pretty(pack.motions) },
  ];
  if (pack.poses && pack.config.files.poses) files.push({ name: pack.config.files.poses, data: pretty(pack.poses) });
  if (pack.emotes && pack.config.files.emotes) files.push({ name: pack.config.files.emotes, data: pretty(pack.emotes) });
  for (const auxiliary of pack.auxiliaryFiles ?? []) files.push({ name: auxiliary.path, data: auxiliary.data });
  if (!files.some((file) => file.name.startsWith("masters/"))) files.push({ name: "masters/README.txt", data: "大きな身体構造差のマスター素材を配置します。\n" });
  if (!files.some((file) => file.name.startsWith("shared_parts/"))) files.push({ name: "shared_parts/README.txt", data: "eyes / brows / mouths / effects / accessories の再利用パーツを配置します。\n" });
  return files;
}

export function splitTimeline(duration, splitSeconds) {
  if (!(splitSeconds > 0) || duration <= splitSeconds) return [{ start: 0, end: duration }];
  const result = [];
  for (let start = 0; start < duration; start += splitSeconds) result.push({ start, end: Math.min(duration, start + splitSeconds) });
  return result;
}

export function distributeGifDelays(duration, frameCount) {
  const total = Math.max(frameCount, Math.round(duration * 100));
  const base = Math.floor(total / frameCount);
  const remainder = total - base * frameCount;
  return Array.from({ length: frameCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function outputSize(config, width) { return { width, height: Math.round(width * config.canvas.height / config.canvas.width) }; }
function timeToken(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}-${String(Math.floor(seconds % 60)).padStart(2, "0")}-${String(Math.round((seconds % 1) * 1000)).padStart(3, "0")}`; }
function durationLabel(seconds) { return `${seconds.toFixed(2).replace(".", "-")}s`; }
function pretty(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function cleanCompatibility(config) { const copy = structuredClone(config); delete copy.compatibility; return copy; }
