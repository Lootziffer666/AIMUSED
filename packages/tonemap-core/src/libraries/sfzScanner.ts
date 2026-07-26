import type { Articulation, InstrumentFamily } from "../schema/tonemap.ts"
import type { InstrumentPatch } from "./manifest.ts"

/**
 * SFZ scanner.
 *
 * Reads what an SFZ file actually declares (key ranges, velocity layers,
 * round robins) instead of guessing from the file name, and derives the
 * uncertain parts – family and articulation – from path and name with an
 * explicit, reviewable keyword table. Anything it cannot know is left empty
 * and shows up in the missing-metadata report.
 */

export interface SfzFileInput {
  /** Path relative to the library root */
  path: string
  content: string
}

const FAMILY_KEYWORDS: [InstrumentFamily, string[]][] = [
  [
    "strings",
    [
      "violin",
      "viola",
      "cello",
      "contrabass",
      "double bass",
      "strings",
      "fiddle",
    ],
  ],
  [
    "woodwinds",
    [
      "flute",
      "clarinet",
      "oboe",
      "bassoon",
      "sax",
      "recorder",
      "piccolo",
      "whistle",
    ],
  ],
  [
    "brass",
    ["trumpet", "horn", "trombone", "tuba", "cornet", "brass", "euphonium"],
  ],
  [
    "percussion",
    [
      "drum",
      "snare",
      "kick",
      "cymbal",
      "timpani",
      "perc",
      "tabla",
      "shaker",
      "gong",
      "block",
    ],
  ],
  [
    "keys",
    ["piano", "rhodes", "celesta", "organ", "harpsichord", "clavinet", "keys"],
  ],
  [
    "plucked",
    [
      "guitar",
      "harp",
      "banjo",
      "mandolin",
      "lute",
      "ukulele",
      "sitar",
      "pluck",
    ],
  ],
  ["choir", ["choir", "voice", "vocal", "aah", "ooh"]],
  ["synth", ["synth", "saw", "square", "pad", "lead"]],
  ["folk", ["accordion", "bagpipe", "dulcimer", "kalimba", "ocarina"]],
]

const ARTICULATION_KEYWORDS: [Articulation, string[]][] = [
  ["pizzicato", ["pizz"]],
  ["spiccato", ["spicc"]],
  ["staccato", ["stacc", "short"]],
  ["tremolo", ["trem"]],
  ["marcato", ["marc"]],
  ["legato", ["legato", "leg"]],
  ["swell", ["swell", "cresc"]],
  ["mute", ["mute", "con sord"]],
  ["flutter", ["flutter", "flz"]],
  ["roll", ["roll"]],
  ["sustain", ["sus", "sustain", "long"]],
]

function matchKeyword<T>(
  haystack: string,
  table: [T, string[]][],
): T | undefined {
  const lower = haystack.toLowerCase()
  for (const [value, keywords] of table) {
    if (keywords.some((keyword) => lower.includes(keyword))) return value
  }
  return undefined
}

interface SfzOpcodes {
  lokey: number[]
  hikey: number[]
  key: number[]
  loveL: number[]
  seqLength: number[]
}

function parseOpcodes(content: string): SfzOpcodes {
  const stripped = content
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/<[a-z_]+>/gi, " ")
  const numbers = (name: string): number[] => {
    const matches = stripped.matchAll(
      new RegExp(`${name}\\s*=\\s*(-?[A-G]?#?-?\\d+)`, "gi"),
    )
    const values: number[] = []
    for (const match of matches) {
      const parsed = parseNoteValue(match[1])
      if (parsed !== null) values.push(parsed)
    }
    return values
  }
  return {
    lokey: numbers("lokey"),
    hikey: numbers("hikey"),
    key: numbers("key"),
    loveL: numbers("lovel"),
    seqLength: numbers("seq_length"),
  }
}

const NOTE_OFFSETS: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
}

/** SFZ allows both MIDI numbers and note names such as `c4` or `f#3`. */
export function parseNoteValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  const match = /^([a-gA-G])(#|b)?(-?\d+)$/.exec(trimmed)
  if (!match) return null
  const base = NOTE_OFFSETS[match[1].toLowerCase()]
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0
  const octave = Number(match[3])
  return (octave + 1) * 12 + base + accidental
}

export function scanSfzFile(
  file: SfzFileInput,
  libraryId: string,
): InstrumentPatch {
  const opcodes = parseOpcodes(file.content)
  const keys = [...opcodes.lokey, ...opcodes.hikey, ...opcodes.key]
  const lowMidi = keys.length > 0 ? Math.min(...keys) : 0
  const highMidi = keys.length > 0 ? Math.max(...keys) : 127

  const fileName = file.path.split("/").pop() ?? file.path
  const displayName = fileName.replace(/\.sfz$/i, "").replace(/[_-]+/g, " ")
  const family = matchKeyword(file.path, FAMILY_KEYWORDS)
  const articulation =
    matchKeyword(file.path, ARTICULATION_KEYWORDS) ?? "unknown"

  const velocityLayers =
    opcodes.loveL.length > 0 ? new Set(opcodes.loveL).size : undefined
  const roundRobins =
    opcodes.seqLength.length > 0 ? Math.max(...opcodes.seqLength) : undefined

  return {
    id: `${libraryId}:${file.path.replace(/\.sfz$/i, "")}`,
    displayName,
    family: family ?? ("other" as InstrumentFamily),
    instrument: displayName.split(/\s+/)[0].toLowerCase(),
    range: { lowMidi, highMidi },
    articulation,
    velocityLayers,
    roundRobins,
    sfzPath: file.path,
    knownLimitations:
      keys.length === 0
        ? ["no key range found in the SFZ file, assuming the full range"]
        : undefined,
  }
}

export function scanSfzLibrary(
  files: SfzFileInput[],
  libraryId: string,
): InstrumentPatch[] {
  return files
    .filter((file) => /\.sfz$/i.test(file.path))
    .map((file) => scanSfzFile(file, libraryId))
    .sort((a, b) => a.id.localeCompare(b.id))
}
