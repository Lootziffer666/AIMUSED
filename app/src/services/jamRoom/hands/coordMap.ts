// Maps normalized video coordinates (0..1) to stage pixels,
// accounting for object-fit: cover cropping AND the mirrored
// (scaleX(-1)) video display.

export function videoToStage(
  nx: number,
  ny: number,
  videoW: number,
  videoH: number,
  stageW: number,
  stageH: number,
): { x: number; y: number } {
  if (videoW <= 0 || videoH <= 0 || stageW <= 0 || stageH <= 0) {
    return { x: (1 - nx) * stageW, y: ny * stageH }
  }
  const scale = Math.max(stageW / videoW, stageH / videoH)
  const dw = videoW * scale
  const dh = videoH * scale
  const ox = (stageW - dw) / 2
  const oy = (stageH - dh) / 2
  return { x: ox + (1 - nx) * dw, y: oy + ny * dh }
}
