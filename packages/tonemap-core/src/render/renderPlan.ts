import {
  graphToMidi,
  type MidiGraph,
  type MidiGraphEvent,
  type MidiGraphTrack,
} from "../midi/eventGraph.ts"
import type { OrchestrationPlan, PlanPart } from "../orchestration/plan.ts"
import type { Envelope, PatchCandidate } from "../schema/tonemap.ts"

/**
 * An orchestration plan turned back into playable MIDI.
 *
 * This is the adapter every renderer shares: sfizz, FluidSynth and MUSE's own
 * player all take MIDI plus a patch. The plan itself is never modified, and
 * the imported source file is never touched – rendering writes new files
 * beside it and nothing else.
 */

export interface RenderChannelAssignment {
  partId: string
  channel: number
  /** Set when the chosen patch has a concrete SoundFont preset */
  program?: number
  bank?: number
  /** Keyswitch note played just before the part starts */
  keyswitch?: number
}

export interface PlanToMidiOptions {
  /** Patch chosen per part, e.g. the top ranked candidate */
  patches?: Record<string, PatchCandidate>
  /** Tempo and time signature come from the source graph when given */
  source?: Pick<
    MidiGraph,
    "ticksPerQuarterNote" | "tempoMap" | "timeSignatureMap" | "keySignatureMap"
  >
  /** One file per part instead of one multi-track file */
  perPart?: boolean
  /** Channel 10 (index 9) is reserved for percussion unless this is false */
  reserveDrumChannel?: boolean
}

export interface PlanMidiResult {
  graph: MidiGraph
  bytes: Uint8Array
  assignments: RenderChannelAssignment[]
  warnings: string[]
}

const DRUM_CHANNEL = 9

function envelopeValueAt(
  prominence: number | Envelope | undefined,
  tick: number,
): number | undefined {
  if (prominence === undefined) return undefined
  if (typeof prominence === "number") return prominence
  const points = [...prominence.points].sort((a, b) => a.tick - b.tick)
  if (points.length === 0) return undefined
  if (tick <= points[0].tick) return points[0].value
  for (let i = 1; i < points.length; i++) {
    if (tick <= points[i].tick) {
      const previous = points[i - 1]
      const current = points[i]
      if (current.curve === "hold") return previous.value
      const span = current.tick - previous.tick
      const ratio = span === 0 ? 1 : (tick - previous.tick) / span
      return previous.value + (current.value - previous.value) * ratio
    }
  }
  return points[points.length - 1].value
}

/** 0..1 prominence as a CC7 value; unset prominence leaves the channel alone. */
function volumeFor(part: PlanPart, tick: number): number | undefined {
  const value = envelopeValueAt(part.prominence, tick)
  if (value === undefined) return undefined
  return Math.max(0, Math.min(127, Math.round(value * 127)))
}

function assignChannels(
  parts: PlanPart[],
  patches: Record<string, PatchCandidate>,
  reserveDrumChannel: boolean,
): { assignments: RenderChannelAssignment[]; warnings: string[] } {
  const warnings: string[] = []
  const assignments: RenderChannelAssignment[] = []
  let next = 0

  for (const part of parts) {
    const patch = patches[part.id]
    const isPercussion =
      part.family === "percussion" || patch?.family === "percussion"

    let channel: number
    if (isPercussion && reserveDrumChannel) {
      channel = DRUM_CHANNEL
    } else {
      if (reserveDrumChannel && next === DRUM_CHANNEL) next++
      channel = next++
      if (channel > 15) {
        // 16 channels is a hard MIDI limit; say so instead of overwriting one
        warnings.push(
          `more parts than MIDI channels: "${part.label}" shares channel 15`,
        )
        channel = 15
        next = 16
      }
    }

    assignments.push({
      partId: part.id,
      channel,
      program: patch?.soundFontPreset?.program,
      bank: patch?.soundFontPreset?.bank,
      keyswitch: patch?.keyswitch,
    })
  }

  return { assignments, warnings }
}

/**
 * Builds a MIDI graph from the plan. Conductor data (tempo, time and key
 * signature) is copied from the source when one is given, so a rendered stem
 * lines up with the reference recording.
 */
export function planToMidi(
  plan: OrchestrationPlan,
  options: PlanToMidiOptions = {},
): PlanMidiResult {
  const patches = options.patches ?? {}
  const parts = plan.parts.filter((part) => !part.muted)
  const { assignments, warnings } = assignChannels(
    parts,
    patches,
    options.reserveDrumChannel !== false,
  )
  const byPart = new Map(assignments.map((entry) => [entry.partId, entry]))

  const ppq = options.source?.ticksPerQuarterNote ?? plan.ticksPerQuarterNote
  const tracks: MidiGraphTrack[] = []

  // Track 0 carries the conductor data, as in any format-1 file
  const conductor: MidiGraphEvent[] = []
  let order = 0
  const push = (
    trackIndex: number,
    tick: number,
    event: Record<string, unknown>,
    into: MidiGraphEvent[],
  ) => {
    into.push({
      id: `r${trackIndex}-e${order}`,
      trackIndex,
      tick,
      order: order++,
      event,
    } as unknown as MidiGraphEvent)
  }

  for (const tempo of options.source?.tempoMap ?? []) {
    push(
      0,
      tempo.tick,
      {
        meta: true,
        type: "setTempo",
        microsecondsPerBeat: tempo.microsecondsPerBeat,
      },
      conductor,
    )
  }
  for (const signature of options.source?.timeSignatureMap ?? []) {
    push(
      0,
      signature.tick,
      {
        meta: true,
        type: "timeSignature",
        numerator: signature.numerator,
        denominator: signature.denominator,
        metronome: signature.metronome,
        thirtyseconds: signature.thirtyseconds,
      },
      conductor,
    )
  }
  for (const signature of options.source?.keySignatureMap ?? []) {
    push(
      0,
      signature.tick,
      {
        meta: true,
        type: "keySignature",
        key: signature.key,
        scale: signature.scale,
      },
      conductor,
    )
  }
  const lastTick = parts.reduce(
    (max, part) =>
      part.notes.reduce((inner, note) => Math.max(inner, note.endTick), max),
    0,
  )
  push(0, lastTick, { meta: true, type: "endOfTrack" }, conductor)
  tracks.push({ index: 0, name: "conductor", events: conductor, channels: [] })

  parts.forEach((part, index) => {
    const assignment = byPart.get(part.id)
    if (!assignment) return
    const trackIndex = index + 1
    const events: MidiGraphEvent[] = []
    const channel = assignment.channel

    push(
      trackIndex,
      0,
      { meta: true, type: "trackName", text: part.label },
      events,
    )
    if (assignment.bank !== undefined) {
      push(
        trackIndex,
        0,
        {
          type: "controller",
          channel,
          controllerType: 0,
          value: assignment.bank,
        },
        events,
      )
    }
    if (assignment.program !== undefined) {
      push(
        trackIndex,
        0,
        {
          type: "programChange",
          channel,
          programNumber: assignment.program,
        },
        events,
      )
    }
    if (assignment.keyswitch !== undefined) {
      // held for the whole part: keyswitches select the articulation, they
      // are not meant to sound
      push(
        trackIndex,
        0,
        {
          type: "noteOn",
          channel,
          noteNumber: assignment.keyswitch,
          velocity: 1,
        },
        events,
      )
      push(
        trackIndex,
        Math.max(1, lastTick),
        {
          type: "noteOff",
          channel,
          noteNumber: assignment.keyswitch,
          velocity: 0,
        },
        events,
      )
    }

    const initialVolume = volumeFor(part, 0)
    if (initialVolume !== undefined) {
      push(
        trackIndex,
        0,
        {
          type: "controller",
          channel,
          controllerType: 7,
          value: initialVolume,
        },
        events,
      )
    }

    const sorted = [...part.notes].sort(
      (a, b) => a.startTick - b.startTick || a.noteNumber - b.noteNumber,
    )
    let lastVolume = initialVolume
    for (const note of sorted) {
      const volume = volumeFor(part, note.startTick)
      if (volume !== undefined && volume !== lastVolume) {
        push(
          trackIndex,
          note.startTick,
          {
            type: "controller",
            channel,
            controllerType: 7,
            value: volume,
          },
          events,
        )
        lastVolume = volume
      }
      push(
        trackIndex,
        note.startTick,
        {
          type: "noteOn",
          channel,
          noteNumber: note.noteNumber,
          velocity: note.velocity,
        },
        events,
      )
      push(
        trackIndex,
        Math.max(note.startTick + 1, note.endTick),
        {
          type: "noteOff",
          channel,
          noteNumber: note.noteNumber,
          velocity: 0,
        },
        events,
      )
    }

    push(
      trackIndex,
      Math.max(1, lastTick),
      { meta: true, type: "endOfTrack" },
      events,
    )
    tracks.push({
      index: trackIndex,
      name: part.label,
      events,
      channels: [channel],
    })
  })

  const graph: MidiGraph = {
    format: 1,
    ticksPerQuarterNote: ppq,
    tracks,
    notes: [],
    tempoMap: options.source?.tempoMap ?? [],
    timeSignatureMap: options.source?.timeSignatureMap ?? [],
    keySignatureMap: options.source?.keySignatureMap ?? [],
    markers: [],
    texts: [],
    opaque: [],
    warnings,
  }

  return { graph, bytes: graphToMidi(graph), assignments, warnings }
}

/** One MIDI file per part, for renderers that produce stems. */
export function planToStemMidi(
  plan: OrchestrationPlan,
  options: PlanToMidiOptions = {},
): { partId: string; label: string; result: PlanMidiResult }[] {
  return plan.parts
    .filter((part) => !part.muted)
    .map((part) => ({
      partId: part.id,
      label: part.label,
      result: planToMidi({ ...plan, parts: [part] }, options),
    }))
}
