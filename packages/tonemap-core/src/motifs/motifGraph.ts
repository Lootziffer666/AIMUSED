import type { MidiGraph, MidiGraphNote } from "../midi/eventGraph.ts"

/**
 * Voice, phrase and motif analysis.
 *
 * Deterministic and interval based, so a motif keeps its identity no matter
 * which track, instrument or octave it appears in: we compare *shapes*
 * (pitch intervals and rhythm ratios), never absolute pitch.
 *
 * IDs are content derived (a hash of the shape) and therefore stable across
 * runs and across files – the property the training data later depends on.
 */

export interface VoiceNote {
  noteId: string
  startTick: number
  endTick: number
  noteNumber: number
  velocity: number
}

export interface Voice {
  id: string
  trackIndex: number
  channel: number
  /** Voices are split by register inside a polyphonic track: 0 = lowest */
  voiceIndex: number
  notes: VoiceNote[]
  isMonophonic: boolean
}

export interface Phrase {
  id: string
  voiceId: string
  startTick: number
  endTick: number
  noteIds: string[]
  /** Reason the phrase ended: a rest, a long note or the end of the voice */
  boundary: "rest" | "long-note" | "end"
}

export interface MotifOccurrence {
  id: string
  motifId: string
  voiceId: string
  startTick: number
  endTick: number
  noteIds: string[]
  /** Semitones relative to the motif's reference occurrence */
  transposition: number
  /** 1 = same rhythm, 2 = twice as slow, 0.5 = twice as fast */
  timeScale: number
  confidence: number
}

export interface Motif {
  id: string
  /** Interval sequence in semitones – the transposition invariant identity */
  intervals: number[]
  /** Inter-onset ratios, normalized to the first interval */
  rhythmRatios: number[]
  referenceVoiceId: string
  occurrences: MotifOccurrence[]
  confidence: number
}

export interface RelationEdge {
  kind:
    | "octave-doubling"
    | "unison-doubling"
    | "call-and-response"
    | "counter-melody"
    | "ostinato"
    | "bass-figure"
  fromVoiceId: string
  toVoiceId: string
  confidence: number
  evidence: string
}

export interface MotifGraph {
  voices: Voice[]
  phrases: Phrase[]
  motifs: Motif[]
  relations: RelationEdge[]
}

const MIN_MOTIF_NOTES = 3
const MAX_MOTIF_NOTES = 8

/** FNV-1a: small, fast, stable across runs and platforms. */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * Splits notes into voices. A track/channel with overlapping notes is split
 * by register (highest note = top voice), which is the cheap approximation
 * of voice leading that matches how arrangers read a score.
 */
export function extractVoices(graph: MidiGraph): Voice[] {
  const groups = new Map<string, MidiGraphNote[]>()
  for (const note of graph.notes) {
    const key = `${note.trackIndex}:${note.channel}`
    const list = groups.get(key) ?? []
    list.push(note)
    groups.set(key, list)
  }

  const voices: Voice[] = []
  for (const [key, notes] of [...groups.entries()].sort()) {
    const [trackIndex, channel] = key.split(":").map(Number)
    const sorted = [...notes].sort(
      (a, b) => a.startTick - b.startTick || a.noteNumber - b.noteNumber,
    )

    // how many notes sound at the same time, at most
    const layers: VoiceNote[][] = []
    for (const note of sorted) {
      const entry: VoiceNote = {
        noteId: note.id,
        startTick: note.startTick,
        endTick: note.endTick,
        noteNumber: note.noteNumber,
        velocity: note.velocity,
      }
      // place into the first layer whose last note has ended
      let placed = false
      for (const layer of layers) {
        const last = layer[layer.length - 1]
        if (last.endTick <= note.startTick) {
          layer.push(entry)
          placed = true
          break
        }
      }
      if (!placed) layers.push([entry])
    }

    // lowest layer first, so voiceIndex 0 is the bass of that track
    layers.sort((a, b) => meanPitch(a) - meanPitch(b))
    layers.forEach((layerNotes, voiceIndex) => {
      voices.push({
        id: `v-${trackIndex}-${channel}-${voiceIndex}`,
        trackIndex,
        channel,
        voiceIndex,
        notes: layerNotes,
        isMonophonic: layers.length === 1,
      })
    })
  }
  return voices
}

function meanPitch(notes: VoiceNote[]): number {
  if (notes.length === 0) return 0
  return notes.reduce((sum, note) => sum + note.noteNumber, 0) / notes.length
}

/**
 * Cuts a voice into phrases at rests and at unusually long notes –
 * the two boundaries a listener actually hears.
 */
export function extractPhrases(
  voice: Voice,
  ticksPerQuarter: number,
): Phrase[] {
  const phrases: Phrase[] = []
  if (voice.notes.length === 0) return phrases

  const restThreshold = ticksPerQuarter // a quarter rest ends a phrase
  const longNote = ticksPerQuarter * 2

  let current: VoiceNote[] = []
  let boundary: Phrase["boundary"] = "end"

  const flush = (reason: Phrase["boundary"]) => {
    if (current.length === 0) return
    const startTick = current[0].startTick
    const endTick = current[current.length - 1].endTick
    phrases.push({
      id: `p-${voice.id}-${startTick}`,
      voiceId: voice.id,
      startTick,
      endTick,
      noteIds: current.map((note) => note.noteId),
      boundary: reason,
    })
    current = []
  }

  for (let i = 0; i < voice.notes.length; i++) {
    const note = voice.notes[i]
    current.push(note)
    const next = voice.notes[i + 1]
    if (!next) {
      boundary = "end"
      break
    }
    const gap = next.startTick - note.endTick
    if (gap >= restThreshold) flush("rest")
    else if (note.endTick - note.startTick >= longNote) flush("long-note")
  }
  flush(boundary)
  return phrases
}

function intervalsOf(notes: VoiceNote[]): number[] {
  const intervals: number[] = []
  for (let i = 1; i < notes.length; i++) {
    intervals.push(notes[i].noteNumber - notes[i - 1].noteNumber)
  }
  return intervals
}

function rhythmRatiosOf(notes: VoiceNote[]): number[] {
  const deltas: number[] = []
  for (let i = 1; i < notes.length; i++) {
    deltas.push(Math.max(1, notes[i].startTick - notes[i - 1].startTick))
  }
  if (deltas.length === 0) return []
  const base = deltas[0]
  return deltas.map((delta) => Number((delta / base).toFixed(3)))
}

function shapeKey(intervals: number[], ratios: number[]): string {
  return `${intervals.join(",")}|${ratios.join(",")}`
}

/**
 * Finds recurring shapes across *all* voices. A motif is a sequence of
 * intervals plus rhythm ratios that occurs at least twice, anywhere.
 */
export function detectMotifs(voices: Voice[]): Motif[] {
  interface Candidate {
    voiceId: string
    startIndex: number
    notes: VoiceNote[]
    intervals: number[]
    ratios: number[]
  }

  const byShape = new Map<string, Candidate[]>()

  for (const voice of voices) {
    const notes = voice.notes
    for (let length = MAX_MOTIF_NOTES; length >= MIN_MOTIF_NOTES; length--) {
      for (let start = 0; start + length <= notes.length; start++) {
        const window = notes.slice(start, start + length)
        const intervals = intervalsOf(window)
        // a motif needs at least one melodic move
        if (intervals.every((interval) => interval === 0)) continue
        const ratios = rhythmRatiosOf(window)
        const key = shapeKey(intervals, ratios)
        const list = byShape.get(key) ?? []
        list.push({
          voiceId: voice.id,
          startIndex: start,
          notes: window,
          intervals,
          ratios,
        })
        byShape.set(key, list)
      }
    }
  }

  const motifs: Motif[] = []
  const claimed = new Set<string>()

  // longest shapes first: a long repeat is more meaningful than its prefix
  const entries = [...byShape.entries()].sort(
    (a, b) =>
      b[0].split("|")[0].split(",").length -
      a[0].split("|")[0].split(",").length,
  )

  for (const [key, candidates] of entries) {
    const nonOverlapping: Candidate[] = []
    for (const candidate of candidates) {
      const ids = candidate.notes.map((note) => note.noteId)
      if (ids.some((id) => claimed.has(id))) continue
      nonOverlapping.push(candidate)
    }
    if (nonOverlapping.length < 2) continue

    for (const candidate of nonOverlapping) {
      for (const note of candidate.notes) claimed.add(note.noteId)
    }

    const reference = nonOverlapping[0]
    const motifId = `m-${stableHash(key)}`
    const occurrences: MotifOccurrence[] = nonOverlapping.map((candidate) => ({
      id: `o-${motifId}-${candidate.voiceId}-${candidate.notes[0].startTick}`,
      motifId,
      voiceId: candidate.voiceId,
      startTick: candidate.notes[0].startTick,
      endTick: candidate.notes[candidate.notes.length - 1].endTick,
      noteIds: candidate.notes.map((note) => note.noteId),
      transposition:
        candidate.notes[0].noteNumber - reference.notes[0].noteNumber,
      timeScale: Number(
        (
          (candidate.notes[1].startTick - candidate.notes[0].startTick) /
          Math.max(
            1,
            reference.notes[1].startTick - reference.notes[0].startTick,
          )
        ).toFixed(3),
      ),
      confidence: 0.8,
    }))

    motifs.push({
      id: motifId,
      intervals: reference.intervals,
      rhythmRatios: reference.ratios,
      referenceVoiceId: reference.voiceId,
      occurrences,
      confidence: Math.min(0.95, 0.6 + occurrences.length * 0.1),
    })
  }

  return motifs.sort((a, b) => b.intervals.length - a.intervals.length)
}

/** Doublings, ostinati, bass figures and call/response between voices. */
export function detectRelations(
  voices: Voice[],
  ticksPerQuarter: number,
): RelationEdge[] {
  const relations: RelationEdge[] = []

  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i]
      const b = voices[j]
      const shared = sharedOnsets(a, b)
      if (shared.length >= 3) {
        const intervals = shared.map(([x, y]) => y.noteNumber - x.noteNumber)
        const allSame = intervals.every((interval) => interval === intervals[0])
        const ratio = shared.length / Math.min(a.notes.length, b.notes.length)
        if (allSame && intervals[0] === 0) {
          relations.push({
            kind: "unison-doubling",
            fromVoiceId: a.id,
            toVoiceId: b.id,
            confidence: Math.min(0.95, ratio),
            evidence: `${shared.length} simultaneous notes at the same pitch`,
          })
        } else if (allSame && Math.abs(intervals[0]) % 12 === 0) {
          relations.push({
            kind: "octave-doubling",
            fromVoiceId: a.id,
            toVoiceId: b.id,
            confidence: Math.min(0.95, ratio),
            evidence: `${shared.length} simultaneous notes ${intervals[0]} semitones apart`,
          })
        } else if (ratio > 0.5) {
          relations.push({
            kind: "counter-melody",
            fromVoiceId: a.id,
            toVoiceId: b.id,
            confidence: Math.min(0.8, ratio * 0.8),
            evidence: "moves with the other voice but in different intervals",
          })
        }
      }

      if (shared.length === 0 && a.notes.length > 2 && b.notes.length > 2) {
        if (alternates(a, b)) {
          relations.push({
            kind: "call-and-response",
            fromVoiceId: a.id,
            toVoiceId: b.id,
            confidence: 0.6,
            evidence: "voices never sound together and alternate in time",
          })
        }
      }
    }
  }

  for (const voice of voices) {
    if (isOstinato(voice)) {
      relations.push({
        kind: "ostinato",
        fromVoiceId: voice.id,
        toVoiceId: voice.id,
        confidence: 0.7,
        evidence: "short pattern repeats without variation",
      })
    }
    if (isBassFigure(voice, ticksPerQuarter)) {
      relations.push({
        kind: "bass-figure",
        fromVoiceId: voice.id,
        toVoiceId: voice.id,
        confidence: 0.7,
        evidence: "low register, sparse, on the beat",
      })
    }
  }

  return relations
}

function sharedOnsets(a: Voice, b: Voice): [VoiceNote, VoiceNote][] {
  const pairs: [VoiceNote, VoiceNote][] = []
  for (const note of a.notes) {
    const partner = b.notes.find(
      (other) => Math.abs(other.startTick - note.startTick) <= 8,
    )
    if (partner) pairs.push([note, partner])
  }
  return pairs
}

function alternates(a: Voice, b: Voice): boolean {
  const overlap = a.notes.some((note) =>
    b.notes.some(
      (other) =>
        other.startTick < note.endTick && note.startTick < other.endTick,
    ),
  )
  return !overlap
}

function isOstinato(voice: Voice): boolean {
  if (voice.notes.length < 6) return false
  const intervals = intervalsOf(voice.notes)
  for (let period = 2; period <= 4; period++) {
    if (intervals.length < period * 2) continue
    let matches = true
    for (let i = period; i < intervals.length; i++) {
      if (intervals[i] !== intervals[i % period]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

function isBassFigure(voice: Voice, ticksPerQuarter: number): boolean {
  if (voice.notes.length < 3) return false
  const mean = meanPitch(voice.notes)
  if (mean > 52) return false
  const onBeat = voice.notes.filter(
    (note) => note.startTick % Math.max(1, ticksPerQuarter / 2) === 0,
  ).length
  return onBeat / voice.notes.length > 0.8
}

/** Full analysis pass over a MIDI graph. */
export function buildMotifGraph(graph: MidiGraph): MotifGraph {
  const voices = extractVoices(graph)
  const phrases = voices.flatMap((voice) =>
    extractPhrases(voice, graph.ticksPerQuarterNote),
  )
  return {
    voices,
    phrases,
    motifs: detectMotifs(voices),
    relations: detectRelations(voices, graph.ticksPerQuarterNote),
  }
}
