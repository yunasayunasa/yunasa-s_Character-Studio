import { RealtimePreviewRenderer } from "./realtime-preview.js";

export class CharacterEngine {
  constructor(host) {
    this.host = host;
    this.pack = null;
    this.svg = null;
    this.preview = null;
    this.running = true;
    this.startedAt = performance.now();
    this.frame = null;
    this.lastPreviewFrame = 0;
    this.mobilePreview = matchMedia("(pointer: coarse), (hover: none)");
    this.previewInterval = 1000 / (this.mobilePreview.matches ? 30 : 60);
    this.gazeTarget = { x: 0, y: 0 };
    this.previewMetrics = { fps: 0, frameMs: 0, domUpdates: 0, targetFps: Math.round(1000 / this.previewInterval) };
    this.metricWindow = { startedAt: performance.now(), frames: 0, processingMs: 0, updates: 0 };
    this.onPreviewMetrics = null;
    this.snapshot = {
      expression: null,
      pose: null,
      motion: null,
      master: null,
      emoteVisible: [],
      gaze: { x: 0, y: 0 },
      reducedMotion: false,
    };
    this.lip = { mode: "manual", manualLevel: 0, audioLevel: 0, subtitleLevel: 0 };
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.tick = this.tick.bind(this);
  }

  mount(pack) {
    this.destroyCharacter();
    this.pack = pack;
    this.svg = document.importNode(pack.svg, true);
    this.host.replaceChildren(this.svg);
    this.preview = new RealtimePreviewRenderer(this.svg, pack);
    this.snapshot.expression = pack.expressions.default;
    this.snapshot.pose = pack.poses?.default ?? null;
    this.snapshot.motion = pack.motions.default;
    this.snapshot.master = pack.config.assetModel.defaultMaster;
    this.snapshot.emoteVisible = [];
    this.snapshot.gaze.x = 0;
    this.snapshot.gaze.y = 0;
    this.gazeTarget.x = 0;
    this.gazeTarget.y = 0;
    this.previewInterval = 1000 / (this.mobilePreview.matches ? 30 : 60);
    this.previewMetrics.targetFps = Math.round(1000 / this.previewInterval);
    this.lastPreviewFrame = 0;
    this.startedAt = performance.now();
    this.metricWindow.startedAt = this.startedAt;
    this.metricWindow.frames = 0;
    this.metricWindow.processingMs = 0;
    this.metricWindow.updates = 0;
    this.renderAt(0, true);
    this.frame = requestAnimationFrame(this.tick);
  }

  setExpression(name) {
    if (!this.pack?.expressions.expressions[name]) return;
    this.snapshot.expression = name;
    this.renderAt(this.elapsed(), true);
  }

  setPose(name) {
    if (!this.pack?.poses?.poses[name]) return;
    this.snapshot.pose = name;
    this.snapshot.master = this.pack.poses.poses[name].master ?? this.snapshot.master;
    this.renderAt(this.elapsed(), true);
  }

  setEmote(name) {
    const emote = this.pack?.emotes?.emotes[name];
    if (!emote) return;
    this.snapshot.emoteVisible = [...(emote.visible ?? [])];
    this.renderAt(this.elapsed(), true);
  }

  setManualMouth(value) { this.lip.manualLevel = clamp(Number(value) || 0, 0, 1); }
  setAudioLevel(value) { this.lip.audioLevel = clamp(Number(value) || 0, 0, 1); }
  setSubtitleLevel(value) { this.lip.subtitleLevel = clamp(Number(value) || 0, 0, 1); }
  setLipMode(mode) { this.lip.mode = ["audio", "subtitle", "combined"].includes(mode) ? mode : "manual"; this.lip.audioLevel = 0; this.lip.subtitleLevel = 0; }
  setGaze(x, y) { this.gazeTarget.x = clamp(x, -1, 1); this.gazeTarget.y = clamp(y, -1, 1); }

  setRunning(running) {
    this.running = Boolean(running);
    if (!this.running) this.renderAt(0);
    else this.startedAt = performance.now();
  }

  tick(timestamp) {
    if (!this.svg) return;
    if (this.running && !document.hidden && (!this.lastPreviewFrame || timestamp - this.lastPreviewFrame >= this.previewInterval)) {
      this.lastPreviewFrame = timestamp;
      this.smoothGaze();
      this.renderAt(this.elapsed());
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  renderAt(time, staticChanged = false) {
    if (!this.pack || !this.svg || !this.preview) return;
    this.snapshot.reducedMotion = this.reducedMotion.matches;
    const level = this.lip.mode === "manual"
      ? this.lip.manualLevel
      : this.lip.mode === "audio"
        ? this.lip.audioLevel
        : this.lip.mode === "subtitle"
          ? this.lip.subtitleLevel
          : Math.max(this.lip.audioLevel, this.lip.subtitleLevel * 0.7);
    if (staticChanged) this.preview.prepareStatic(this.snapshot);
    const result = this.preview.render(this.snapshot, time, { level });
    this.recordMetrics(result);
  }

  smoothGaze() {
    const amount = this.snapshot.reducedMotion ? 1 : 0.24;
    this.snapshot.gaze.x = approach(this.snapshot.gaze.x, this.gazeTarget.x, amount);
    this.snapshot.gaze.y = approach(this.snapshot.gaze.y, this.gazeTarget.y, amount);
  }

  recordMetrics(result) {
    const now = performance.now();
    this.metricWindow.frames += 1;
    this.metricWindow.processingMs += result.processingMs;
    this.metricWindow.updates += result.updates;
    const duration = now - this.metricWindow.startedAt;
    if (duration < 1000) return;
    this.previewMetrics.fps = this.metricWindow.frames * 1000 / duration;
    this.previewMetrics.frameMs = this.metricWindow.processingMs / this.metricWindow.frames;
    this.previewMetrics.domUpdates = this.metricWindow.updates / this.metricWindow.frames;
    this.onPreviewMetrics?.(this.previewMetrics);
    this.metricWindow.startedAt = now;
    this.metricWindow.frames = 0;
    this.metricWindow.processingMs = 0;
    this.metricWindow.updates = 0;
  }

  elapsed() { return Math.max(0, (performance.now() - this.startedAt) / 1000); }

  getExportState() {
    if (!this.pack || !this.svg) throw new Error("キャラクターが読み込まれていません");
    return {
      pack: this.pack,
      svg: this.svg,
      snapshot: structuredClone(this.snapshot),
      previewLip: { ...this.lip },
    };
  }

  createExportSvg() {
    if (!this.pack) throw new Error("キャラクターが読み込まれていません");
    return document.importNode(this.pack.svg, true);
  }

  destroyCharacter() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.preview = null;
    this.host.replaceChildren();
  }
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function approach(current, target, amount) {
  const next = current + (target - current) * amount;
  return Math.abs(target - next) < 0.001 ? target : next;
}
