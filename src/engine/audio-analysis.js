export async function analyzeAudioFile(file, { sampleRate = 60 } = {}) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) throw new Error("このブラウザは音声の事前解析に対応していません");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const levels = analyzeAudioBuffer(buffer, sampleRate);
    return { duration: buffer.duration, sampleRate, levels, sourceName: file.name };
  } catch (error) {
    throw new Error(`${file.name}: 音声を解析できませんでした (${error.message})`);
  } finally {
    await context.close().catch(() => {});
  }
}

export function analyzeAudioBuffer(buffer, sampleRate = 60) {
  const frameCount = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const levels = new Float32Array(frameCount);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const samplesPerFrame = buffer.sampleRate / sampleRate;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((frame + 1) * samplesPerFrame)));
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += 1) {
        sum += channel[sample] * channel[sample];
        count += 1;
      }
    }
    levels[frame] = count ? Math.sqrt(sum / count) : 0;
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const reference = Math.max(0.015, sorted[Math.floor(sorted.length * 0.94)] ?? 0.1);
  for (let index = 0; index < levels.length; index += 1) {
    levels[index] = Math.min(1, Math.max(0, (levels[index] - reference * 0.06) / (reference * 0.94)));
  }
  return levels;
}
