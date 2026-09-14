export function parseSubtitles(source) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    const text = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export class SubtitleLipSync {
  constructor({ onLevel, onCue, onTime, onEnded = () => {} }) {
    this.onLevel = onLevel;
    this.onCue = onCue;
    this.onTime = onTime;
    this.onEnded = onEnded;
    this.cues = [];
    this.duration = 0;
    this.startedAt = 0;
    this.offset = 0;
    this.clock = null;
    this.frame = null;
    this.lastText = null;
    this.update = this.update.bind(this);
  }

  load(source) {
    this.pause();
    this.cues = parseSubtitles(source);
    if (!this.cues.length) throw new Error("有効な字幕キューが見つかりませんでした");
    this.duration = this.cues.at(-1).end;
    this.offset = 0;
    this.renderAt(0);
    return this.cues.length;
  }

  play(clock = null) {
    if (!this.cues.length) return;
    this.clock = clock;
    this.startedAt = performance.now() - this.offset * 1000;
    if (!this.frame) this.frame = requestAnimationFrame(this.update);
  }

  pause() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.clock = null;
    this.onLevel(0);
  }

  reset() {
    this.pause();
    this.offset = 0;
    this.renderAt(0);
  }

  update() {
    const time = this.clock ? this.clock() : (performance.now() - this.startedAt) / 1000;
    this.offset = time;
    this.renderAt(time);
    if (time >= this.duration || !Number.isFinite(time)) {
      this.reset();
      this.onEnded();
      return;
    }
    this.frame = requestAnimationFrame(this.update);
  }

  renderAt(time) {
    const cue = this.cues.find((item) => time >= item.start && time < item.end) ?? null;
    const text = cue?.text ?? "";
    if (text !== this.lastText) {
      this.lastText = text;
      this.onCue(text);
    }
    this.onTime(time);
    this.onLevel(cue ? cueLevel(cue, time) : 0);
  }
}

function cueLevel(cue, time) {
  const plain = cue.text.replace(/\s/g, "");
  if (!plain) return 0;
  const elapsed = Math.max(0, time - cue.start);
  const index = Math.floor(elapsed * 8) % plain.length;
  const character = plain[index];
  if (/[、。…,.!?！？]/.test(character)) return 0;
  return [0.34, 0.68, 0.48, 0.82][Math.floor(elapsed * 10) % 4];
}

function parseTimestamp(value) {
  const match = value?.match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/);
  if (!match) return Number.NaN;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
