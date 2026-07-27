/**
 * Recognising a piano keyboard printed or drawn on paper.
 *
 * Same starting point as the paper drums: a drawn key is a closed outline, so
 * the white keys are the **holes the ink encloses**. What makes a keyboard
 * different from five drums is that the holes come in a *row* – many shapes of
 * almost the same size and height, standing side by side. That row is the
 * signal; a stray circle next to it is not part of it and drops out.
 *
 * The harder question is which key is C. Guessing "the leftmost one" would be a
 * coin toss, and a keyboard transposed by a random amount is worse than no
 * keyboard. So the octave is anchored on the black keys – but *without* looking
 * for black shapes, which on a printed keyboard merge into the outline and on a
 * hand-drawn one may not be filled at all.
 *
 * Instead the white keys give it away by their own shape. A key with a black
 * key cut into its top right carries less mass on the right, so its centroid
 * sits left of its bounding box; cut on the left, it sits right; cut on both
 * sides it stays centred but loses area. Read left/centre/right off the row and
 * the pattern `C D E` (left, centre, right) and `F G A B` (left, centre,
 * centre, right) falls out. That needs no template and no filled ink.
 *
 * When the drawing has no cut-outs at all – a row of plain boxes, which is what
 * a child draws – nothing is anchored. Then the leftmost key becomes C and the
 * result says so: `anchored: false` and a markedly lower confidence. A guess
 * that is labelled a guess is usable; one that is not is a trap.
 *
 * Everything here is a pure function over pixel data, so it is testable without
 * a camera.
 */

import { inkMask, toGray } from "./paperDrums"
import {
  centroidX,
  centroidY,
  floodRegions,
  type Region,
  regionHeight,
  regionWidth,
} from "./regions"

/** Semitones of the white keys inside one octave, starting at C. */
export const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

/** Which side of a white key a black key is cut into. */
export type KeyCut = "left" | "right" | "both" | "none"

export interface PaperKey {
  /** Position in the row, left to right, white keys only */
  index: number
  noteNumber: number
  black: boolean
  /** Bounding box as fractions of the frame */
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export interface PaperKeyboard {
  keys: PaperKey[]
  /** True when the black-key cut-outs decided where C is */
  anchored: boolean
  /** 0…1 – deliberately never 1 without an anchor */
  confidence: number
  /** Lowest note handed out */
  baseNote: number
}

export interface KeyboardOptions {
  /** Side of the local mean window used for thresholding, in pixels */
  windowSize?: number
  /** How much darker than its surroundings a pixel has to be to count as ink */
  threshold?: number
  /** Fewest white keys that still count as a keyboard */
  minKeys?: number
  /** Smallest white key, as a fraction of the frame */
  minAreaRatio?: number
  /** Largest, so the sheet's own border is not a key */
  maxAreaRatio?: number
  /** A white key is taller than it is wide; below this it is something else */
  minHeightRatio?: number
  /** Note the anchored C gets */
  baseC?: number
  /** Centroid offset that counts as "cut on one side", in key widths */
  cutOffset?: number
  /** Box fill below which a key counts as cut on both sides */
  cutFill?: number
}

const DEFAULTS: Required<KeyboardOptions> = {
  windowSize: 25,
  threshold: 12,
  minKeys: 5,
  minAreaRatio: 0.0015,
  maxAreaRatio: 0.25,
  minHeightRatio: 1.2,
  baseC: 60,
  cutOffset: 0.03,
  cutFill: 0.92,
}

export interface Candidate {
  region: Region
  width: number
  height: number
  cx: number
  cy: number
  fill: number
  /** Centroid offset from the box centre, in key widths */
  offset: number
}

export function toCandidate(region: Region): Candidate {
  const width = regionWidth(region)
  const height = regionHeight(region)
  const cx = centroidX(region)
  return {
    region,
    width,
    height,
    cx,
    cy: centroidY(region),
    fill: region.area / (width * height),
    offset: (cx - (region.minX + region.maxX) / 2) / width,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * The largest set of candidates that stand side by side at the same height.
 *
 * Seeded from the tallest candidate, because on a keyboard the white keys are
 * the tallest enclosed shapes and a seed that is itself a key needs no second
 * pass.
 */
export function keyRow(candidates: Candidate[]): Candidate[] {
  if (candidates.length === 0) return []
  const seed = candidates.reduce((a, b) => (b.height > a.height ? b : a))
  const row = candidates.filter((candidate) => {
    // same height class …
    const ratio = candidate.height / seed.height
    if (ratio < 0.7 || ratio > 1.4) return false
    // … and standing on the same line
    return Math.abs(candidate.cy - seed.cy) < seed.height * 0.5
  })
  if (row.length === 0) return []

  // a key that is far wider or narrower than its neighbours is not a key
  const widths = median(row.map((c) => c.width))
  return row
    .filter((c) => c.width > widths * 0.55 && c.width < widths * 1.8)
    .sort((a, b) => a.region.minX - b.region.minX)
}

/** Which side, if any, a black key ate into. */
export function classifyCut(
  candidate: Candidate,
  options: KeyboardOptions = {},
): KeyCut {
  const { cutOffset, cutFill } = { ...DEFAULTS, ...options }
  // mass pulled left means the right shoulder is missing, and the other way round
  if (candidate.offset < -cutOffset) return "right"
  if (candidate.offset > cutOffset) return "left"
  return candidate.fill < cutFill ? "both" : "none"
}

/**
 * Index of the **first** C in the row, from the cut pattern – or `null` when
 * the drawing has no cut-outs to read.
 *
 * Inside an octave the cuts read `C D E` = right, both, left and
 * `F G A B` = right, both, both, left. Neither sequence occurs anywhere else,
 * so a single match anchors the whole row. Every C is congruent to every other
 * modulo seven white keys, so the match is folded back to the first one and a
 * long row always comes out at the same octave.
 */
export function anchorC(cuts: KeyCut[]): number | null {
  for (let i = 0; i + 3 < cuts.length; i++) {
    if (
      cuts[i] === "right" &&
      cuts[i + 1] === "both" &&
      cuts[i + 2] === "both" &&
      cuts[i + 3] === "left"
    ) {
      // F G A B – the next white key after B is C
      return (i + 4) % 7
    }
  }
  for (let i = 0; i + 2 < cuts.length; i++) {
    if (
      cuts[i] === "right" &&
      cuts[i + 1] === "both" &&
      cuts[i + 2] === "left"
    ) {
      return i % 7 // C D E
    }
  }
  return null
}

/** MIDI note of the white key `steps` white keys away from C. */
export function whiteNote(baseC: number, steps: number): number {
  const octave = Math.floor(steps / 7)
  const degree = ((steps % 7) + 7) % 7
  return baseC + octave * 12 + WHITE_SEMITONES[degree]
}

/**
 * Finds a printed or drawn keyboard in one camera frame.
 *
 * Returns `null` when there is no row of keys – finding nothing is a valid and
 * frequent answer, and better than turning three coffee stains into an octave.
 */
export function detectPaperKeyboard(
  image: {
    data: Uint8ClampedArray | Uint8Array
    width: number
    height: number
  },
  options: KeyboardOptions = {},
): PaperKeyboard | null {
  const settings = { ...DEFAULTS, ...options }
  const gray = toGray(image)
  const mask = inkMask(gray, settings)
  const frameArea = gray.width * gray.height

  const candidates = floodRegions(mask, gray.width, gray.height, {
    value: 0,
    excludeBorderConnected: true,
  })
    .map(toCandidate)
    .filter((candidate) => {
      const ratio = candidate.region.area / frameArea
      if (ratio < settings.minAreaRatio || ratio > settings.maxAreaRatio) {
        return false
      }
      return candidate.height / candidate.width >= settings.minHeightRatio
    })

  const row = keyRow(candidates)
  if (row.length < settings.minKeys) return null

  const cuts = row.map((candidate) => classifyCut(candidate, settings))
  const anchor = anchorC(cuts)
  const cIndex = anchor ?? 0

  const keys: PaperKey[] = row.map((candidate, index) => ({
    index,
    noteNumber: whiteNote(settings.baseC, index - cIndex),
    black: false,
    xPct: candidate.region.minX / gray.width,
    yPct: candidate.region.minY / gray.height,
    widthPct: candidate.width / gray.width,
    heightPct: candidate.height / gray.height,
  }))

  // A black key is only handed out where the paper actually shows one: both
  // neighbours have to be cut towards each other, and the pitches have to leave
  // room. Inventing the missing sharps would put keys where there is nothing to
  // press.
  const blacks: PaperKey[] = []
  for (let i = 0; i + 1 < row.length; i++) {
    const cutOnItsRight = cuts[i] === "right" || cuts[i] === "both"
    const cutOnItsLeft = cuts[i + 1] === "left" || cuts[i + 1] === "both"
    if (!cutOnItsRight || !cutOnItsLeft) continue
    const gap = keys[i + 1].noteNumber - keys[i].noteNumber
    if (gap !== 2) continue
    const boundary = (row[i].region.maxX + row[i + 1].region.minX) / 2
    const width = ((row[i].width + row[i + 1].width) / 2) * 0.6
    blacks.push({
      index: i,
      noteNumber: keys[i].noteNumber + 1,
      black: true,
      xPct: (boundary - width / 2) / gray.width,
      yPct: keys[i].yPct,
      widthPct: width / gray.width,
      heightPct: keys[i].heightPct * 0.6,
    })
  }

  // width consistency says how much the row looks like a keyboard rather than
  // like a set of shapes that happen to line up
  const widths = row.map((c) => c.width)
  const middle = median(widths)
  const spread =
    widths.reduce((sum, w) => sum + Math.abs(w - middle), 0) /
    widths.length /
    middle
  const evenness = Math.max(0, 1 - spread * 3)
  const size = Math.min(1, row.length / 14)
  // Without an anchor the pitches are a guess, however clean the row looks, so
  // an unanchored reading is capped well below a certain one on purpose.
  const ceiling = anchor !== null ? 1 : 0.6
  const confidence = Number(
    Math.min(
      ceiling,
      (anchor !== null ? 0.6 : 0.2) + evenness * 0.25 + size * 0.15,
    ).toFixed(3),
  )

  return {
    keys: [...keys, ...blacks],
    anchored: anchor !== null,
    confidence,
    baseNote: keys[0].noteNumber,
  }
}

export interface KeyZone {
  id: string
  noteNumber: number
  black: boolean
  /** Percent of the stage, left edge and top edge */
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

/**
 * Detected keys as jam-room zones.
 *
 * The front camera picture is mirrored on screen, so a key on the left of the
 * frame is under the player's right hand. Getting this wrong plays the whole
 * keyboard back to front, which is worse than not finding it.
 */
export function keysToZones(
  keyboard: PaperKeyboard,
  options: { mirrored?: boolean } = {},
): KeyZone[] {
  const mirrored = options.mirrored !== false
  return keyboard.keys.map((key) => ({
    id: `${key.black ? "black" : "white"}-${key.noteNumber}`,
    noteNumber: key.noteNumber,
    black: key.black,
    xPct: (mirrored ? 1 - key.xPct - key.widthPct : key.xPct) * 100,
    yPct: key.yPct * 100,
    widthPct: key.widthPct * 100,
    heightPct: key.heightPct * 100,
  }))
}

/** The zone under a point, black keys first because they lie on top. */
export function keyAt(
  zones: KeyZone[],
  xPct: number,
  yPct: number,
): KeyZone | undefined {
  const hit = (zone: KeyZone) =>
    xPct >= zone.xPct &&
    xPct <= zone.xPct + zone.widthPct &&
    yPct >= zone.yPct &&
    yPct <= zone.yPct + zone.heightPct
  return zones.find((z) => z.black && hit(z)) ?? zones.find(hit)
}
