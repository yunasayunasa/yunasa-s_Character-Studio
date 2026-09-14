export function inspectPsd(buffer, { includeComposite = false } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "8BPS") throw new Error("character.psd: PSDヘッダーが不正です");
  if (view.getUint16(4, false) !== 1) throw new Error("character.psd: PSDバージョンが不正です");
  const channels = view.getUint16(12, false);
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  let cursor = 26;
  cursor += 4 + view.getUint32(cursor, false);
  cursor += 4 + view.getUint32(cursor, false);
  const layerMaskLength = view.getUint32(cursor, false);
  cursor += 4;
  const imageDataOffset = cursor + layerMaskLength;
  const layerNames = [];
  const layerVisibility = [];
  if (layerMaskLength > 0) {
    const layerInfoLength = view.getUint32(cursor, false);
    cursor += 4;
    if (layerInfoLength >= 2) {
      const count = Math.abs(view.getInt16(cursor, false));
      cursor += 2;
      for (let index = 0; index < count; index += 1) {
        cursor += 16;
        const channelCount = view.getUint16(cursor, false);
        cursor += 2 + channelCount * 6;
        const flags = bytes[cursor + 10];
        cursor += 12;
        const extraLength = view.getUint32(cursor, false);
        const extraStart = cursor + 4;
        cursor = extraStart;
        cursor += 4 + view.getUint32(cursor, false);
        cursor += 4 + view.getUint32(cursor, false);
        const nameLength = bytes[cursor];
        const name = new TextDecoder().decode(bytes.subarray(cursor + 1, cursor + 1 + nameLength));
        layerNames.push(name);
        layerVisibility.push({ name, visible: (flags & 2) === 0 });
        cursor = extraStart + extraLength;
      }
    }
  }
  let composite = null;
  if (includeComposite) {
    const compression = view.getUint16(imageDataOffset, false);
    if (compression !== 0) throw new Error("character.psd: compositeの圧縮形式を検査できません");
    const pixelCount = width * height;
    const planes = Array.from({ length: channels }, (_, index) => bytes.subarray(imageDataOffset + 2 + index * pixelCount, imageDataOffset + 2 + (index + 1) * pixelCount));
    composite = new Uint8ClampedArray(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      composite[index * 4] = planes[0]?.[index] ?? 0;
      composite[index * 4 + 1] = planes[1]?.[index] ?? 0;
      composite[index * 4 + 2] = planes[2]?.[index] ?? 0;
      composite[index * 4 + 3] = planes[3]?.[index] ?? 255;
    }
  }
  return { width, height, channels, layerNames, layerVisibility, composite };
}

export function setPsdLayerVisibility(buffer, visibleNames) {
  const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "8BPS" || view.getUint16(4, false) !== 1) throw new Error("character.psd: PSDヘッダーが不正です");
  const visible = visibleNames instanceof Set ? visibleNames : new Set(visibleNames);
  let cursor = 26;
  cursor += 4 + view.getUint32(cursor, false);
  cursor += 4 + view.getUint32(cursor, false);
  const layerMaskLength = view.getUint32(cursor, false);
  cursor += 4;
  if (layerMaskLength === 0) return bytes;
  const layerInfoLength = view.getUint32(cursor, false);
  cursor += 4;
  if (layerInfoLength < 2) return bytes;
  const count = Math.abs(view.getInt16(cursor, false));
  cursor += 2;
  for (let index = 0; index < count; index += 1) {
    cursor += 16;
    const channelCount = view.getUint16(cursor, false);
    cursor += 2 + channelCount * 6;
    const flagsOffset = cursor + 10;
    cursor += 12;
    const extraLength = view.getUint32(cursor, false);
    const extraStart = cursor + 4;
    cursor = extraStart;
    cursor += 4 + view.getUint32(cursor, false);
    cursor += 4 + view.getUint32(cursor, false);
    const nameLength = bytes[cursor];
    const name = new TextDecoder().decode(bytes.subarray(cursor + 1, cursor + 1 + nameLength));
    bytes[flagsOffset] = visible.has(name) ? bytes[flagsOffset] & ~2 : bytes[flagsOffset] | 2;
    cursor = extraStart + extraLength;
  }
  return bytes;
}

function ascii(bytes, offset, length) { return new TextDecoder().decode(bytes.subarray(offset, offset + length)); }
