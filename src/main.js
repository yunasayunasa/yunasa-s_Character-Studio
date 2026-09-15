import { AudioLipSync } from "./engine/audio-lip-sync.js";
import { analyzeAudioFile } from "./engine/audio-analysis.js";
import { CharacterEngine } from "./engine/character-engine.js";
import { classifyTouchGaze, normalizeGazePoint } from "./engine/gaze-input.js";
import { loadCharacterManifest, loadCharacterPack } from "./engine/character-loader.js";
import { deleteStoredPack, importPackFiles, importPackZip, listStoredPacks, loadStoredPack } from "./engine/pack-store.js";
import { SubtitleLipSync } from "./engine/subtitle-lip-sync.js";
import { ExportManager } from "./export/export-manager.js";

const elements = {
  host: document.querySelector("#character-host"),
  stage: document.querySelector("#stage"),
  characterSelect: document.querySelector("#character-select"),
  expressionList: document.querySelector("#expression-list"),
  poseList: document.querySelector("#pose-list"),
  emoteSelect: document.querySelector("#emote-select"),
  motionToggle: document.querySelector("#motion-toggle"),
  mouthSlider: document.querySelector("#mouth-slider"),
  manualPanel: document.querySelector("#manual-panel"),
  audioPanel: document.querySelector("#audio-panel"),
  subtitlePanel: document.querySelector("#subtitle-panel"),
  audioFile: document.querySelector("#audio-file"),
  audioPlayer: document.querySelector("#audio-player"),
  subtitleFile: document.querySelector("#subtitle-file"),
  subtitlePlay: document.querySelector("#subtitle-play"),
  subtitleTime: document.querySelector("#subtitle-time"),
  subtitleOverlay: document.querySelector("#subtitle-overlay"),
  previewDebug: document.querySelector("#preview-debug"),
  gazeToggle: document.querySelector("#gaze-toggle"),
  packFiles: document.querySelector("#pack-files"),
  deletePack: document.querySelector("#delete-pack"),
  exportProgress: document.querySelector("#export-progress"),
  qualitySelect: document.querySelector("#quality-select"),
  manualDuration: document.querySelector("#manual-duration"),
  splitSeconds: document.querySelector("#split-seconds"),
  exportEstimate: document.querySelector("#export-estimate"),
  downloadResult: document.querySelector("#download-result"),
  status: document.querySelector("#status"),
};

const engine = new CharacterEngine(elements.host);
const query = new URLSearchParams(location.search);
const backendPreference = query.get("preview-backend");
if (["raster", "legacy-svg"].includes(backendPreference)) engine.previewPreference = backendPreference;
engine.onPreviewStatus = (message) => { if (message) setStatus(message); };
const audioLipSync = new AudioLipSync(elements.audioPlayer, (level) => engine.setAudioLevel(level));
let subtitlePlaying = false;
const subtitleLipSync = new SubtitleLipSync({
  onLevel: (level) => engine.setSubtitleLevel(level),
  onCue: (value) => { elements.subtitleOverlay.textContent = value; },
  onTime: (value) => { elements.subtitleTime.value = formatTime(value); },
  onEnded: () => setSubtitlePlaying(false),
});
const exporter = new ExportManager(engine, updateExportProgress, presentDownload);
if (query.get("debug-preview") === "1") {
  elements.previewDebug.hidden = false;
  engine.onPreviewMetrics = (metrics) => {
    elements.previewDebug.value = [
      `${metrics.fps.toFixed(1)}fps / ${metrics.frameMs.toFixed(2)}ms / DOM ${metrics.domUpdates.toFixed(1)} / target ${metrics.targetFps}`,
      `${metrics.backend} / rebuild ${metrics.cacheRebuilds} / raster ${metrics.rasterizationsPerSecond.toFixed(1)}/s`,
      `layers ${metrics.activeRasterLayers} / cache ${metrics.cacheEntries}・${formatBytes(metrics.cacheBytes)}`,
    ].join("\n");
  };
}
let manifest = [];
let currentMode = "manual";
let audioEnvelope = null;
let downloadUrl = null;
let touchGaze = null;
let gazeResetTimer = 0;

boot().catch(showError);

async function boot() {
  bindUi();
  await refreshManifest();
  await selectCharacter(manifest[0].id);
  registerServiceWorker();
}

function bindUi() {
  elements.characterSelect.addEventListener("change", () => selectCharacter(elements.characterSelect.value).catch(showError));
  elements.mouthSlider.addEventListener("input", () => engine.setManualMouth(elements.mouthSlider.value));
  elements.motionToggle.addEventListener("click", () => {
    const paused = elements.motionToggle.getAttribute("aria-pressed") !== "true";
    engine.setRunning(!paused);
    elements.motionToggle.setAttribute("aria-pressed", String(paused));
    elements.motionToggle.textContent = paused ? "再開" : "一時停止";
  });
  elements.emoteSelect.addEventListener("change", () => engine.setEmote(elements.emoteSelect.value));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setLipMode(button.dataset.mode)));
  document.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => runExport(button.dataset.export)));

  for (const control of [elements.qualitySelect, elements.manualDuration, elements.splitSeconds]) control.addEventListener("input", updateExportEstimate);

  elements.audioFile.addEventListener("change", async () => {
    const [file] = elements.audioFile.files;
    if (!file) return;
    try {
      setStatus(`${file.name} の音量タイムラインを事前解析しています…`);
      audioEnvelope = await analyzeAudioFile(file);
      audioLipSync.load(file);
      syncExportSources();
      updateExportEstimate();
      setStatus(`${file.name}（${audioEnvelope.duration.toFixed(2)}秒）を端末内で解析しました`);
    } catch (error) { showError(error); }
  });
  elements.audioPlayer.addEventListener("play", async () => {
    try {
      await audioLipSync.start();
      if (currentMode === "combined") subtitleLipSync.play(() => elements.audioPlayer.currentTime);
    } catch (error) {
      showError(error);
    }
  });
  elements.audioPlayer.addEventListener("pause", stopAudioDrivenMotion);
  elements.audioPlayer.addEventListener("ended", stopAudioDrivenMotion);

  elements.subtitleFile.addEventListener("change", async () => {
    const [file] = elements.subtitleFile.files;
    if (!file) return;
    try {
      const count = subtitleLipSync.load(await file.text());
      syncExportSources();
      updateExportEstimate();
      elements.subtitlePlay.disabled = false;
      setStatus(`${file.name} から字幕 ${count} 件を読み込みました`);
    } catch (error) {
      showError(error);
    }
  });
  elements.subtitlePlay.addEventListener("click", () => {
    if (subtitlePlaying) {
      subtitleLipSync.pause();
      setSubtitlePlaying(false);
    } else {
      subtitleLipSync.play();
      setSubtitlePlaying(true);
    }
  });

  elements.packFiles.addEventListener("change", async () => {
    if (!elements.packFiles.files.length) return;
    try {
      setStatus("キャラクターパックを検証しています…");
      const [single] = elements.packFiles.files;
      const record = elements.packFiles.files.length === 1 && single.name.toLowerCase().endsWith(".zip")
        ? await importPackZip(single)
        : await importPackFiles(elements.packFiles.files);
      await refreshManifest();
      await selectCharacter(record.id);
      setStatus(`${record.label} を端末へ保存しました`);
    } catch (error) {
      showError(error);
    } finally {
      elements.packFiles.value = "";
    }
  });
  elements.deletePack.addEventListener("click", async () => {
    const item = manifest.find((entry) => entry.id === elements.characterSelect.value);
    if (!item?.local || !confirm(`${item.label} をこの端末から削除しますか？`)) return;
    try {
      await deleteStoredPack(item.id);
      await refreshManifest();
      await selectCharacter(manifest[0].id);
      setStatus("端末内キャラクターパックを削除しました");
    } catch (error) {
      showError(error);
    }
  });

  elements.stage.addEventListener("pointermove", handleGazeMove);
  elements.stage.addEventListener("pointerdown", handleGazeStart);
  elements.stage.addEventListener("pointerup", handleGazeEnd);
  elements.stage.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") engine.setGaze(0, 0); });
  elements.stage.addEventListener("pointercancel", cancelTouchGaze);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      audioLipSync.stop();
      subtitleLipSync.pause();
    }
  });
}

async function refreshManifest() {
  const builtIn = await loadCharacterManifest();
  let stored = [];
  try {
    stored = (await listStoredPacks()).map((item) => ({ id: item.id, label: `${item.label}（端末）`, local: true }));
  } catch (error) {
    console.warn("端末内パック保存は利用できません", error);
  }
  manifest = [...new Map([...builtIn, ...stored].map((item) => [item.id, item])).values()];
  elements.characterSelect.replaceChildren(...manifest.map(characterOption));
}

async function selectCharacter(id) {
  const item = manifest.find((entry) => entry.id === id);
  if (!item) throw new Error(`キャラクター ${id} が見つかりません`);
  setStatus(`${item.label} を読み込み中…`);
  const pack = item.local ? await loadStoredPack(item.id) : await loadCharacterPack(item.path);
  await engine.mount(pack);
  renderChoiceButtons(elements.expressionList, pack.expressions.expressions, pack.expressions.default, (name) => engine.setExpression(name));
  renderChoiceButtons(elements.poseList, pack.poses?.poses ?? {}, pack.poses?.default, (name) => engine.setPose(name));
  renderEmotes(pack.emotes);
  if (pack.poses) engine.setPose(pack.poses.default);
  if (pack.emotes) engine.setEmote(pack.emotes.default);
  elements.characterSelect.value = id;
  elements.deletePack.disabled = !item.local;
  setStatus(`${pack.config.label} を表示しています`);
  updateExportEstimate();
}

function renderChoiceButtons(host, choices, selected, onSelect) {
  const buttons = Object.entries(choices).map(([name, choice]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.textContent = choice.label ?? name;
    button.setAttribute("aria-pressed", String(name === selected));
    button.addEventListener("click", () => {
      onSelect(name);
      for (const other of host.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
    });
    return button;
  });
  host.replaceChildren(...buttons);
  host.closest("fieldset").hidden = buttons.length === 0;
}

function renderEmotes(data) {
  const choices = data?.emotes ?? { none: { label: "なし" } };
  elements.emoteSelect.replaceChildren(...Object.entries(choices).map(([name, emote]) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = emote.label ?? name;
    return option;
  }));
  elements.emoteSelect.value = data?.default ?? "none";
}

function setLipMode(mode) {
  currentMode = mode;
  engine.setLipMode(mode);
  elements.manualPanel.hidden = mode !== "manual";
  elements.audioPanel.hidden = !["audio", "combined"].includes(mode);
  elements.subtitlePanel.hidden = !["subtitle", "combined"].includes(mode);
  for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  if (!["audio", "combined"].includes(mode)) audioLipSync.stop();
  if (!["subtitle", "combined"].includes(mode)) {
    subtitleLipSync.pause();
    setSubtitlePlaying(false);
  }
  syncExportSources();
  updateExportEstimate();
}

async function runExport(type) {
  const buttons = [...document.querySelectorAll("[data-export]")];
  buttons.forEach((button) => { button.disabled = true; });
  elements.exportProgress.hidden = false;
  elements.exportProgress.value = 0;
  elements.downloadResult.hidden = true;
  setStatus("書き出しを準備しています…");
  try {
    exporter.configure({
      quality: elements.qualitySelect.value,
      splitSeconds: Number(elements.splitSeconds.value),
      manualDuration: Number(elements.manualDuration.value),
    });
    syncExportSources();
    setStatus(await exporter[type]());
  } catch (error) {
    showError(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    setTimeout(() => { elements.exportProgress.hidden = true; }, 800);
  }
}

function syncExportSources() {
  exporter.setSources({ mode: currentMode, audioEnvelope, cues: subtitleLipSync.cues });
}

function updateExportEstimate() {
  if (!engine.pack) return;
  exporter.configure({
    quality: elements.qualitySelect.value,
    splitSeconds: Number(elements.splitSeconds.value),
    manualDuration: Number(elements.manualDuration.value),
  });
  syncExportSources();
  const estimate = exporter.describe();
  elements.exportEstimate.value = `${estimate.duration.toFixed(2)}秒 / ${estimate.size.width}×${estimate.size.height} / ${estimate.preset.fps}fps / ${estimate.frames}フレーム\n推定出力 ${formatBytes(estimate.estimatedBytes)}・作業メモリ ${formatBytes(estimate.workingBytes)} + 圧縮データ`;
  elements.exportEstimate.dataset.warning = String(estimate.splitRecommended);
}

function stopAudioDrivenMotion() {
  audioLipSync.stop();
  if (currentMode === "combined") subtitleLipSync.pause();
}

function setSubtitlePlaying(playing) {
  subtitlePlaying = playing;
  elements.subtitlePlay.textContent = playing ? "停止" : "字幕を再生";
}

function setGazeFromPoint(clientX, clientY) {
  if (!elements.gazeToggle.checked) return engine.setGaze(0, 0);
  const bounds = elements.stage.getBoundingClientRect();
  const gaze = normalizeGazePoint(bounds, clientX, clientY);
  engine.setGaze(gaze.x, gaze.y);
}

function handleGazeStart(event) {
  if (event.pointerType === "mouse") return;
  clearTimeout(gazeResetTimer);
  touchGaze = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
}

function handleGazeMove(event) {
  if (event.pointerType === "mouse") return setGazeFromPoint(event.clientX, event.clientY);
  if (!touchGaze || touchGaze.pointerId !== event.pointerId) return;
  if (!touchGaze.dragging && classifyTouchGaze(touchGaze.x, touchGaze.y, event.clientX, event.clientY) === "drag") {
    touchGaze.dragging = true;
    elements.stage.setPointerCapture?.(event.pointerId);
  }
  if (!touchGaze.dragging) return;
  event.preventDefault();
  setGazeFromPoint(event.clientX, event.clientY);
}

function handleGazeEnd(event) {
  if (!touchGaze || touchGaze.pointerId !== event.pointerId) return;
  if (!touchGaze.dragging && classifyTouchGaze(touchGaze.x, touchGaze.y, event.clientX, event.clientY) === "tap") setGazeFromPoint(event.clientX, event.clientY);
  if (touchGaze.dragging) elements.stage.releasePointerCapture?.(event.pointerId);
  touchGaze = null;
  gazeResetTimer = setTimeout(() => engine.setGaze(0, 0), 900);
}

function cancelTouchGaze() {
  touchGaze = null;
  engine.setGaze(0, 0);
}

function characterOption(item) {
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.label;
  return option;
}

function updateExportProgress(value) {
  elements.exportProgress.value = Math.min(1, Math.max(0, value));
}

function presentDownload(blob, filename) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(blob);
  elements.downloadResult.href = downloadUrl;
  elements.downloadResult.download = filename;
  elements.downloadResult.textContent = `${filename} を保存`;
  elements.downloadResult.hidden = false;
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function setStatus(message, kind = "ok") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function showError(error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : String(error), "error");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("オフライン登録に失敗しました", error));
}
