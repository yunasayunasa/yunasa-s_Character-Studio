import { promises as fs } from "node:fs";
import { deflateSync } from "node:zlib";
import { crc32 } from "../src/export/zip-store.js";

for (const size of [192, 512]) {
  const scanlines = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const nx = (x - size / 2) / size;
      const ny = (y - size * 0.46) / size;
      const inFace = nx * nx + ny * ny < 0.082;
      const inEye = ((nx + 0.075) ** 2 + (ny + 0.012) ** 2 < 0.0009) || ((nx - 0.075) ** 2 + (ny + 0.012) ** 2 < 0.0009);
      const color = inEye ? [42, 27, 9] : inFace ? [255, 247, 234] : [23, 26, 34];
      scanlines.set([...color, 255], offset);
    }
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(size)),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await fs.writeFile(new URL(`../icons/icon-${size}.png`, import.meta.url), png);
  console.log(`icon-${size}.png: ${png.length} bytes`);
}

function ihdr(size) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(size, 0);
  data.writeUInt32BE(size, 4);
  data.set([8, 6, 0, 0, 0], 8);
  return data;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
