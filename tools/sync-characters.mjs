import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const charactersRoot = fileURLToPath(new URL("../public/characters/", import.meta.url));
const entries = await fs.readdir(charactersRoot, { withFileTypes: true });
const characters = [];

for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const configPath = new URL(`../public/characters/${entry.name}/character.json`, import.meta.url);
  try {
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    characters.push({ id: config.id, label: config.label ?? config.id, path: `./public/characters/${entry.name}/` });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

if (!characters.length) throw new Error("character.json を含むキャラクターフォルダがありません");
await fs.writeFile(
  new URL("../public/characters/index.json", import.meta.url),
  `${JSON.stringify({ schemaVersion: 1, characters }, null, 2)}\n`,
  "utf8",
);
console.log(`character manifest: ${characters.length} pack(s)`);
