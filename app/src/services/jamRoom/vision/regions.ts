/**
 * Connected regions in a binary mask.
 *
 * Two questions get asked of a camera frame, and both are the same scan with
 * the polarity swapped:
 *
 * - *what did the ink enclose* – background that the border cannot reach, which
 *   is how a drawn drum is found (see `paperDrums.ts`)
 * - *what is the ink itself* – solid blobs, which is how the black keys of a
 *   printed keyboard are found (see `paperKeyboard.ts`)
 *
 * Both are 4-connected flood fills over a `Uint8Array` mask, so they live here
 * once instead of twice.
 */

export interface Region {
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Sum of coordinates – divide by `area` for the centroid */
  sumX: number
  sumY: number
}

export function regionWidth(region: Region): number {
  return region.maxX - region.minX + 1
}

export function regionHeight(region: Region): number {
  return region.maxY - region.minY + 1
}

export function centroidX(region: Region): number {
  return region.sumX / region.area
}

export function centroidY(region: Region): number {
  return region.sumY / region.area
}

export interface FloodOptions {
  /** Mask value the regions are made of: 1 = ink, 0 = background */
  value?: 0 | 1
  /**
   * Drop everything the image border can reach. For background that leaves
   * exactly the enclosed holes; for ink it drops shapes running off frame.
   */
  excludeBorderConnected?: boolean
}

/**
 * All 4-connected regions of `value`, optionally without those touching the
 * border.
 */
export function floodRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  options: FloodOptions = {},
): Region[] {
  const value = options.value ?? 0
  const excludeBorder = options.excludeBorderConnected ?? false

  const OUTSIDE = 2
  const seen = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  if (excludeBorder) {
    // flood in from every border pixel first; whatever stays unseen is enclosed
    const pushIfMatching = (index: number) => {
      if (mask[index] === value && seen[index] === 0) {
        seen[index] = OUTSIDE
        queue[tail++] = index
      }
    }
    for (let x = 0; x < width; x++) {
      pushIfMatching(x)
      pushIfMatching((height - 1) * width + x)
    }
    for (let y = 0; y < height; y++) {
      pushIfMatching(y * width)
      pushIfMatching(y * width + width - 1)
    }
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = (index - x) / width
      if (x > 0) pushIfMatching(index - 1)
      if (x < width - 1) pushIfMatching(index + 1)
      if (y > 0) pushIfMatching(index - width)
      if (y < height - 1) pushIfMatching(index + width)
    }
  }

  const regions: Region[] = []
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || seen[start] !== 0) continue
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
        if (mask[next] === value && seen[next] === 0) {
          seen[next] = 1
          queue[tail++] = next
        }
      }
    }
    regions.push(region)
  }
  return regions
}
