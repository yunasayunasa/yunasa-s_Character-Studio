export async function encodeTimelineWebm({ width, height, fps, duration, renderFrame, onProgress = () => {} }) {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame) throw new Error("このブラウザはオフライン動画エンコードに対応していません。透過GIFをご利用ください");
  const codec = await chooseTransparentCodec(width, height, fps);
  const chunks = [];
  let encoderError = null;
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ timestamp: chunk.timestamp, type: chunk.type, data });
    },
    error(error) { encoderError = error; },
  });
  encoder.configure(codec.config);
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const frameDuration = Math.round(1_000_000 / fps);
  try {
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(duration, index / fps);
      const canvas = await renderFrame(time, index);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1_000_000), duration: frameDuration });
      encoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await encoder.flush();
      if (encoderError) throw encoderError;
      onProgress((index + 1) / (frameCount + 1));
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    encoder.close();
  }
  onProgress(1);
  return { data: muxWebm(chunks, { width, height, duration, fps, codecId: codec.webm }), mimeType: "video/webm" };
}

export async function chooseTransparentCodec(width, height, fps) {
  const candidates = [
    { webCodec: "vp09.00.10.08", webm: "V_VP9" },
    { webCodec: "vp8", webm: "V_VP8" },
  ];
  for (const candidate of candidates) {
    const config = {
      codec: candidate.webCodec,
      width,
      height,
      framerate: fps,
      bitrate: qualityBitrate(width, height, fps),
      latencyMode: "quality",
      alpha: "keep",
    };
    try {
      const result = await VideoEncoder.isConfigSupported(config);
      if (result.supported && result.config?.alpha === "keep") return { ...candidate, config };
    } catch {}
  }
  throw new Error("この端末では透過WebMに対応していません。透過GIFまたはPNGをご利用ください");
}

function muxWebm(chunks, { width, height, duration, fps, codecId }) {
  const header = element([0x1a, 0x45, 0xdf, 0xa3], concat([
    element([0x42, 0x86], uint(1)), element([0x42, 0xf7], uint(1)), element([0x42, 0xf2], uint(4)), element([0x42, 0xf3], uint(8)),
    element([0x42, 0x82], ascii("webm")), element([0x42, 0x87], uint(4)), element([0x42, 0x85], uint(2)),
  ]));
  const info = element([0x15, 0x49, 0xa9, 0x66], concat([
    element([0x2a, 0xd7, 0xb1], uint(1_000_000)),
    element([0x44, 0x89], float64(duration * 1000)),
    element([0x4d, 0x80], ascii("SVG Character Studio")),
    element([0x57, 0x41], ascii("SVG Character Studio")),
  ]));
  const video = element([0xe0], concat([
    element([0xb0], uint(width)), element([0xba], uint(height)), element([0x53, 0xc0], uint(1)),
  ]));
  const track = element([0xae], concat([
    element([0xd7], uint(1)), element([0x73, 0xc5], uint(1)), element([0x83], uint(1)),
    element([0x86], ascii(codecId)), element([0x23, 0xe3, 0x83], uint(Math.round(1_000_000_000 / fps))), video,
  ]));
  const tracks = element([0x16, 0x54, 0xae, 0x6b], track);
  const clusters = [];
  let clusterBase = -1;
  let blocks = [];
  const flush = () => {
    if (clusterBase < 0) return;
    clusters.push(element([0x1f, 0x43, 0xb6, 0x75], concat([element([0xe7], uint(clusterBase)), ...blocks])));
    blocks = [];
  };
  for (const chunk of chunks.sort((a, b) => a.timestamp - b.timestamp)) {
    const timeMs = Math.round(chunk.timestamp / 1000);
    if (clusterBase < 0 || timeMs - clusterBase > 30000) { flush(); clusterBase = timeMs; }
    const relative = timeMs - clusterBase;
    const blockHeader = Uint8Array.of(0x81, (relative >> 8) & 0xff, relative & 0xff, chunk.type === "key" ? 0x80 : 0);
    blocks.push(element([0xa3], concat([blockHeader, chunk.data])));
  }
  flush();
  return concat([header, element([0x18, 0x53, 0x80, 0x67], concat([info, tracks, ...clusters]))]);
}

function element(id, data) { return concat([Uint8Array.from(id), vint(data.length), data]); }
function vint(value) {
  for (let length = 1; length <= 8; length += 1) {
    const limit = 2 ** (7 * length) - 1;
    if (value < limit) {
      const out = new Uint8Array(length);
      let current = value;
      for (let index = length - 1; index >= 0; index -= 1) { out[index] = current & 0xff; current = Math.floor(current / 256); }
      out[0] |= 1 << (8 - length);
      return out;
    }
  }
  throw new Error("WebM要素が大きすぎます");
}
function uint(value) {
  let length = 1;
  while (value >= 2 ** (8 * length) && length < 8) length += 1;
  const out = new Uint8Array(length);
  let current = value;
  for (let index = length - 1; index >= 0; index -= 1) { out[index] = current & 0xff; current = Math.floor(current / 256); }
  return out;
}
function float64(value) { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, false); return out; }
function ascii(value) { return new TextEncoder().encode(value); }
function concat(parts) { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }
function qualityBitrate(width, height, fps) { return Math.max(800_000, Math.min(12_000_000, Math.round(width * height * fps * 0.42))); }
