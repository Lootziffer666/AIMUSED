export interface ScanSequencerConfig {
  lineCount: number
  sensitivity: number
  pulseSpeed: number
  triggerRatio: number
  sampleXRatio: number
  sampleWidth: number
}

export interface ScanLineState {
  id: number
  yRatio: number
  previousLuminance: number | null
  active: boolean
  pulseX: number
  velocity: number
  triggered: boolean
}

export interface ScanTriggerEvent {
  lineId: number
  noteIndex: number
  velocity: number
}

export interface ScanFrameResult {
  lines: ScanLineState[]
  events: ScanTriggerEvent[]
}

export const DEFAULT_SCAN_CONFIG: ScanSequencerConfig = {
  lineCount: 16,
  sensitivity: 38,
  pulseSpeed: 360,
  triggerRatio: 0.58,
  sampleXRatio: 0.12,
  sampleWidth: 5,
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function createScanLines(lineCount: number): ScanLineState[] {
  return Array.from({ length: lineCount }, (_, index) => ({
    id: index,
    yRatio: (index + 0.5) / lineCount,
    previousLuminance: null,
    active: false,
    pulseX: 0,
    velocity: 1,
    triggered: false,
  }))
}

export function sampleRowLuminance(
  imageData: Pick<ImageData, "data" | "width" | "height">,
  config: ScanSequencerConfig,
): number[] {
  const centerX = Math.round(
    clamp(config.sampleXRatio, 0, 1) * Math.max(0, imageData.width - 1),
  )
  const halfWidth = Math.max(0, Math.floor(config.sampleWidth / 2))

  return Array.from({ length: config.lineCount }, (_, lineIndex) => {
    const y = Math.round(
      ((lineIndex + 0.5) / config.lineCount) *
        Math.max(0, imageData.height - 1),
    )
    let sum = 0
    let samples = 0

    for (
      let x = Math.max(0, centerX - halfWidth);
      x <= Math.min(imageData.width - 1, centerX + halfWidth);
      x++
    ) {
      const offset = (y * imageData.width + x) * 4
      const red = imageData.data[offset] ?? 0
      const green = imageData.data[offset + 1] ?? 0
      const blue = imageData.data[offset + 2] ?? 0
      sum += red * 0.2126 + green * 0.7152 + blue * 0.0722
      samples++
    }

    return samples === 0 ? 0 : sum / samples
  })
}

export function advanceScanLines(
  lines: readonly ScanLineState[],
  luminances: readonly number[],
  deltaMilliseconds: number,
  canvasWidth: number,
  config: ScanSequencerConfig,
): ScanFrameResult {
  const events: ScanTriggerEvent[] = []
  const triggerX = Math.max(1, canvasWidth * config.triggerRatio)
  const deltaSeconds = clamp(deltaMilliseconds, 0, 100) / 1000

  const nextLines = lines.map((line, index) => {
    const luminance = luminances[index] ?? line.previousLuminance ?? 0
    const difference =
      line.previousLuminance === null
        ? 0
        : Math.abs(luminance - line.previousLuminance)

    let active = line.active
    let pulseX = line.pulseX
    let velocity = line.velocity
    let triggered = line.triggered

    if (!active && difference >= config.sensitivity) {
      active = true
      pulseX = 0
      triggered = false
      velocity = clamp(Math.round(28 + difference * 1.55), 1, 127)
    }

    if (active) {
      const previousX = pulseX
      pulseX += config.pulseSpeed * deltaSeconds

      if (!triggered && previousX < triggerX && pulseX >= triggerX) {
        triggered = true
        events.push({
          lineId: line.id,
          noteIndex: config.lineCount - 1 - index,
          velocity,
        })
      }

      if (pulseX > canvasWidth) {
        active = false
        pulseX = 0
        triggered = false
      }
    }

    return {
      ...line,
      previousLuminance: luminance,
      active,
      pulseX,
      velocity,
      triggered,
    }
  })

  return { lines: nextLines, events }
}
