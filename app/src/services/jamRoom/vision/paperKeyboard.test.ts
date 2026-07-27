import { describe, expect, it } from "vitest"
import { inkMask, toGray } from "./paperDrums"
import {
  anchorC,
  classifyCut,
  detectPaperKeyboard,
  type KeyCut,
  keyAt,
  keyRow,
  keysToZones,
  toCandidate,
  WHITE_SEMITONES,
  whiteNote,
} from "./paperKeyboard"
import { floodRegions } from "./regions"

/**
 * The fixtures are drawings: a row of key outlines painted into an RGBA buffer,
 * with the black keys cut into the tops the way a printed keyboard has them,
 * and the uneven lighting a phone produces over a sheet of paper. Nothing here
 * mocks the detector – it sees pixels.
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
      const shade = options.gradient
        ? 235 - Math.round((x / width) * 60 + (y / height) * 30)
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

function pen(canvas: Canvas, x: number, y: number, ink = 25) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return
  const offset = (py * canvas.width + px) * 4
  canvas.data[offset] = ink
  canvas.data[offset + 1] = ink
  canvas.data[offset + 2] = ink
}

function fillRect(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) pen(canvas, x, y)
  }
}

function strokeRect(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness = 2,
) {
  for (let t = 0; t < thickness; t++) {
    for (let x = x0; x <= x1; x++) {
      pen(canvas, x, y0 + t)
      pen(canvas, x, y1 - t)
    }
    for (let y = y0; y <= y1; y++) {
      pen(canvas, x0 + t, y)
      pen(canvas, x1 - t, y)
    }
  }
}

/** Which white keys of an octave carry a black key on their right. */
const BLACK_ON_RIGHT = [true, true, false, true, true, true, false] // C D _ F G A _

/**
 * A printed keyboard: `count` white keys starting at the white key `startWhite`
 * of an octave (0 = C), with the black keys filled in on top.
 */
function drawKeyboard(
  canvas: Canvas,
  options: {
    x?: number
    y?: number
    keyWidth?: number
    keyHeight?: number
    count?: number
    startWhite?: number
    withBlackKeys?: boolean
  } = {},
) {
  const {
    x = 20,
    y = 30,
    keyWidth = 22,
    keyHeight = 90,
    count = 14,
    startWhite = 0,
    withBlackKeys = true,
  } = options

  for (let i = 0; i < count; i++) {
    const left = x + i * keyWidth
    strokeRect(canvas, left, y, left + keyWidth, y + keyHeight)
  }
  if (!withBlackKeys) return

  const blackWidth = Math.round(keyWidth * 0.6)
  const blackHeight = Math.round(keyHeight * 0.6)
  for (let i = 0; i < count - 1; i++) {
    const degree = (startWhite + i) % 7
    if (!BLACK_ON_RIGHT[degree]) continue
    const boundary = x + (i + 1) * keyWidth
    fillRect(
      canvas,
      boundary - Math.round(blackWidth / 2),
      y,
      boundary + Math.round(blackWidth / 2),
      y + blackHeight,
    )
  }
}

function candidatesOf(canvas: Canvas) {
  const gray = toGray(canvas)
  const mask = inkMask(gray)
  return floodRegions(mask, gray.width, gray.height, {
    value: 0,
    excludeBorderConnected: true,
  }).map(toCandidate)
}

describe("whiteNote", () => {
  it("walks the white keys of an octave and then the next", () => {
    expect(WHITE_SEMITONES).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => whiteNote(60, s))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ])
  })

  it("walks backwards below C as well", () => {
    expect([-1, -2, -7].map((s) => whiteNote(60, s))).toEqual([59, 57, 48])
  })
})

describe("anchorC", () => {
  const octave: KeyCut[] = [
    "right", // C
    "both", // D
    "left", // E
    "right", // F
    "both", // G
    "both", // A
    "left", // B
  ]

  it("finds C from the three-key group", () => {
    expect(anchorC(octave)).toBe(0)
  })

  it("finds C from the four-key group when the row starts mid-octave", () => {
    // F G A B C D E
    expect(anchorC([...octave.slice(3), ...octave.slice(0, 3)])).toBe(4)
  })

  it("gives up rather than guessing on a row without cut-outs", () => {
    expect(anchorC(["none", "none", "none", "none", "none"])).toBeNull()
  })

  it("gives up on a fragment too short to be unique", () => {
    expect(anchorC(["both", "left"])).toBeNull()
  })
})

describe("classifyCut", () => {
  it("reads the cut side off a drawn keyboard", () => {
    const canvas = sheet(360, 160)
    drawKeyboard(canvas, { count: 7, startWhite: 0 })
    const row = keyRow(candidatesOf(canvas))
    expect(row).toHaveLength(7)
    expect(row.map((c) => classifyCut(c))).toEqual([
      "right",
      "both",
      "left",
      "right",
      "both",
      "both",
      "left",
    ])
  })

  it("calls a plain box uncut", () => {
    const canvas = sheet(200, 160)
    drawKeyboard(canvas, { count: 5, withBlackKeys: false })
    const row = keyRow(candidatesOf(canvas))
    expect(row.map((c) => classifyCut(c))).toEqual([
      "none",
      "none",
      "none",
      "none",
      "none",
    ])
  })
})

describe("keyRow", () => {
  it("keeps the row and drops a shape that only happens to be nearby", () => {
    const canvas = sheet(400, 220)
    drawKeyboard(canvas, { count: 8, withBlackKeys: false })
    // a tall thin box far above the row
    strokeRect(canvas, 300, 5, 322, 20)
    const row = keyRow(candidatesOf(canvas))
    expect(row).toHaveLength(8)
  })

  it("returns nothing for an empty frame", () => {
    expect(keyRow([])).toEqual([])
  })
})

describe("detectPaperKeyboard", () => {
  it("finds a printed keyboard and anchors the octave on the black keys", () => {
    const canvas = sheet(400, 200, { gradient: true })
    drawKeyboard(canvas, { count: 14, startWhite: 0 })

    const keyboard = detectPaperKeyboard(canvas)
    expect(keyboard).not.toBeNull()
    if (!keyboard) return

    expect(keyboard.anchored).toBe(true)
    const whites = keyboard.keys.filter((k) => !k.black)
    expect(whites).toHaveLength(14)
    expect(whites.map((k) => k.noteNumber).slice(0, 8)).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ])
    // keys run left to right
    expect(whites[0].xPct).toBeLessThan(whites[13].xPct)
  })

  it("anchors a row that does not start on C", () => {
    const canvas = sheet(400, 200)
    drawKeyboard(canvas, { count: 11, startWhite: 3 }) // starts on F

    const keyboard = detectPaperKeyboard(canvas)
    expect(keyboard?.anchored).toBe(true)
    // F is a fourth below the C the anchor hands out
    expect(keyboard?.baseNote).toBe(53)
  })

  it("hands out black keys only where the paper shows one", () => {
    const canvas = sheet(400, 200)
    drawKeyboard(canvas, { count: 8, startWhite: 0 })

    const keyboard = detectPaperKeyboard(canvas)
    const blacks = keyboard?.keys.filter((k) => k.black) ?? []
    // C# D# F# G# A# between eight white keys
    expect(blacks.map((k) => k.noteNumber)).toEqual([61, 63, 66, 68, 70])
    expect(
      blacks.every((k) => k.heightPct < (keyboard?.keys[0].heightPct ?? 0)),
    ).toBe(true)
  })

  it("says so instead of guessing when there are no black keys", () => {
    const canvas = sheet(400, 200)
    drawKeyboard(canvas, { count: 8, withBlackKeys: false })

    const keyboard = detectPaperKeyboard(canvas)
    expect(keyboard).not.toBeNull()
    expect(keyboard?.anchored).toBe(false)
    expect(keyboard?.keys.some((k) => k.black)).toBe(false)
    // leftmost becomes C, and the confidence stays visibly below an anchored one
    expect(keyboard?.baseNote).toBe(60)
    expect(keyboard?.confidence).toBeLessThan(0.6)
  })

  it("is more confident about an anchored keyboard than an unanchored one", () => {
    const anchored = sheet(400, 200)
    drawKeyboard(anchored, { count: 14, startWhite: 0 })
    const plain = sheet(400, 200)
    drawKeyboard(plain, { count: 14, withBlackKeys: false })

    const a = detectPaperKeyboard(anchored)?.confidence ?? 0
    const b = detectPaperKeyboard(plain)?.confidence ?? 0
    expect(a).toBeGreaterThan(b)
  })

  it("finds nothing on a blank sheet", () => {
    expect(detectPaperKeyboard(sheet(300, 200, { gradient: true }))).toBeNull()
  })

  it("finds nothing in a handful of circles", () => {
    const canvas = sheet(300, 200)
    for (const cx of [60, 150, 240]) {
      for (let a = 0; a < 720; a++) {
        const angle = (a / 720) * Math.PI * 2
        pen(canvas, cx + Math.cos(angle) * 25, 100 + Math.sin(angle) * 25)
        pen(canvas, cx + Math.cos(angle) * 26, 100 + Math.sin(angle) * 26)
      }
    }
    expect(detectPaperKeyboard(canvas)).toBeNull()
  })

  it("refuses a row that is too short to be a keyboard", () => {
    const canvas = sheet(300, 200)
    drawKeyboard(canvas, { count: 3, withBlackKeys: false })
    expect(detectPaperKeyboard(canvas)).toBeNull()
  })
})

describe("keysToZones", () => {
  const keyboard = {
    keys: [
      {
        index: 0,
        noteNumber: 60,
        black: false,
        xPct: 0.1,
        yPct: 0.2,
        widthPct: 0.05,
        heightPct: 0.4,
      },
      {
        index: 0,
        noteNumber: 61,
        black: true,
        xPct: 0.13,
        yPct: 0.2,
        widthPct: 0.03,
        heightPct: 0.24,
      },
    ],
    anchored: true,
    confidence: 0.9,
    baseNote: 60,
  }

  it("mirrors x, because the camera picture is mirrored on screen", () => {
    const [white] = keysToZones(keyboard)
    // the right edge becomes the left edge
    expect(white.xPct).toBeCloseTo(85, 5)
    expect(white.widthPct).toBeCloseTo(5, 5)
  })

  it("can be told not to mirror, for the rear camera", () => {
    const [white] = keysToZones(keyboard, { mirrored: false })
    expect(white.xPct).toBeCloseTo(10, 5)
  })

  it("puts the black key on top, where a finger between two keys lands", () => {
    const zones = keysToZones(keyboard, { mirrored: false })
    expect(keyAt(zones, 14, 30)?.noteNumber).toBe(61)
    // below the black key the white one answers again
    expect(keyAt(zones, 14, 55)?.noteNumber).toBe(60)
    expect(keyAt(zones, 90, 30)).toBeUndefined()
  })
})
