const PALETTE = buildPalette();

export function encodeGif(frames, width, height, delayCentiseconds = 10, options = {}) {
  if (!frames.length) throw new Error("GIFフレームがありません");
  const encoder = new GifStreamEncoder(width, height, delayCentiseconds, options);
  for (const frame of frames) encoder.addFrame(frame);
  return encoder.finish();
}

export class GifStreamEncoder {
  constructor(width, height, delayCentiseconds = 10, { colorQuality = "fast" } = {}) {
    this.width = width;
    this.height = height;
    this.delayCentiseconds = delayCentiseconds;
    this.colorQuality = colorQuality;
    this.output = new ByteSink();
    this.frameCount = 0;
    const output = this.output;
  output.ascii("GIF89a");
  output.u16(width);
  output.u16(height);
  output.byte(0xf7);
  output.byte(0);
  output.byte(0);
  output.bytes(PALETTE);
  output.bytes([0x21, 0xff, 0x0b]);
  output.ascii("NETSCAPE2.0");
  output.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  }

  addFrame(frame, delayCentiseconds = this.delayCentiseconds) {
    if (!frame?.data || (frame.width && frame.width !== this.width) || (frame.height && frame.height !== this.height)) throw new Error("GIFフレーム寸法が不正です");
    const output = this.output;
    const indexes = quantize(frame.data, this.width, this.colorQuality === "high");
    output.bytes([0x21, 0xf9, 0x04, 0x09]);
    output.u16(Math.max(1, Math.round(delayCentiseconds)));
    output.bytes([0x00, 0x00]);
    output.byte(0x2c);
    output.u16(0);
    output.u16(0);
    output.u16(this.width);
    output.u16(this.height);
    output.byte(0x00);
    output.byte(8);
    const compressed = lzw(indexes);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.subarray(offset, offset + 255);
      output.byte(block.length);
      output.bytes(block);
    }
    output.byte(0);
    this.frameCount += 1;
  }

  finish() {
    if (!this.frameCount) throw new Error("GIFフレームがありません");
    this.output.byte(0x3b);
    return this.output.finish();
  }
}

function quantize(rgba, width, dither) {
  const indexes = new Uint8Array(rgba.length / 4);
  for (let pixel = 0, index = 0; pixel < rgba.length; pixel += 4, index += 1) {
    if (rgba[pixel + 3] < 96) {
      indexes[index] = 0;
      continue;
    }
    const correction = dither ? (BAYER_4[(Math.floor(index / width) & 3) * 4 + (index & 3)] - 7.5) * 2.2 : 0;
    const red = clampByte(rgba[pixel] + correction);
    const green = clampByte(rgba[pixel + 1] + correction);
    const blue = clampByte(rgba[pixel + 2] + correction);
    const code = ((red >> 5) << 5) | ((green >> 5) << 2) | (blue >> 6);
    indexes[index] = 1 + Math.min(254, code);
  }
  return indexes;
}

function buildPalette() {
  const palette = new Uint8Array(256 * 3);
  for (let index = 1; index < 256; index += 1) {
    const code = index - 1;
    palette[index * 3] = Math.round(((code >> 5) & 7) * 255 / 7);
    palette[index * 3 + 1] = Math.round(((code >> 2) & 7) * 255 / 7);
    palette[index * 3 + 2] = Math.round((code & 3) * 255 / 3);
  }
  return palette;
}

function lzw(indexes) {
  const clear = 256;
  const end = 257;
  let dictionary;
  let nextCode;
  let codeSize;
  let currentByte = 0;
  let bitCount = 0;
  const bytes = [];

  const reset = () => {
    dictionary = new Map();
    nextCode = 258;
    codeSize = 9;
  };
  const writeCode = (code) => {
    currentByte |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(currentByte & 0xff);
      currentByte >>>= 8;
      bitCount -= 8;
    }
  };

  reset();
  writeCode(clear);
  let prefix = indexes[0];
  for (let index = 1; index < indexes.length; index += 1) {
    const value = indexes[index];
    const key = `${prefix},${value}`;
    if (dictionary.has(key)) {
      prefix = dictionary.get(key);
      continue;
    }
    writeCode(prefix);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writeCode(clear);
      reset();
    }
    prefix = value;
  }
  writeCode(prefix);
  writeCode(end);
  if (bitCount > 0) bytes.push(currentByte & 0xff);
  return Uint8Array.from(bytes);
}

class ByteSink {
  constructor() { this.output = []; this.length = 0; }
  byte(value) { this.bytes(Uint8Array.of(value & 0xff)); }
  bytes(values) { const chunk = values instanceof Uint8Array ? values : Uint8Array.from(values); this.output.push(chunk); this.length += chunk.length; }
  ascii(value) { this.bytes(new TextEncoder().encode(value)); }
  u16(value) { this.bytes(Uint8Array.of(value & 0xff, (value >> 8) & 0xff)); }
  finish() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.output) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
