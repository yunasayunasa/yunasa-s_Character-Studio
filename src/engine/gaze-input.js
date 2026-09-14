export function normalizeGazePoint(bounds, clientX, clientY) {
  return {
    x: clamp(((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1, -1, 1),
    y: clamp(((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1, -1, 1),
  };
}

export function classifyTouchGaze(startX, startY, clientX, clientY, threshold = 12) {
  const dx = clientX - startX;
  const dy = clientY - startY;
  if (Math.hypot(dx, dy) < threshold) return "tap";
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? "drag" : "scroll";
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
