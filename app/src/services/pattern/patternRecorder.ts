/**
 * Turning played keys into pattern notes.
 *
 * Recording into a *loop* is not the same as recording onto a tape: a key can
 * be pressed shortly before the end marker and released after the loop has
 * wrapped, and the honest reading of that is one held note across the seam, not
 * a note of negative length. That wrap is the only real subtlety here, and it
 * is why this is a module with tests instead of two lines in a component.
 *
 * Nothing here touches audio, React or the store – it takes ticks in and gives
 * notes back.
 */

export interface RecordedNote {
  startTick: number
  durationTicks: number
  noteNumber: number
  velocity: number
}

export interface Press {
  noteNumber: number
  startTick: number
  endTick: number
  velocity: number
}

export interface PressOptions {
  /** Active length of the pattern; a press may wrap around it */
  lengthTicks: number
  /** Grid step in ticks */
  step: number
  /** Snap start and length to the grid */
  quantize: boolean
  /** Shortest note an unquantized press may produce */
  minTicks?: number
}

function wrap(tick: number, length: number): number {
  return ((tick % length) + length) % length
}

/**
 * Length of a press, in ticks, counting a wrap around the loop as forward time.
 *
 * A release *before* the press only makes sense as a wrap, so the loop length
 * is added. A release in the *same* tick is a fast tap, not a note held for a
 * whole turn – both readings are possible from the numbers alone, and the tap
 * is the one that actually happens. The minimum length in `pressToNote` then
 * makes it audible.
 */
export function pressDuration(
  startTick: number,
  endTick: number,
  lengthTicks: number,
): number {
  const raw = endTick - startTick
  if (raw > 0) return raw
  if (raw === 0) return 0
  return raw + lengthTicks
}

/** One press as a note, quantized or not. */
export function pressToNote(press: Press, options: PressOptions): RecordedNote {
  const { lengthTicks, step, quantize, minTicks = 1 } = options
  const raw = pressDuration(press.startTick, press.endTick, lengthTicks)

  if (!quantize) {
    return {
      startTick: wrap(Math.round(press.startTick), lengthTicks),
      durationTicks: Math.max(minTicks, Math.round(raw)),
      noteNumber: press.noteNumber,
      velocity: press.velocity,
    }
  }

  // Snapping to the *nearest* step is what makes a slightly early note land on
  // the beat instead of just before it; a note nudged past the end marker
  // belongs at the start of the loop, not outside it.
  const start = wrap(Math.round(press.startTick / step) * step, lengthTicks)
  const duration = Math.max(step, Math.round(raw / step) * step)
  return {
    startTick: start,
    durationTicks: duration,
    noteNumber: press.noteNumber,
    velocity: press.velocity,
  }
}

/**
 * Keys currently held down.
 *
 * A second press of a note that is already sounding replaces the first: MIDI
 * devices, computer keys and a finger on the screen can all produce that, and
 * two overlapping notes of the same pitch are never what was meant.
 */
export class PatternRecording {
  private held = new Map<number, { startTick: number; velocity: number }>()

  start(noteNumber: number, tick: number, velocity: number) {
    this.held.set(noteNumber, { startTick: tick, velocity })
  }

  /** Finishes a press, or returns `null` if that note was not being held. */
  finish(
    noteNumber: number,
    tick: number,
    options: PressOptions,
  ): RecordedNote | null {
    const open = this.held.get(noteNumber)
    if (!open) return null
    this.held.delete(noteNumber)
    return pressToNote(
      {
        noteNumber,
        startTick: open.startTick,
        endTick: tick,
        velocity: open.velocity,
      },
      options,
    )
  }

  /**
   * Closes everything still held – what stopping the transport has to do, so a
   * key that was down when the music stopped still becomes a note.
   */
  finishAll(tick: number, options: PressOptions): RecordedNote[] {
    const notes: RecordedNote[] = []
    for (const noteNumber of [...this.held.keys()]) {
      const note = this.finish(noteNumber, tick, options)
      if (note) notes.push(note)
    }
    return notes
  }

  isHeld(noteNumber: number): boolean {
    return this.held.has(noteNumber)
  }

  get pending(): number[] {
    return [...this.held.keys()]
  }

  clear() {
    this.held.clear()
  }
}
