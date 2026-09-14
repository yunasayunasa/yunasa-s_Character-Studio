export async function renderSvgToCanvas(svg, { width, height, layer = null, part = null } = {}) {
  const viewBox = svg.viewBox.baseVal;
  const targetWidth = Math.max(1, Math.round(width ?? viewBox.width));
  const targetHeight = Math.max(1, Math.round(height ?? viewBox.height));
  const clone = svg.cloneNode(true);
  clone.setAttribute("width", String(targetWidth));
  clone.setAttribute("height", String(targetHeight));
  if (layer) {
    for (const node of clone.querySelectorAll("[data-export-layer]")) {
      if (node.getAttribute("data-export-layer") !== layer) {
        node.setAttribute("opacity", "0");
        node.removeAttribute("style");
      }
    }
  }
  if (part) {
    for (const node of clone.querySelectorAll("[data-export-part]")) {
      const selected = node.getAttribute("data-export-part") === part;
      node.removeAttribute("style");
      if (!selected) node.setAttribute("opacity", "0");
    }
  }
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`${type} の生成に失敗しました`)), type, quality);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("SVGフレームを画像化できませんでした"));
    image.src = url;
  });
}
