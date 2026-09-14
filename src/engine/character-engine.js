import { applyTimelineState, createTimelineState } from "./timeline-state.js";

export class CharacterEngine {
  constructor(host) {
    this.host = host;
    this.pack = null;
    this.svg = null;
    this.running = true;
    this.startedAt = performance.now();
    this.frame = null;
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
    this.snapshot.expression = pack.expressions.default;
    this.snapshot.pose = pack.poses?.default ?? null;
    this.snapshot.motion = pack.motions.default;
    this.snapshot.master = pack.config.assetModel.defaultMaster;
    this.snapshot.emoteVisible = [];
    this.startedAt = performance.now();
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
  setGaze(x, y) { this.snapshot.gaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; }

  setRunning(running) {
    this.running = Boolean(running);
    if (!this.running) this.renderAt(0);
    else this.startedAt = performance.now();
  }

  tick() {
    if (!this.svg) return;
    if (this.running && !document.hidden) this.renderAt(this.elapsed());
    this.frame = requestAnimationFrame(this.tick);
  }

  renderAt(time, transition = false) {
    if (!this.pack || !this.svg) return;
    this.snapshot.reducedMotion = this.reducedMotion.matches;
    const level = this.lip.mode === "manual"
      ? this.lip.manualLevel
      : this.lip.mode === "audio"
        ? this.lip.audioLevel
        : this.lip.mode === "subtitle"
          ? this.lip.subtitleLevel
          : Math.max(this.lip.audioLevel, this.lip.subtitleLevel * 0.7);
    const state = createTimelineState(this.pack, this.snapshot, time, { level });
    applyTimelineState(this.svg, this.pack, state, { transition });
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
    this.host.replaceChildren();
  }
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
