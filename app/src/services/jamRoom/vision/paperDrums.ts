/**
 * Recognising a drum kit drawn on paper.
 *
 * The idea that makes this work without a model: a drawn drum is a *closed
 * outline*, so the interesting thing is not the ink, it is the **hole the ink
 * encloses**. Flood the background in from the border; every background region
 * that stays unreached is surrounded by ink and therefore a drawn shape.
 *
 * That holds for a wobbly circle, an oval, a square or a triangle – whatever a
 * child actually draws – and it needs no template, no training and no
 * assumption about how round the line is. A stroke that is merely *near* a
 * shape encloses nothing and is ignored, which is exactly right.
 *
 * Everything here is a pure function over pixel data, so it is testable
 * without a camera.
 */

export interface GrayImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface DetectedDrum {
  /** Centre, as a fraction of the frame */
  xPct: number
  yPct: number
  /** Half of the mean extent, as a fraction of the frame width */
  radiusPct: number
  /** Enclosed pixels – the drawn area, not the outline */
  area: number
  /** 1 = a perfectly round, perfectly filled shape */
  roundness: number
}

export interface DetectOptions {
  /** Side of the local mean window used for thresholding, in pixels */
  windowSize?: number
  /** How much darker than its surroundings a pixel has to be to count as ink */
  threshold?: number
  /** Smallest enclosed area to accept, as a fraction of the frame */
  minAreaRatio?: number
  /** Largest, so the sheet's own border is not a drum */
  maxAreaRatio?: number
  /** Shapes flatter than this are rejected (a drawn drum is roughly as wide as tall) */
  minAspect?: number
  maxResults?: number
}

const DEFAULTS: Required<DetectOptions> = {
  windowSize: 25,
  threshold: 12,
  minAreaRatio: 0.002,
  maxAreaRatio: 0.35,
  minAspect: 0.35,
  maxResults: 8,
}

/** Rec. 709 luma; the same weighting the scan sequencer uses. */
export function toGray(image: {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}): GrayImage {
  const gray = new Uint8ClampedArray(image.width * image.height)
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4
    gray[i] =
      (image.data[offset] ?? 0) * 0.2126 +
      (image.data[offset + 1] ?? 0) * 0.7152 +
      (image.data[offset + 2] ?? 0) * 0.0722
  }
  return { data: gray, width: image.width, height: image.height }
}

/**
 * Local-mean threshold via an integral image.
 *
 * A global threshold fails on paper: one corner is always in shadow. Comparing
 * each pixel to the mean of its own neighbourhood survives that, and costs one
 * pass.
 */
export function inkMask(
  image: GrayImage,
  options: DetectOptions = {},
): Uint8Array {
  const { windowSize, threshold } = { ...DEFAULTS, ...options }
  const { width, height, data } = image
  const half = Math.max(1, Math.floor(windowSize / 2))

  // integral[y][x] = sum of all pixels above and left, inclusive
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x]
      integral[(y + 1) * (width + 1) + (x + 1)] =
        integral[y * (width + 1) + (x + 1)] + rowSum
    }
  }

  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const count = (y1 - y0 + 1) * (x1 - x0 + 1)
      const sum =
        integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
        integral[y0 * (width + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0]
      const mean = sum / count
      mask[y * width + x] = data[y * width + x] < mean - threshold ? 1 : 0
    }
  }
  return mask
}

interface Region {
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  sumX: number
  sumY: number
}

/**
 * Background regions that the border cannot reach – the holes the ink encloses.
 */
export function enclosedRegions(
  mask: Uint8Array,
  width: number,
  height: number,
): Region[] {
  const OUTSIDE = 2
  const seen = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)

  // 1. flood the background in from every border pixel
  let head = 0
  let tail = 0
  const pushIfBackground = (index: number) => {
    if (mask[index] === 0 && seen[index] === 0) {
      seen[index] = OUTSIDE
      queue[tail++] = index
    }
  }
  for (let x = 0; x < width; x++) {
    pushIfBackground(x)
    pushIfBackground((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(y * width)
    pushIfBackground(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = (index - x) / width
    if (x > 0) pushIfBackground(index - 1)
    if (x < width - 1) pushIfBackground(index + 1)
    if (y > 0) pushIfBackground(index - width)
    if (y < height - 1) pushIfBackground(index + width)
  }

  // 2. whatever background is left is enclosed; collect it region by region
  const regions: Region[] = []
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 0 || seen[start] !== 0) continue
    const region: Region = {
      area: 0,
      minX: width,
      maxX: 0,
      minY: height,
      maxY: 0,
      sumX: 0,
      sumY: 0,
    }
    head = 0
    tail = 0
    seen[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = (index - x) / width
      region.area++
      region.sumX += x
      region.sumY += y
      if (x < region.minX) region.minX = x
      if (x > region.maxX) region.maxX = x
      if (y < region.minY) region.minY = y
      if (y > region.maxY) region.maxY = y

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ]
      for (const next of neighbours) {
        if (next < 0) continue
        if (mask[next] === 0 && seen[next] === 0) {
          seen[next] = 1
          queue[tail++] = next
        }
      }
    }
    regions.push(region)
  }
  return regions
}

/**
 * Finds the drawn drums in one camera frame.
 *
 * Results are sorted by area, largest first – on a drawn kit the bass drum is
 * almost always the biggest shape. That is a convention, not a measurement,
 * and the caller is expected to let the player change the assignment.
 */
export function detectPaperDrums(
  image: {
    data: Uint8ClampedArray | Uint8Array
    width: number
    height: number
  },
  options: DetectOptions = {},
): DetectedDrum[] {
  const settings = { ...DEFAULTS, ...options }
  const gray = toGray(image)
  const mask = inkMask(gray, settings)
  const regions = enclosedRegions(mask, gray.width, gray.height)

  const frameArea = gray.width * gray.height
  const drums: DetectedDrum[] = []

  for (const region of regions) {
    const ratio = region.area / frameArea
    if (ratio < settings.minAreaRatio || ratio > settings.maxAreaRatio) continue

    const boxWidth = region.maxX - region.minX + 1
    const boxHeight = region.maxY - region.minY + 1
    const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight)
    if (aspect < settings.minAspect) continue

    // how much of its own bounding box the shape fills: a drawn ring's hole
    // fills about π/4 of it, a smear fills much less
    const fill = region.area / (boxWidth * boxHeight)
    if (fill < 0.4) continue

    drums.push({
      xPct: region.sumX / region.area / gray.width,
      yPct: region.sumY / region.area / gray.height,
      radiusPct: (boxWidth + boxHeight) / 4 / gray.width,
      area: region.area,
      roundness: Number(
        (aspect * Math.min(1, fill / (Math.PI / 4))).toFixed(3),
      ),
    })
  }

  return drums.sort((a, b) => b.area - a.area).slice(0, settings.maxResults)
}

/** Sounds handed out to detected shapes, biggest first. */
export const PAPER_DRUM_ORDER = ["kick", "snare", "hihat", "tom", "clap"]

export interface PaperZone {
  id: string
  label: string
  xPct: number
  yPct: number
  radiusPct: number
}

/**
 * Detected shapes as jam-room zones.
 *
 * The camera picture is mirrored on screen (`scaleX(-1)`), so a shape on the
 * left of the frame is drawn on the right of the stage. Getting this wrong
 * means the drums answer to the wrong hand, which is worse than not detecting
 * them at all.
 */
export function drumsToZones(
  drums: DetectedDrum[],
  options: { mirrored?: boolean } = {},
): PaperZone[] {
  const mirrored = options.mirrored !== false
  return drums.slice(0, PAPER_DRUM_ORDER.length).map((drum, index) => {
    const id = PAPER_DRUM_ORDER[index]
    return {
      id,
      label: id.toUpperCase(),
      xPct: (mirrored ? 1 - drum.xPct : drum.xPct) * 100,
      yPct: drum.yPct * 100,
      radiusPct: drum.radiusPct * 100,
    }
  })
}
