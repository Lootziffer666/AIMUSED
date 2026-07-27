/**
 * Playing the piano on the computer keyboard.
 *
 * The mapping is the one trackers and DAWs have used for decades: the bottom
 * letter row is one octave of white keys with the row above it carrying the
 * black ones, and the same again starting on `Q`. Two octaves under ten
 * fingers without moving a hand.
 *
 * Keys are addressed by `KeyboardEvent.code`, not by `key`. `code` is the
 * *physical* key, so the layout is the same shape on QWERTZ and AZERTY as on
 * QWERTY – the note under a finger does not move because someone switched
 * language. The printed letter is a separate question, answered by
 * `labelForCode` with the real keyboard layout where the browser exposes it.
 */

/** Semitones above the base C, by physical key. */
export const KEY_SEMITONES: Readonly<Record<string, number>> = {
  // lower octave: Z row white, S row black
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyL: 13,
  Period: 14,
  Semicolon: 15,
  Slash: 16,
  // upper octave: Q row white, number row black
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
  Digit9: 25,
  KeyO: 26,
  Digit0: 27,
  KeyP: 28,
  BracketLeft: 29,
  BracketRight: 30,
}

/** What the key says on a US keyboard – the fallback when nothing better exists. */
const US_LABELS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
}

export function semitoneForCode(code: string): number | undefined {
  return KEY_SEMITONES[code]
}

/**
 * Note a physical key plays, or `undefined` when the key is not part of the
 * piano.
 */
export function noteForCode(
  code: string,
  baseNote: number,
): number | undefined {
  const semitone = KEY_SEMITONES[code]
  if (semitone === undefined) return undefined
  const note = baseNote + semitone
  return note >= 0 && note <= 127 ? note : undefined
}

/**
 * The letter printed on a key.
 *
 * `navigator.keyboard.getLayoutMap()` knows the truth and is the only way to
 * avoid telling a German player to press `Z` for a key that says `Y`. Where it
 * is missing, the US letter is shown – wrong for some layouts, but a label is
 * still more use than a blank key, and the *position* is right either way.
 */
export function labelForCode(
  code: string,
  layout?: ReadonlyMap<string, string> | null,
): string {
  const fromLayout = layout?.get(code)
  if (fromLayout) return fromLayout.toUpperCase()
  const punctuation = US_LABELS[code]
  if (punctuation) return punctuation
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  return ""
}

/** Every physical key that plays a note, lowest first – used to label the keys. */
export function codesByNote(baseNote: number): Map<number, string> {
  const map = new Map<number, string>()
  for (const [code, semitone] of Object.entries(KEY_SEMITONES)) {
    const note = baseNote + semitone
    // the two rows overlap by an octave; the first one wins, so the lower row
    // keeps the octave it starts in and the labels do not jump around
    if (!map.has(note)) map.set(note, code)
  }
  return map
}

/**
 * Reads the real key labels when the browser offers them.
 *
 * Chromium-only today; everything else gets `null` and the US fallback.
 */
export async function readKeyboardLayout(): Promise<Map<
  string,
  string
> | null> {
  const api = (
    navigator as Navigator & {
      keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> }
    }
  ).keyboard
  if (!api?.getLayoutMap) return null
  try {
    return await api.getLayoutMap()
  } catch {
    return null
  }
}

const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10])

export function isBlackKey(noteNumber: number): boolean {
  return BLACK_SEMITONES.has(((noteNumber % 12) + 12) % 12)
}

/**
 * The white keys of a range, and for each the black key that follows it.
 *
 * The piano is drawn from this: white keys are laid out in a row, and a black
 * key hangs over the seam to the next white one. There is no black key after E
 * and B, which is the whole reason a keyboard looks the way it does.
 */
export function keyLayout(
  baseNote: number,
  octaves: number,
): { white: number[]; blackAfter: (number | null)[] } {
  const white: number[] = []
  const blackAfter: (number | null)[] = []
  const degrees = [0, 2, 4, 5, 7, 9, 11]
  for (let octave = 0; octave < octaves; octave++) {
    for (const degree of degrees) {
      const note = baseNote + octave * 12 + degree
      if (note > 127) break
      white.push(note)
      const black = note + 1
      blackAfter.push(isBlackKey(black) && black <= 127 ? black : null)
    }
  }
  // the highest white key ends the keyboard, so nothing hangs over the edge
  if (blackAfter.length > 0) blackAfter[blackAfter.length - 1] = null
  return { white, blackAfter }
}
