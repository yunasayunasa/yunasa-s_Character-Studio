import { RasterPreviewRenderer } from "./raster-preview.js";
import { RealtimePreviewRenderer } from "./realtime-preview.js";

export async function createPreviewBackend({ svg, pack, host, snapshot, preference = "auto", rasterFactory, legacyFactory, shouldContinue = () => true } = {}) {
  const createRaster = rasterFactory ?? (() => new RasterPreviewRenderer(svg, pack, host));
  const createLegacy = legacyFactory ?? (() => {
    host.replaceChildren(svg);
    const renderer = new RealtimePreviewRenderer(svg, pack);
    renderer.backend = "legacy-svg";
    renderer.destroy = () => {};
    return renderer;
  });

  if (preference !== "legacy-svg") {
    let raster;
    try {
      raster = createRaster();
      await raster.initialize(snapshot);
      return raster;
    } catch (error) {
      raster?.destroy?.();
      if (!shouldContinue()) throw error;
      if (preference === "raster") throw error;
      console.warn("Raster Previewを初期化できないためLegacy SVGへ切り替えます", error);
    }
  }

  if (!shouldContinue()) throw new Error("Preview initialization was superseded");
  const legacy = createLegacy();
  legacy.prepareStatic(snapshot);
  return legacy;
}
