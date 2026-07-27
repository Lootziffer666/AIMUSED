import { describe, expect, it } from "vitest"
import {
  detectPaperDrums,
  drumsToZones,
  enclosedRegions,
  inkMask,
  PAPER_DRUM_ORDER,
  toGray,
} from "./paperDrums"

/**
 * The fixtures are drawings: rings, squares and open arcs painted into an RGBA
 * buffer, with the kind of uneven lighting a phone actually produces over a
 * sheet of paper. Nothing here mocks the detector – it sees pixels.
 */

interface Canvas {
  data: Uint8ClampedArray
  width: number
  height: number
}

function sheet(
  width: number,
  height: number,
  options: { gradient?: boolean } = {},
): Canvas {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // paper is bright, and one corner is always darker than the other
      const shade = options.gradient
        ? 235 - Math.round((x / width) * 70 + (y / height) * 40)
        : 240
      const offset = (y * width + x) * 4
      data[offset] = shade
      data[offset + 1] = shade
      data[offset + 2] = shade
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

function pen(canvas: Canvas, x: number, y: number, ink = 30) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const offset = (Math.round(y) * canvas.width + Math.round(x)) * 4
  canvas.data[offset] = ink
  canvas.data[offset + 1] = ink
  canvas.data[offset + 2] = ink
}

/** A hand-drawn ring: wobbly radius, thick stroke, optionally left open. */
function drawRing(
  canvas: Canvas,
  cx: number,
  cy: number,
  radius: number,
  options: { wobble?: number; thickness?: number; gapDegrees?: number } = {},
) {
  const { wobble = 0, thickness = 2, gapDegrees = 0 } = options
  const steps = Math.max(360, Math.round(radius * 24))
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    if (gapDegrees > 0 && (angle * 180) / Math.PI < gapDegrees) continue
    const wobbled = radius + Math.sin(angle * 5) * wobble
    for (let t = 0; t < thickness; t++) {
      pen(
        canvas,
        cx + Math.cos(angle) * (wobbled + t),
        cy + Math.sin(angle) * (wobbled + t),
      )
    }
  }
}

function drawBox(
  canvas: Canvas,
  cx: number,
  cy: number,
  half: number,
  thickness = 2,
) {
  for (let t = 0; t < thickness; t++) {
    for (let d = -half; d <= half; d++) {
      pen(canvas, cx + d, cy - half - t)
      pen(canvas, cx + d, cy + half + t)
      pen(canvas, cx - half - t, cy + d)
      pen(canvas, cx + half + t, cy + d)
    }
  }
}

describe("toGray", () => {
  it("keeps paper bright and ink dark", () => {
    const canvas = sheet(8, 8)
    pen(canvas, 4, 4, 10)
    const gray = toGray(canvas)
    expect(gray.data[0]).toBeGreaterThan(200)
    expect(gray.data[4 * 8 + 4]).toBeLessThan(50)
  })
})

describe("inkMask", () => {
  it("survives a lighting gradient a global threshold would not", () => {
    const canvas = sheet(120, 120, { gradient: true })
    // one stroke in the bright corner, one in the dark corner
    drawRing(canvas, 30, 30, 12)
    drawRing(canvas, 90, 90, 12)
    const mask = inkMask(toGray(canvas))

    const inkNear = (cx: number, cy: number) => {
      let count = 0
      for (let y = cy - 16; y <= cy + 16; y++) {
        for (let x = cx - 16; x <= cx + 16; x++) {
          if (mask[y * 120 + x] === 1) count++
        }
      }
      return count
    }
    // the darkest paper is darker than the brightest ink, so both strokes can
    // only be found by comparing each pixel to its own surroundings
    expect(inkNear(30, 30)).toBeGreaterThan(20)
    expect(inkNear(90, 90)).toBeGreaterThan(20)
  })

  it("finds no ink on a blank sheet", () => {
    const mask = inkMask(toGray(sheet(60, 60, { gradient: true })))
    expect(mask.reduce((sum, v) => sum + v, 0)).toBe(0)
  })
})

describe("enclosedRegions", () => {
  it("finds the hole inside a closed ring and nothing outside it", () => {
    const canvas = sheet(100, 100)
    drawRing(canvas, 50, 50, 20)
    const regions = enclosedRegions(inkMask(toGray(canvas)), 100, 100)
    expect(regions).toHaveLength(1)
    expect(regions[0].area).toBeGreaterThan(800) // ~π·19²
  })

  it("ignores an open arc, which encloses nothing", () => {
    const canvas = sheet(100, 100)
    drawRing(canvas, 50, 50, 20, { gapDegrees: 60 })
    expect(enclosedRegions(inkMask(toGray(canvas)), 100, 100)).toHaveLength(0)
  })
})

describe("detectPaperDrums", () => {
  it("finds three drawn drums and orders them by size", () => {
    const canvas = sheet(240, 180, { gradient: true })
    drawRing(canvas, 60, 120, 28, { wobble: 2, thickness: 3 }) // big: kick
    drawRing(canvas, 130, 80, 20, { wobble: 2, thickness: 2 }) // snare
    drawRing(canvas, 195, 110, 14, { wobble: 1, thickness: 2 }) // hihat

    const drums = detectPaperDrums(canvas)
    expect(drums).toHaveLength(3)
    expect(drums[0].area).toBeGreaterThan(drums[1].area)
    expect(drums[1].area).toBeGreaterThan(drums[2].area)

    // centres land on the drawn centres
    expect(drums[0].xPct).toBeCloseTo(60 / 240, 1)
    expect(drums[0].yPct).toBeCloseTo(120 / 180, 1)
    expect(drums[0].radiusPct).toBeGreaterThan(0.08)
  })

  it("accepts a square, because children do not only draw circles", () => {
    const canvas = sheet(160, 160)
    drawBox(canvas, 80, 80, 30)
    const drums = detectPaperDrums(canvas)
    expect(drums).toHaveLength(1)
    expect(drums[0].xPct).toBeCloseTo(0.5, 1)
    expect(drums[0].roundness).toBeGreaterThan(0.7)
  })

  it("ignores strokes that enclose nothing", () => {
    const canvas = sheet(160, 160)
    drawRing(canvas, 80, 80, 30, { gapDegrees: 50 })
    for (let x = 20; x < 140; x++) pen(canvas, x, 20) // a stray line
    expect(detectPaperDrums(canvas)).toHaveLength(0)
  })

  it("ignores a shape that fills the whole sheet", () => {
    const canvas = sheet(120, 120)
    drawBox(canvas, 60, 60, 55)
    expect(detectPaperDrums(canvas)).toHaveLength(0)
  })

  it("ignores specks of dirt", () => {
    const canvas = sheet(200, 200)
    drawRing(canvas, 100, 100, 30)
    drawRing(canvas, 20, 20, 2) // a dot
    const drums = detectPaperDrums(canvas)
    expect(drums).toHaveLength(1)
  })

  it("finds nothing on a blank sheet instead of inventing drums", () => {
    expect(detectPaperDrums(sheet(120, 120, { gradient: true }))).toEqual([])
  })

  it("returns at most the requested number", () => {
    const canvas = sheet(400, 200)
    for (let i = 0; i < 6; i++) drawRing(canvas, 40 + i * 60, 100, 18)
    expect(detectPaperDrums(canvas, { maxResults: 3 })).toHaveLength(3)
  })
})

describe("drumsToZones", () => {
  const drums = [
    { xPct: 0.2, yPct: 0.6, radiusPct: 0.12, area: 900, roundness: 0.9 },
    { xPct: 0.5, yPct: 0.4, radiusPct: 0.09, area: 500, roundness: 0.9 },
  ]

  it("mirrors x, because the camera picture is mirrored on screen", () => {
    const [first] = drumsToZones(drums)
    expect(first.xPct).toBeCloseTo(80, 5)
    expect(first.yPct).toBeCloseTo(60, 5)
  })

  it("can be told not to mirror", () => {
    const [first] = drumsToZones(drums, { mirrored: false })
    expect(first.xPct).toBeCloseTo(20, 5)
  })

  it("hands out the sounds biggest first", () => {
    const zones = drumsToZones(drums)
    expect(zones.map((z) => z.id)).toEqual(PAPER_DRUM_ORDER.slice(0, 2))
  })

  it("never produces more zones than there are sounds", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...drums[0],
      area: 1000 - i,
    }))
    expect(drumsToZones(many)).toHaveLength(PAPER_DRUM_ORDER.length)
  })
})
