import type { MidiEvent } from "midi-file"
import { writeMidi } from "midi-file"

/**
 * Synthetic MIDI fixtures.
 *
 * Everything the round-trip tests need is generated here, so the repository
 * never has to carry copyrighted material to prove the data contract holds.
 */

export interface SyntheticTrackEvent {
  tick: number
  event: Omit<MidiEvent, "deltaTime">
}

export function buildMidiFile(options: {
  format?: 0 | 1
  ticksPerBeat?: number
  tracks: SyntheticTrackEvent[][]
}): Uint8Array {
  const ticksPerBeat = options.ticksPerBeat ?? 480
  const tracks = options.tracks.map((events) => {
    const ordered = [...events].sort((a, b) => a.tick - b.tick)
    let previous = 0
    const result = ordered.map(({ tick, event }) => {
      const deltaTime = tick - previous
      previous = tick
      return { ...event, deltaTime } as MidiEvent
    })
    result.push({ deltaTime: 0, type: "endOfTrack", meta: true } as MidiEvent)
    return result
  })

  return Uint8Array.from(
    writeMidi({
      header: {
        format: options.format ?? 1,
        numTracks: tracks.length,
        ticksPerBeat,
      },
      tracks,
    }),
  )
}

function note(
  tick: number,
  duration: number,
  channel: number,
  noteNumber: number,
  velocity = 90,
): SyntheticTrackEvent[] {
  return [
    { tick, event: { type: "noteOn", channel, noteNumber, velocity } as never },
    {
      tick: tick + duration,
      event: { type: "noteOff", channel, noteNumber, velocity: 64 } as never,
    },
  ]
}

/**
 * A deliberately awkward file: two tracks, several channels per track, a
 * chord, overlapping notes of the same pitch, a tempo change, program
 * changes, sustain pedal, pitch bend, aftertouch, marker, lyrics and SysEx.
 */
export function syntheticReferenceMidi(): Uint8Array {
  const conductor: SyntheticTrackEvent[] = [
    {
      tick: 0,
      event: { type: "trackName", text: "Conductor", meta: true } as never,
    },
    {
      tick: 0,
      event: {
        type: "setTempo",
        microsecondsPerBeat: 500000,
        meta: true,
      } as never,
    },
    {
      tick: 0,
      event: {
        type: "timeSignature",
        numerator: 4,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
        meta: true,
      } as never,
    },
    {
      tick: 0,
      event: { type: "keySignature", key: -3, scale: 0, meta: true } as never,
    },
    { tick: 0, event: { type: "marker", text: "Intro", meta: true } as never },
    {
      tick: 1920,
      event: {
        type: "setTempo",
        microsecondsPerBeat: 400000,
        meta: true,
      } as never,
    },
    {
      tick: 1920,
      event: { type: "marker", text: "Theme", meta: true } as never,
    },
    {
      tick: 1920,
      event: { type: "lyrics", text: "la", meta: true } as never,
    },
  ]

  const melodic: SyntheticTrackEvent[] = [
    {
      tick: 0,
      event: { type: "trackName", text: "Melody", meta: true } as never,
    },
    {
      tick: 0,
      event: { type: "programChange", channel: 0, programNumber: 40 } as never,
    },
    // chord
    ...note(0, 480, 0, 60),
    ...note(0, 480, 0, 64),
    ...note(0, 480, 0, 67),
    // overlapping identical pitch (second starts before the first ends)
    ...note(960, 960, 0, 72),
    ...note(1200, 960, 0, 72),
    // second channel inside the same track
    {
      tick: 0,
      event: { type: "programChange", channel: 3, programNumber: 33 } as never,
    },
    ...note(480, 480, 3, 36),
    ...note(1440, 480, 3, 38),
    // controllers
    {
      tick: 0,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 7,
        value: 100,
      } as never,
    },
    {
      tick: 240,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 64,
        value: 127,
      } as never,
    },
    {
      tick: 1440,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 64,
        value: 0,
      } as never,
    },
    {
      tick: 480,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 11,
        value: 80,
      } as never,
    },
    {
      tick: 480,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 10,
        value: 32,
      } as never,
    },
    {
      tick: 960,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 91,
        value: 40,
      } as never,
    },
    {
      tick: 720,
      event: { type: "pitchBend", channel: 0, value: 2048 } as never,
    },
    { tick: 840, event: { type: "pitchBend", channel: 0, value: 0 } as never },
    {
      tick: 600,
      event: { type: "channelAftertouch", channel: 0, amount: 55 } as never,
    },
    {
      tick: 600,
      event: {
        type: "noteAftertouch",
        channel: 0,
        noteNumber: 60,
        amount: 42,
      } as never,
    },
    {
      tick: 2400,
      event: {
        type: "sysEx",
        data: [0x7e, 0x7f, 0x09, 0x01, 0xf7],
      } as never,
    },
    // two identical events at the same tick must both survive, in order
    {
      tick: 2640,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 1,
        value: 20,
      } as never,
    },
    {
      tick: 2640,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 1,
        value: 20,
      } as never,
    },
  ]

  return buildMidiFile({ ticksPerBeat: 480, tracks: [conductor, melodic] })
}

/** Minimal single note file – used for the smallest possible round trip. */
export function syntheticSingleNoteMidi(): Uint8Array {
  return buildMidiFile({
    ticksPerBeat: 480,
    tracks: [
      [
        {
          tick: 0,
          event: {
            type: "setTempo",
            microsecondsPerBeat: 500000,
            meta: true,
          } as never,
        },
        ...note(0, 480, 0, 60, 100),
      ],
    ],
  })
}

/**
 * A monophonic melody whose motif repeats transposed – the fixture the
 * motif/voice analysis is checked against.
 */
export function syntheticMotifMidi(): Uint8Array {
  const events: SyntheticTrackEvent[] = [
    {
      tick: 0,
      event: { type: "trackName", text: "Theme", meta: true } as never,
    },
    {
      tick: 0,
      event: {
        type: "setTempo",
        microsecondsPerBeat: 500000,
        meta: true,
      } as never,
    },
  ]
  const motif = [0, 2, 4, 7]
  const starts = [0, 1920]
  const transpositions = [60, 67]
  starts.forEach((start, index) => {
    motif.forEach((step, position) => {
      events.push(
        ...note(
          start + position * 480,
          420,
          0,
          transpositions[index] + step,
          88,
        ),
      )
    })
  })
  // a bass ostinato on another channel
  for (let bar = 0; bar < 2; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      events.push(...note(bar * 1920 + beat * 480, 240, 1, 36, 100))
    }
  }
  return buildMidiFile({ ticksPerBeat: 480, tracks: [events] })
}
