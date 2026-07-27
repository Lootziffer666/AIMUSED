import type {
  InstrumentLibraryManifest,
  InstrumentPatch,
} from "@signal-app/tonemap-core"
import { createLibraryManifest } from "@signal-app/tonemap-core"

/**
 * The library MUSE can always play: the SoundFont that is already loaded.
 *
 * It exists so ranking works before anyone has installed a sample library –
 * not because a program number means anything. The program is a *locator*
 * (`soundFontPreset`), the family, range and articulation are the semantics,
 * and no timbre is stated because none was measured. The ranker says
 * "family default" for those, which is exactly what it is.
 */

const patch = (
  id: string,
  displayName: string,
  family: InstrumentPatch["family"],
  instrument: string,
  program: number,
  lowMidi: number,
  highMidi: number,
  preferred: [number, number],
  articulation: InstrumentPatch["articulation"] = "sustain",
): InstrumentPatch => ({
  id,
  displayName,
  family,
  instrument,
  articulation,
  range: {
    lowMidi,
    highMidi,
    preferredLowMidi: preferred[0],
    preferredHighMidi: preferred[1],
  },
  soundFontPreset: { bank: 0, program },
  knownLimitations: [
    "single sampled layer, no dynamic layers and no round robins",
  ],
})

const PATCHES: InstrumentPatch[] = [
  patch("piano", "Piano", "keys", "piano", 0, 21, 108, [36, 96]),
  patch(
    "e-piano",
    "Electric Piano",
    "keys",
    "electric-piano",
    4,
    28,
    103,
    [40, 91],
  ),
  patch("guitar", "Guitar", "plucked", "guitar", 24, 40, 88, [45, 81], "pluck"),
  patch(
    "bass",
    "Bass",
    "plucked",
    "bass-guitar",
    33,
    28,
    67,
    [31, 60],
    "pluck",
  ),
  patch("violin", "Violin", "strings", "violin", 40, 55, 103, [60, 93]),
  patch("cello", "Cello", "strings", "cello", 42, 36, 76, [40, 69]),
  patch(
    "strings",
    "String Ensemble",
    "strings",
    "string-section",
    48,
    28,
    100,
    [40, 88],
  ),
  patch("choir", "Choir", "choir", "choir", 52, 43, 84, [48, 79]),
  patch("trumpet", "Trumpet", "brass", "trumpet", 56, 54, 87, [58, 82]),
  patch("horn", "French Horn", "brass", "french-horn", 60, 34, 77, [41, 72]),
  patch(
    "sax",
    "Saxophone",
    "woodwinds",
    "alto-saxophone",
    65,
    49,
    84,
    [53, 80],
  ),
  patch("flute", "Flute", "woodwinds", "flute", 73, 59, 96, [62, 91]),
  patch("pad", "Synth Pad", "synth", "pad", 89, 24, 108, [36, 84]),
  patch(
    "timpani",
    "Timpani",
    "percussion",
    "timpani",
    47,
    35,
    57,
    [36, 55],
    "hit",
  ),
]

export const BUILTIN_LIBRARY_ID = "muse-soundfont"

export function createBuiltinLibrary(): InstrumentLibraryManifest {
  return createLibraryManifest({
    id: BUILTIN_LIBRARY_ID,
    name: "MUSE SoundFont",
    license: "bundled with the app",
    patches: PATCHES.map((entry) => ({
      ...entry,
      id: `${BUILTIN_LIBRARY_ID}:${entry.id}`,
    })),
  })
}
