/**
 * Lossless MIDI event graph.
 *
 * `@signal-app/midi-project` already imports MIDI into MUSE's *musical*
 * project model – that import is deliberately normalizing (it buckets by
 * channel, assembles notes, drops what the arranger does not need). This
 * module is the opposite: it keeps everything, in order, so that
 * `graphToMidi(midiToGraph(bytes))` reproduces the same event stream.
 *
 * Rules that follow from the brief:
 * - note duration is *never* derived from the distance to the next note;
 *   note-on and note-off stay separate events and are paired explicitly
 * - identical events at the same tick keep their relative order
 * - a track may carry several channels
 * - unsupported events (including SysEx) survive as opaque payloads
 */

import type { MidiEvent } from "midi-file"
import { parseMidi, writeMidi } from "midi-file"

export interface MidiGraphEventBase {
  /** Stable within one graph: `t{track}-e{index}` */
  id: string
  trackIndex: number
  /** Absolute tick from the start of the file */
  tick: number
  /** Position inside the original track, preserving order of equal ticks */
  order: number
}

export type MidiGraphEvent = MidiGraphEventBase & {
  /** The original midi-file event, untouched apart from deltaTime */
  event: MidiEvent
}

export interface MidiGraphNote {
  id: string
  trackIndex: number
  channel: number
  noteNumber: number
  startTick: number
  /** Explicit note-off tick – never inferred from the next note-on */
  endTick: number
  velocity: number
  /** Release velocity, 0 when the note ended with a note-on/velocity-0 */
  offVelocity: number
  onEventId: string
  offEventId: string
  /** True when the pairing had to fall back to the end of the track */
  unterminated: boolean
}

export interface MidiGraphTrack {
  index: number
  name?: string
  events: MidiGraphEvent[]
  /** Channels that actually occur in this track */
  channels: number[]
}

export interface MidiTempoEntry {
  tick: number
  microsecondsPerBeat: number
  bpm: number
}

export interface MidiTimeSignatureEntry {
  tick: number
  numerator: number
  denominator: number
  metronome: number
  thirtyseconds: number
}

export interface MidiKeySignatureEntry {
  tick: number
  key: number
  scale: number
}

export interface MidiGraph {
  format: number
  ticksPerQuarterNote: number
  tracks: MidiGraphTrack[]
  notes: MidiGraphNote[]
  tempoMap: MidiTempoEntry[]
  timeSignatureMap: MidiTimeSignatureEntry[]
  keySignatureMap: MidiKeySignatureEntry[]
  markers: { tick: number; text: string }[]
  texts: { tick: number; text: string; kind: string }[]
  /** Events the graph does not model explicitly but must not lose */
  opaque: MidiGraphEvent[]
  warnings: string[]
}

export class MidiGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MidiGraphError"
  }
}

const TEXT_KINDS = new Set([
  "text",
  "lyrics",
  "copyrightNotice",
  "instrumentName",
  "cuePoint",
  "deviceName",
  "programName",
])

function isNoteOn(event: MidiEvent): event is MidiEvent & {
  type: "noteOn"
  channel: number
  noteNumber: number
  velocity: number
} {
  return event.type === "noteOn"
}

function isNoteOff(event: MidiEvent): event is MidiEvent & {
  type: "noteOff"
  channel: number
  noteNumber: number
  velocity: number
} {
  return event.type === "noteOff"
}

/** Parses a Standard MIDI File into the lossless graph. */
export function midiToGraph(bytes: Uint8Array): MidiGraph {
  let parsed: ReturnType<typeof parseMidi>
  try {
    parsed = parseMidi(bytes)
  } catch (error) {
    throw new MidiGraphError(`could not parse MIDI file: ${String(error)}`)
  }

  const ppq = parsed.header.ticksPerBeat
  if (!ppq || ppq <= 0) {
    throw new MidiGraphError(
      "only tick-based MIDI files are supported (SMPTE time division found)",
    )
  }

  const graph: MidiGraph = {
    format: parsed.header.format ?? 1,
    ticksPerQuarterNote: ppq,
    tracks: [],
    notes: [],
    tempoMap: [],
    timeSignatureMap: [],
    keySignatureMap: [],
    markers: [],
    texts: [],
    opaque: [],
    warnings: [],
  }

  parsed.tracks.forEach((rawTrack, trackIndex) => {
    const track: MidiGraphTrack = {
      index: trackIndex,
      events: [],
      channels: [],
    }
    const channels = new Set<number>()
    let tick = 0

    rawTrack.forEach((rawEvent, eventIndex) => {
      tick += rawEvent.deltaTime ?? 0
      const event: MidiGraphEvent = {
        id: `t${trackIndex}-e${eventIndex}`,
        trackIndex,
        tick,
        order: eventIndex,
        // deltaTime is redundant once we store absolute ticks, but keeping the
        // original object intact is what makes the round trip lossless.
        event: { ...rawEvent },
      }
      track.events.push(event)

      const anyEvent = rawEvent as MidiEvent & { channel?: number }
      if (typeof anyEvent.channel === "number") channels.add(anyEvent.channel)

      switch (rawEvent.type) {
        case "setTempo": {
          const mpb = rawEvent.microsecondsPerBeat
          graph.tempoMap.push({
            tick,
            microsecondsPerBeat: mpb,
            bpm: mpb > 0 ? 60000000 / mpb : 120,
          })
          break
        }
        case "timeSignature":
          graph.timeSignatureMap.push({
            tick,
            numerator: rawEvent.numerator,
            denominator: rawEvent.denominator,
            metronome: rawEvent.metronome ?? 24,
            thirtyseconds: rawEvent.thirtyseconds ?? 8,
          })
          break
        case "keySignature":
          graph.keySignatureMap.push({
            tick,
            key: rawEvent.key,
            scale: rawEvent.scale,
          })
          break
        case "marker":
          graph.markers.push({ tick, text: rawEvent.text })
          break
        case "trackName":
          track.name = rawEvent.text
          break
        default:
          if (TEXT_KINDS.has(rawEvent.type)) {
            const text = (rawEvent as MidiEvent & { text?: string }).text
            if (typeof text === "string") {
              graph.texts.push({ tick, text, kind: rawEvent.type })
            }
          } else if (
            rawEvent.type === "sysEx" ||
            rawEvent.type === "endSysEx" ||
            rawEvent.type === "sequencerSpecific" ||
            rawEvent.type === "unknownMeta"
          ) {
            graph.opaque.push(event)
          }
          break
      }
    })

    track.channels = [...channels].sort((a, b) => a - b)
    graph.tracks.push(track)
  })

  graph.notes = pairNotes(graph)
  graph.tempoMap.sort((a, b) => a.tick - b.tick)
  graph.timeSignatureMap.sort((a, b) => a.tick - b.tick)
  if (graph.tempoMap.length === 0) {
    graph.tempoMap.push({ tick: 0, microsecondsPerBeat: 500000, bpm: 120 })
    graph.warnings.push("no tempo event found, assuming 120 bpm")
  }
  return graph
}

/**
 * Pairs note-ons with note-offs per (track, channel, pitch).
 *
 * Overlapping notes of the same pitch are matched first-in-first-out, which
 * is what sequencers and the MIDI spec's running notes imply; a note-on with
 * velocity 0 counts as a note-off.
 */
function pairNotes(graph: MidiGraph): MidiGraphNote[] {
  const notes: MidiGraphNote[] = []

  for (const track of graph.tracks) {
    const open = new Map<string, MidiGraphEvent[]>()
    const key = (channel: number, noteNumber: number) =>
      `${channel}:${noteNumber}`

    for (const item of track.events) {
      const event = item.event
      if (isNoteOn(event) && event.velocity > 0) {
        const stack = open.get(key(event.channel, event.noteNumber)) ?? []
        stack.push(item)
        open.set(key(event.channel, event.noteNumber), stack)
        continue
      }
      const isOff =
        isNoteOff(event) || (isNoteOn(event) && event.velocity === 0)
      if (!isOff) continue

      const channel = (event as { channel: number }).channel
      const noteNumber = (event as { noteNumber: number }).noteNumber
      const stack = open.get(key(channel, noteNumber))
      const onItem = stack?.shift()
      if (!onItem) {
        graph.warnings.push(
          `note-off without note-on at tick ${item.tick} (track ${track.index}, note ${noteNumber})`,
        )
        continue
      }
      const onEvent = onItem.event as MidiEvent & { velocity: number }
      notes.push({
        id: `n-${onItem.id}`,
        trackIndex: track.index,
        channel,
        noteNumber,
        startTick: onItem.tick,
        endTick: item.tick,
        velocity: onEvent.velocity,
        offVelocity: isNoteOff(event) ? event.velocity : 0,
        onEventId: onItem.id,
        offEventId: item.id,
        unterminated: false,
      })
    }

    const trackEnd = track.events.reduce((max, e) => Math.max(max, e.tick), 0)
    for (const [, stack] of open) {
      for (const onItem of stack) {
        const onEvent = onItem.event as MidiEvent & {
          channel: number
          noteNumber: number
          velocity: number
        }
        graph.warnings.push(
          `note without note-off at tick ${onItem.tick} (track ${track.index}, note ${onEvent.noteNumber})`,
        )
        notes.push({
          id: `n-${onItem.id}`,
          trackIndex: track.index,
          channel: onEvent.channel,
          noteNumber: onEvent.noteNumber,
          startTick: onItem.tick,
          endTick: Math.max(trackEnd, onItem.tick + 1),
          velocity: onEvent.velocity,
          offVelocity: 0,
          onEventId: onItem.id,
          offEventId: "",
          unterminated: true,
        })
      }
    }
  }

  return notes.sort(
    (a, b) =>
      a.startTick - b.startTick ||
      a.trackIndex - b.trackIndex ||
      a.channel - b.channel ||
      a.noteNumber - b.noteNumber,
  )
}

/** Serializes the graph back into a Standard MIDI File. */
export function graphToMidi(graph: MidiGraph): Uint8Array {
  const tracks = graph.tracks.map((track) => {
    const ordered = [...track.events].sort(
      (a, b) => a.tick - b.tick || a.order - b.order,
    )
    let previousTick = 0
    return ordered.map((item) => {
      const deltaTime = item.tick - previousTick
      previousTick = item.tick
      return { ...item.event, deltaTime } as MidiEvent
    })
  })

  const data = writeMidi({
    header: {
      format: graph.format as 0 | 1 | 2,
      numTracks: tracks.length,
      ticksPerBeat: graph.ticksPerQuarterNote,
    },
    tracks,
  })
  return Uint8Array.from(data)
}

/** Absolute seconds for a tick, honouring every tempo change before it. */
export function tickToSeconds(graph: MidiGraph, tick: number): number {
  const ppq = graph.ticksPerQuarterNote
  const tempos = graph.tempoMap.length
    ? graph.tempoMap
    : [{ tick: 0, microsecondsPerBeat: 500000, bpm: 120 }]

  let seconds = 0
  let cursor = 0
  let mpb = tempos[0].microsecondsPerBeat

  for (const entry of tempos) {
    if (entry.tick >= tick) break
    if (entry.tick > cursor) {
      seconds += ((entry.tick - cursor) / ppq) * (mpb / 1_000_000)
      cursor = entry.tick
    }
    mpb = entry.microsecondsPerBeat
  }
  seconds += ((tick - cursor) / ppq) * (mpb / 1_000_000)
  return seconds
}

export function secondsToTick(graph: MidiGraph, seconds: number): number {
  const ppq = graph.ticksPerQuarterNote
  const tempos = graph.tempoMap.length
    ? graph.tempoMap
    : [{ tick: 0, microsecondsPerBeat: 500000, bpm: 120 }]

  let elapsed = 0
  let cursor = 0
  let mpb = tempos[0].microsecondsPerBeat

  for (let i = 1; i < tempos.length; i++) {
    const entry = tempos[i]
    const segmentSeconds = ((entry.tick - cursor) / ppq) * (mpb / 1_000_000)
    if (elapsed + segmentSeconds >= seconds) break
    elapsed += segmentSeconds
    cursor = entry.tick
    mpb = entry.microsecondsPerBeat
  }
  return cursor + ((seconds - elapsed) * 1_000_000 * ppq) / mpb
}

export function totalTicks(graph: MidiGraph): number {
  return graph.tracks.reduce(
    (max, track) =>
      track.events.reduce((inner, event) => Math.max(inner, event.tick), max),
    0,
  )
}
