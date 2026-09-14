import { renderSvgToCanvas } from "./canvas-renderer.js";

export async function createLayeredPsd(svg, config, { width = 640, onProgress = () => {} } = {}) {
  const height = Math.round(width * config.canvas.height / config.canvas.width);
  const definitions = config.psdLayers ?? [];
  if (!definitions.length) throw new Error("このパックには psdLayers が定義されていません");
  const layers = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const partId = definition.partId ?? definition.source;
    const visible = isSvgPartVisible(svg, partId);
    const canvas = await renderSvgToCanvas(svg, { width, height, part: partId });
    const pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    layers.push({ name: definition.name, pixels, visible });
    onProgress((index + 1) / (definitions.length + 1));
  }
  const composite = compositeVisibleLayers(layers, width, height);
  onProgress(1);
  return writePsd(width, height, layers, composite);
}

export function compositeVisibleLayers(layers, width, height) {
  const result = new Uint8ClampedArray(width * height * 4);
  for (const layer of layers) {
    if (layer.visible === false) continue;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const sourceAlpha = layer.pixels[offset + 3] / 255;
      if (sourceAlpha === 0) continue;
      const destinationAlpha = result[offset + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        result[offset + channel] = Math.round((layer.pixels[offset + channel] * sourceAlpha + result[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      result[offset + 3] = Math.round(outputAlpha * 255);
    }
  }
  return result;
}

export function writePsd(width, height, layers, composite) {
  const pixelCount = width * height;
  const layerRecords = [];
  const layerChannels = [];
  for (const layer of layers) {
    const channels = splitChannels(layer.pixels, pixelCount).map((channel) => packBitsChannel(channel, width, height));
    const name = pascalName(layer.name);
    const record = concat([
      i32(0), i32(0), i32(height), i32(width), u16(4),
      i16(-1), u32(channels[0].length), i16(0), u32(channels[1].length),
      i16(1), u32(channels[2].length), i16(2), u32(channels[3].length),
      ascii("8BIM"), ascii("norm"), bytes(255, 0, layer.visible === false ? 2 : 0, 0),
      u32(8 + name.length), u32(0), u32(0), name,
    ]);
    layerRecords.push(record);
    layerChannels.push(...channels);
  }
  let layerInfo = concat([i16(layers.length), ...layerRecords, ...layerChannels]);
  if (layerInfo.length % 2) layerInfo = concat([layerInfo, bytes(0)]);
  const layerAndMask = concat([u32(layerInfo.length), layerInfo, u32(0)]);
  const compositeChannels = splitChannels(composite, pixelCount, false);
  return concat([
    ascii("8BPS"), u16(1), new Uint8Array(6), u16(4), u32(height), u32(width), u16(8), u16(3),
    u32(0), u32(0), u32(layerAndMask.length), layerAndMask,
    u16(0), ...compositeChannels,
  ]);
}

export function isSvgPartVisible(svg, partId) {
  const escape = globalThis.CSS?.escape ?? ((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  let node = svg.querySelector(`#${escape(partId)}`);
  if (!node) return false;
  while (node && node !== svg) {
    const style = node.style;
    const opacity = style?.opacity || node.getAttribute?.("opacity");
    if (style?.display === "none" || style?.visibility === "hidden" || opacity === "0") return false;
    if (node.getAttribute?.("display") === "none" || node.getAttribute?.("visibility") === "hidden") return false;
    node = node.parentElement;
  }
  return true;
}

function splitChannels(rgba, pixelCount, alphaFirst = true) {
  const red = new Uint8Array(pixelCount);
  const green = new Uint8Array(pixelCount);
  const blue = new Uint8Array(pixelCount);
  const alpha = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    red[index] = rgba[index * 4];
    green[index] = rgba[index * 4 + 1];
    blue[index] = rgba[index * 4 + 2];
    alpha[index] = rgba[index * 4 + 3];
  }
  return alphaFirst ? [alpha, red, green, blue] : [red, green, blue, alpha];
}

function packBitsChannel(channel, width, height) {
  const rows = [];
  const lengths = [];
  for (let y = 0; y < height; y += 1) {
    const encoded = packBitsRow(channel.subarray(y * width, (y + 1) * width));
    if (encoded.length > 65535) throw new Error("PSD RLE行が上限を超えています");
    rows.push(encoded);
    lengths.push(u16(encoded.length));
  }
  return concat([u16(1), ...lengths, ...rows]);
}

function packBitsRow(row) {
  const output = [];
  let index = 0;
  while (index < row.length) {
    let run = 1;
    while (index + run < row.length && row[index + run] === row[index] && run < 128) run += 1;
    if (run >= 3) {
      output.push(257 - run, row[index]);
      index += run;
      continue;
    }
    const start = index;
    index += run;
    while (index < row.length && index - start < 128) {
      run = 1;
      while (index + run < row.length && row[index + run] === row[index] && run < 128) run += 1;
      if (run >= 3) break;
      index += run;
    }
    const length = index - start;
    output.push(length - 1, ...row.subarray(start, start + length));
  }
  return Uint8Array.from(output);
}

function pascalName(value) {
  const raw = new TextEncoder().encode(value.slice(0, 255));
  const length = Math.ceil((raw.length + 1) / 4) * 4;
  const output = new Uint8Array(length);
  output[0] = raw.length;
  output.set(raw, 1);
  return output;
}

function concat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function bytes(...values) { return Uint8Array.from(values); }
function ascii(value) { return new TextEncoder().encode(value); }
function u16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, false); return out; }
function i16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setInt16(0, value, false); return out; }
function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, false); return out; }
function i32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, value, false); return out; }
