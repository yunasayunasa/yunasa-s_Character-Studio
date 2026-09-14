import { crc32 } from "../export/zip-store.js";

const MAX_FILES = 256;
const MAX_UNCOMPRESSED = 80 * 1024 * 1024;

export async function readZipFile(file) {
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { throw new Error(`${file.name}: ZIPを読み取れませんでした`); }
  return readZipBytes(bytes);
}

export async function readZipBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEnd(view);
  const count = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (count > MAX_FILES) throw new Error(`ZIP内のファイル数が上限 ${MAX_FILES} を超えています`);
  const files = new Map();
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    assertSignature(view, cursor, 0x02014b50, "中央ディレクトリ");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    validatePath(name);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    total += size;
    if (total > MAX_UNCOMPRESSED) throw new Error("ZIP展開後サイズが80MBを超えています");
    assertSignature(view, localOffset, 0x04034b50, name);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new Error(`${name}: ZIPデータが途中で切れています`);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const data = await decompress(compressed, method, name);
    if (data.length !== size) throw new Error(`${name}: 展開後サイズが一致しません`);
    if (crc32(data) !== expectedCrc) throw new Error(`${name}: CRCが一致せず、ファイルが破損しています`);
    files.set(name.replace(/\\/g, "/"), data);
  }
  return files;
}

export function findPackRoot(files) {
  const candidates = [...files.keys()].filter((name) => name === "character.json" || name.endsWith("/character.json"));
  if (candidates.length !== 1) throw new Error(candidates.length ? "ZIP内にcharacter.jsonが複数あります" : "ZIP内にcharacter.jsonがありません");
  return candidates[0].slice(0, -"character.json".length);
}

async function decompress(compressed, method, name) {
  if (method === 0) return compressed.slice();
  if (method !== 8) throw new Error(`${name}: 非対応のZIP圧縮方式です (method ${method})`);
  if (!globalThis.DecompressionStream) throw new Error(`${name}: このSafariではdeflate ZIPを展開できません。無圧縮ZIPをご利用ください`);
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new Error(`${name}: ZIP展開に失敗しました (${error.message})`);
  }
}

function findEnd(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) return offset;
  throw new Error("ZIP終端レコードが見つかりません。ファイルが破損しています");
}

function validatePath(name) {
  if (!name || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split(/[\\/]/).includes("..")) throw new Error(`ZIP内パスが不正です: ${name}`);
}

function assertSignature(view, offset, expected, label) {
  if (offset < 0 || offset + 4 > view.byteLength || view.getUint32(offset, true) !== expected) throw new Error(`${label}: ZIP構造が破損しています`);
}

function decode(bytes, flags) {
  return new TextDecoder(flags & 0x0800 ? "utf-8" : "utf-8").decode(bytes);
}
