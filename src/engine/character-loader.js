import {
  assertCharacterConfig,
  assertEmotes,
  assertExpressions,
  assertMotions,
  assertPoses,
  assertSvgReferences,
  normalizePackData,
} from "./pack-schema.js";

export async function loadCharacterManifest(url = "./public/characters/index.json") {
  const data = await fetchJson(url);
  if (!Array.isArray(data.characters) || data.characters.length === 0) {
    throw new Error("利用できるキャラクターパックがありません");
  }
  return data.characters;
}

export async function loadCharacterPack(baseUrl) {
  const base = ensureTrailingSlash(baseUrl);
  const config = assertCharacterConfig(await fetchJson(`${base}character.json`));
  const [expressions, motions, poses, emotes, svgText] = await Promise.all([
    fetchJson(new URL(config.files.expressions, absoluteBase(base)).href),
    fetchJson(new URL(config.files.motions, absoluteBase(base)).href),
    config.files.poses ? fetchJson(new URL(config.files.poses, absoluteBase(base)).href) : null,
    config.files.emotes ? fetchJson(new URL(config.files.emotes, absoluteBase(base)).href) : null,
    fetchText(new URL(config.files.svg, absoluteBase(base)).href),
  ]);
  return loadCharacterPackData({ config, expressions, motions, poses, emotes, svgText, baseUrl: base });
}

export function loadCharacterPackData({ config, expressions, motions, poses = null, emotes = null, svgText, baseUrl = "local:", auxiliaryFiles = [], sourceFiles = [] }) {
  ({ config, expressions, motions, poses, emotes } = normalizePackData({ config, expressions, motions, poses, emotes }));
  assertCharacterConfig(config);
  assertExpressions(expressions, config);
  assertMotions(motions);
  assertPoses(poses, config);
  assertEmotes(emotes, config);
  const svg = parseSafeSvg(svgText);
  assertSvgParts(svg, config, expressions, motions, poses, emotes);
  const motionTargets = [...new Set(Object.values(motions.motions).flatMap((motion) => motion.tracks.map((track) => track.target)))];
  const poseTargets = [...new Set(Object.values(poses?.poses ?? {}).map((pose) => pose.transform?.target).filter(Boolean))];
  return {
    baseUrl,
    config,
    expressions,
    motions,
    poses,
    emotes,
    svg,
    svgSource: svgText,
    motionTargets,
    poseTargets,
    auxiliaryFiles,
    sourceFiles,
  };
}

export function parseSafeSvg(text) {
  const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
  if (documentNode.querySelector("parsererror")) throw new Error("character.svg を解析できませんでした");
  const svg = documentNode.documentElement;
  if (svg.localName !== "svg") throw new Error("character.svg のルート要素が svg ではありません");
  svg.querySelectorAll("script, foreignObject, style").forEach((node) => node.remove());
  for (const element of svg.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#") && !isEmbeddedRaster(element.localName, value)) {
        element.removeAttribute(attribute.name);
      }
      if (/url\((?!["']?#)/i.test(value)) element.removeAttribute(attribute.name);
    }
  }
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("focusable", "false");
  return svg;
}

// Self-contained raster payloads only; SVG/data documents and remote URLs remain forbidden.
export function isEmbeddedRaster(tag, value) {
  if (tag !== "image") return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 || match[2].length > 24 * 1024 * 1024) return false;
  const bytes = atob(match[2].slice(0, 24));
  if (match[1] === "png") return bytes.startsWith("\x89PNG\r\n\x1a\n");
  if (match[1] === "jpeg") return bytes.startsWith("\xff\xd8\xff");
  return bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
}

function assertSvgParts(svg, config, expressions, motions, poses, emotes) {
  const idList = [...svg.querySelectorAll("[id]")].map((node) => node.id);
  const ids = new Set(idList);
  const duplicates = [...new Set(idList.filter((id, index) => idList.indexOf(id) !== index))];
  if (duplicates.length) throw new Error(`character.svg に重複IDがあります: ${duplicates.join(", ")}`);
  assertSvgReferences(ids, config, expressions, motions, poses, emotes);
  for (const layer of config.psdLayers ?? []) {
    const id = layer.partId ?? layer.source;
    if (!ids.has(id)) throw new Error(`character.json: psdLayers のpart ID ${id} が character.svg にありません`);
    if (layer.name !== id) throw new Error(`character.json: PSDレイヤー名 ${layer.name} はSVG/JSON part ID ${id} と一致させてください`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} の読み込みに失敗しました (${response.status})`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} の読み込みに失敗しました (${response.status})`);
  return response.text();
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function absoluteBase(base) {
  return new URL(base, document.baseURI);
}
