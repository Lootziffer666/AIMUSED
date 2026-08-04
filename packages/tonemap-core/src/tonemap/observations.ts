import type { AlignmentMap } from "../alignment/alignment.ts"
import { alignTickToSeconds } from "../alignment/alignment.ts"
import type { AudioFeatureResult } from "../audio/features.ts"
import { aggregateSegment } from "../audio/features.ts"
import type { MidiGraph } from "../midi/eventGraph.ts"
import { tickToSeconds, totalTicks } from "../midi/eventGraph.ts"
import type { MotifGraph, Voice } from "../motifs/motifGraph.ts"
import { buildMotifGraph } from "../motifs/motifGraph.ts"
import {
  type AcousticFeatureVector,
  type Claim,
  clamp01,
  createProvenance,
  type EvidenceRef,
  type MusicalFunction,
  type Prominence,
  type RegisterProfile,
  type SymbolicFeatureVector,
  type TimbreVector,
  type ToneMapNode,
  type ToneMapObservation,
  type ToneMapProject,
} from "../schema/tonemap.ts"

/**
 * Tone mapping: bringing MIDI structure and audio features together.
 *
 * Every statement here is a *heuristic with evidence*, not a measurement.
 * The heuristics are deliberately simple and readable – their job is to
 * produce a transparent first pass that a human corrects and that later
 * becomes training data. Where audio is missing, symbolic evidence alone is
 * used and the confidence says so.
 */

const PERCUSSION_CHANNEL = 9

export interface BuildOptions {
  features?: AudioFeatureResult
  alignment?: AlignmentMap
  sourcePairId?: string
  now?: string
}

export function symbolicFeaturesForVoice(
  voice: Voice,
  graph: MidiGraph,
): SymbolicFeatureVector {
  const notes = voice.notes
  const ppq = graph.ticksPerQuarterNote
  if (notes.length === 0) {
    return {
      noteCount: 0,
      noteDensityPerBeat: 0,
      meanDurationTicks: 0,
      pitchRange: 0,
      meanIntervalAbs: 0,
      polyphony: 0,
      isMonophonic: true,
      syncopation: 0,
      restRatio: 1,
      repetitionScore: 0,
      velocityMean: 0,
      velocityVariance: 0,
      sustainPedalRatio: 0,
      legatoRatio: 0,
    }
  }

  const start = notes[0].startTick
  const end = notes[notes.length - 1].endTick
  const spanTicks = Math.max(1, end - start)
  const beats = spanTicks / ppq

  const pitches = notes.map((note) => note.noteNumber)
  const intervals: number[] = []
  for (let i = 1; i < notes.length; i++) {
    intervals.push(Math.abs(notes[i].noteNumber - notes[i - 1].noteNumber))
  }

  const sounding = notes.reduce(
    (sum, note) => sum + (note.endTick - note.startTick),
    0,
  )
  const offBeat = notes.filter(
    (note) => note.startTick % Math.max(1, ppq / 2) !== 0,
  ).length

  let legato = 0
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].startTick <= notes[i - 1].endTick + ppq / 16) legato++
  }

  const velocities = notes.map((note) => note.velocity)
  const velocityMean =
    velocities.reduce((sum, value) => sum + value, 0) / velocities.length
  const velocityVariance =
    velocities.reduce((sum, value) => sum + (value - velocityMean) ** 2, 0) /
    velocities.length

  const sustainEvents =
    graph.tracks[voice.trackIndex]?.events.filter(
      (item) =>
        (item.event as { controllerType?: number }).controllerType === 64 &&
        (item.event as { channel?: number }).channel === voice.channel,
    ) ?? []
  const sustainDown = sustainEvents.filter(
    (item) => ((item.event as { value?: number }).value ?? 0) >= 64,
  ).length

  return {
    noteCount: notes.length,
    noteDensityPerBeat: Number(
      (notes.length / Math.max(0.25, beats)).toFixed(4),
    ),
    meanDurationTicks: Math.round(sounding / notes.length),
    pitchRange: Math.max(...pitches) - Math.min(...pitches),
    meanIntervalAbs:
      intervals.length > 0
        ? Number(
            (intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(
              3,
            ),
          )
        : 0,
    polyphony: voice.isMonophonic ? 1 : 2,
    isMonophonic: voice.isMonophonic,
    syncopation: Number((offBeat / notes.length).toFixed(3)),
    restRatio: Number(clamp01(1 - sounding / spanTicks).toFixed(3)),
    repetitionScore: repetitionScore(pitches),
    velocityMean: Math.round(velocityMean),
    velocityVariance: Number(velocityVariance.toFixed(2)),
    sustainPedalRatio:
      sustainEvents.length > 0
        ? Number((sustainDown / sustainEvents.length).toFixed(3))
        : 0,
    legatoRatio: Number((legato / Math.max(1, notes.length - 1)).toFixed(3)),
  }
}

function repetitionScore(pitches: number[]): number {
  if (pitches.length < 4) return 0
  const counts = new Map<number, number>()
  for (const pitch of pitches) counts.set(pitch, (counts.get(pitch) ?? 0) + 1)
  const repeated = [...counts.values()].reduce(
    (sum, count) => sum + (count > 1 ? count : 0),
    0,
  )
  return Number((repeated / pitches.length).toFixed(3))
}

export function registerProfile(voice: Voice): RegisterProfile {
  if (voice.notes.length === 0) {
    return { lowestMidi: 0, highestMidi: 0, centroidMidi: 0, medianMidi: 0 }
  }
  const pitches = voice.notes.map((note) => note.noteNumber)
  const weights = voice.notes.map((note) =>
    Math.max(1, note.endTick - note.startTick),
  )
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const centroid =
    pitches.reduce((sum, pitch, index) => sum + pitch * weights[index], 0) /
    weightSum
  const sorted = [...pitches].sort((a, b) => a - b)
  return {
    lowestMidi: sorted[0],
    highestMidi: sorted[sorted.length - 1],
    centroidMidi: Number(centroid.toFixed(2)),
    medianMidi: sorted[Math.floor(sorted.length / 2)],
  }
}

/**
 * Musical function from symbolic evidence only – audio can raise or lower the
 * confidence later, but the *function* is a structural question.
 */
export function inferMusicalFunction(
  voice: Voice,
  symbolic: SymbolicFeatureVector,
  register: RegisterProfile,
  graphContext: { motifGraph: MotifGraph; voices: Voice[] },
): { value: MusicalFunction; confidence: number; evidence: EvidenceRef[] } {
  const evidence: EvidenceRef[] = []
  const push = (ref: string, detail: string) =>
    evidence.push({ kind: "symbolic-feature", ref, detail })

  if (voice.channel === PERCUSSION_CHANNEL) {
    push("channel", "MIDI channel 10 is the General MIDI drum channel")
    return { value: "percussion", confidence: 0.95, evidence }
  }

  const isOstinato = graphContext.motifGraph.relations.some(
    (relation) =>
      relation.kind === "ostinato" && relation.fromVoiceId === voice.id,
  )

  if (symbolic.noteCount > 0 && symbolic.meanDurationTicks > 0) {
    const others = graphContext.voices.filter((other) => other.id !== voice.id)
    const lowest =
      others.length === 0 ||
      others.every(
        (other) => registerProfile(other).centroidMidi >= register.centroidMidi,
      )

    // A repeating figure in the bass register is a bass line first and an
    // ostinato second – so the register question is asked before the
    // repetition question.
    if (register.centroidMidi < 52 && lowest) {
      push("register", `centroid ${register.centroidMidi} is the lowest voice`)
      if (isOstinato)
        push("repetition", "the bass line also repeats (ostinato)")
      return { value: "bass", confidence: 0.8, evidence }
    }

    if (isOstinato && symbolic.repetitionScore > 0.5) {
      push("repetitionScore", `${symbolic.repetitionScore} of the notes repeat`)
      return { value: "ostinato", confidence: 0.7, evidence }
    }

    if (
      symbolic.restRatio < 0.15 &&
      symbolic.meanIntervalAbs < 1 &&
      symbolic.noteCount < 4
    ) {
      push("meanIntervalAbs", "long held notes with hardly any movement")
      return { value: "drone", confidence: 0.6, evidence }
    }

    const highest = others.every(
      (other) => registerProfile(other).centroidMidi <= register.centroidMidi,
    )
    if (highest && symbolic.meanIntervalAbs >= 1 && symbolic.isMonophonic) {
      push("register", "highest monophonic voice with melodic movement")
      push(
        "meanIntervalAbs",
        `${symbolic.meanIntervalAbs} semitones on average`,
      )
      return { value: "primary-melody", confidence: 0.75, evidence }
    }

    if (!voice.isMonophonic) {
      push("polyphony", "several notes sound at once in this voice")
      return { value: "harmony", confidence: 0.6, evidence }
    }

    if (symbolic.meanIntervalAbs >= 1) {
      push("meanIntervalAbs", "melodic movement, but not the top voice")
      return { value: "counter-melody", confidence: 0.55, evidence }
    }
  }

  push("fallback", "no rule matched with enough evidence")
  return { value: "unknown", confidence: 0.2, evidence }
}

/** Timbre axes derived from the acoustic vector; without audio it stays sparse. */
export function timbreFromAcoustics(
  acoustic: AcousticFeatureVector | undefined,
  symbolic: SymbolicFeatureVector,
  register: RegisterProfile,
): TimbreVector {
  const timbre: TimbreVector = {}

  // symbolic axes are always available
  timbre.density = clamp01(symbolic.noteDensityPerBeat / 8)
  timbre.movement = clamp01(symbolic.meanIntervalAbs / 12)
  timbre.sustain = clamp01(symbolic.legatoRatio)
  timbre.weight = clamp01((72 - register.centroidMidi) / 48)

  if (!acoustic) return timbre

  // 200 Hz .. 6 kHz mapped logarithmically onto 0..1
  const centroid = acoustic.spectralCentroidHz
  timbre.brightness = clamp01(
    centroid <= 0
      ? 0
      : Math.log2(Math.max(200, centroid) / 200) / Math.log2(30),
  )
  timbre.warmth = clamp01(acoustic.lowEnergy * 1.5 + acoustic.midEnergy * 0.5)
  timbre.airy = clamp01(acoustic.highEnergy * 2)
  timbre.roughness = clamp01(acoustic.spectralFlatness * 3)
  timbre.metallic = clamp01(
    acoustic.highEnergy * 1.5 + acoustic.spectralFlatness,
  )
  timbre.breathy = clamp01(
    acoustic.zeroCrossingRate * 4 * acoustic.spectralFlatness * 2,
  )
  timbre.woody = clamp01(
    acoustic.midEnergy * 1.2 * (1 - acoustic.spectralFlatness),
  )
  timbre.attackSharpness = clamp01(acoustic.transientStrength)
  timbre.softness = clamp01(1 - acoustic.transientStrength)
  timbre.decay = clamp01(1 - acoustic.sustainEstimate)
  timbre.sustain = clamp01(
    (timbre.sustain ?? 0) * 0.5 + acoustic.sustainEstimate * 0.5,
  )
  timbre.stereoWidth = clamp01(acoustic.stereoWidth)
  timbre.presence = clamp01(acoustic.midEnergy + acoustic.highEnergy * 0.5)
  timbre.intimacy = clamp01(
    1 - acoustic.stereoWidth * 0.5 - acoustic.spectralFlatness,
  )
  // a long tail with little onset energy reads as room
  timbre.reverberance = clamp01(
    acoustic.sustainEstimate * (1 - acoustic.transientStrength),
  )
  timbre.tension = clamp01(
    acoustic.spectralFlatness * 0.5 + clamp01(symbolic.syncopation) * 0.5,
  )
  return timbre
}

/** Prominence from register, activity and (when available) energy share. */
export function inferProminence(
  symbolic: SymbolicFeatureVector,
  register: RegisterProfile,
  musicalFunction: MusicalFunction,
  acoustic?: AcousticFeatureVector,
): Prominence {
  let level = 0.4
  if (musicalFunction === "primary-melody") level = 0.8
  else if (musicalFunction === "counter-melody") level = 0.55
  else if (musicalFunction === "bass") level = 0.5
  else if (musicalFunction === "percussion" || musicalFunction === "pulse")
    level = 0.45
  else if (musicalFunction === "texture" || musicalFunction === "drone")
    level = 0.25

  level += clamp01(symbolic.velocityMean / 127) * 0.1
  level += clamp01(register.centroidMidi / 100) * 0.05
  if (acoustic) level += clamp01(acoustic.rms * 2) * 0.1

  const clamped = clamp01(level)
  const state =
    clamped >= 0.65
      ? "foreground"
      : clamped >= 0.35
        ? "midground"
        : "background"
  return { state, level: Number(clamped.toFixed(3)) }
}

/**
 * Builds a ToneMap project: identity nodes for every voice, phrase and motif,
 * plus one observation per voice and per motif occurrence.
 */
export function buildToneMapProject(
  graph: MidiGraph,
  options: BuildOptions & { id: string; name: string },
): { project: ToneMapProject; motifGraph: MotifGraph } {
  const now = options.now ?? new Date().toISOString()
  const motifGraph = buildMotifGraph(graph)
  const nodes: ToneMapNode[] = []
  const observations: ToneMapObservation[] = []

  const songId = `song-${options.id}`
  nodes.push({
    id: songId,
    kind: "song",
    label: options.name,
    childIds: [],
    range: { startTick: 0, endTick: totalTicks(graph) },
    provenance: createProvenance({
      source: "midi",
      status: "derived",
      confidence: 1,
      extractionMethod: "midi-import",
      now,
    }),
  })

  const secondsFor = (tick: number) =>
    options.alignment
      ? alignTickToSeconds(options.alignment, tick)
      : tickToSeconds(graph, tick)

  for (const voice of motifGraph.voices) {
    const symbolic = symbolicFeaturesForVoice(voice, graph)
    const register = registerProfile(voice)
    const start = voice.notes[0]?.startTick ?? 0
    const end = voice.notes[voice.notes.length - 1]?.endTick ?? 0
    const range = {
      startTick: start,
      endTick: end,
      startSeconds: secondsFor(start),
      endSeconds: secondsFor(end),
    }

    const trackName = graph.tracks[voice.trackIndex]?.name
    nodes.push({
      id: voice.id,
      kind: "voice",
      label: trackName
        ? `${trackName} (ch ${voice.channel})`
        : `voice ${voice.id}`,
      parentId: songId,
      childIds: [],
      range,
      provenance: createProvenance({
        source: "midi",
        status: "derived",
        confidence: 0.9,
        extractionMethod: "voice-splitting",
        now,
      }),
    })

    const acoustic =
      options.features &&
      range.startSeconds !== undefined &&
      range.endSeconds !== undefined
        ? aggregateSegment(options.features, {
            startSeconds: range.startSeconds,
            endSeconds: range.endSeconds,
          })
        : undefined

    const fn = inferMusicalFunction(voice, symbolic, register, {
      motifGraph,
      voices: motifGraph.voices,
    })
    const alignmentConfidence = options.alignment?.globalConfidence ?? 1
    const acousticEvidence: EvidenceRef[] = acoustic
      ? [
          {
            kind: "audio-feature",
            ref: "spectralCentroidHz",
            detail: `${acoustic.spectralCentroidHz.toFixed(1)} Hz`,
          },
          {
            kind: "alignment",
            ref: "globalConfidence",
            detail: String(alignmentConfidence),
          },
        ]
      : []

    const functionClaim: Claim<MusicalFunction> = {
      value: fn.value,
      provenance: createProvenance({
        source: "analysis",
        status: "derived",
        confidence: fn.confidence,
        extractionMethod: "role-heuristics-v1",
        evidence: fn.evidence,
        now,
      }),
    }

    const prominence = inferProminence(symbolic, register, fn.value, acoustic)
    observations.push({
      id: `obs-${voice.id}`,
      sourceRef: voice.id,
      timeRange: range,
      musicalFunction: functionClaim,
      prominence: {
        value: prominence,
        provenance: createProvenance({
          source: "analysis",
          status: "derived",
          confidence: acoustic ? 0.6 : 0.4,
          extractionMethod: "prominence-heuristics-v1",
          evidence: acousticEvidence,
          now,
        }),
      },
      register,
      symbolicFeatures: symbolic,
      acousticFeatures: acoustic,
      timbreIntent: timbreFromAcoustics(acoustic, symbolic, register),
      implementationHints: [],
      confidence: Number(
        (
          fn.confidence * (acoustic ? alignmentConfidence * 0.5 + 0.5 : 0.8)
        ).toFixed(3),
      ),
      evidence: [...fn.evidence, ...acousticEvidence],
    })
  }

  for (const phrase of motifGraph.phrases) {
    nodes.push({
      id: phrase.id,
      kind: "phrase",
      parentId: phrase.voiceId,
      childIds: [],
      range: {
        startTick: phrase.startTick,
        endTick: phrase.endTick,
        startSeconds: secondsFor(phrase.startTick),
        endSeconds: secondsFor(phrase.endTick),
      },
      provenance: createProvenance({
        source: "analysis",
        status: "derived",
        confidence: 0.6,
        extractionMethod: `phrase-boundary:${phrase.boundary}`,
        now,
      }),
    })
  }

  for (const motif of motifGraph.motifs) {
    nodes.push({
      id: motif.id,
      kind: "motif",
      label: `motif ${motif.intervals.join(" ")}`,
      parentId: songId,
      childIds: motif.occurrences.map((occurrence) => occurrence.id),
      provenance: createProvenance({
        source: "analysis",
        status: "derived",
        confidence: motif.confidence,
        extractionMethod: "interval-shape-matching-v1",
        evidence: [
          {
            kind: "symbolic-feature",
            ref: "intervals",
            detail: motif.intervals.join(","),
          },
        ],
        now,
      }),
    })

    for (const occurrence of motif.occurrences) {
      nodes.push({
        id: occurrence.id,
        kind: "motif-occurrence",
        parentId: motif.id,
        variantOfId: motif.id,
        variantTransform: {
          transposeSemitones: occurrence.transposition,
          timeScale: occurrence.timeScale,
        },
        childIds: [],
        range: {
          startTick: occurrence.startTick,
          endTick: occurrence.endTick,
          startSeconds: secondsFor(occurrence.startTick),
          endSeconds: secondsFor(occurrence.endTick),
        },
        provenance: createProvenance({
          source: "analysis",
          status: "derived",
          confidence: occurrence.confidence,
          extractionMethod: "interval-shape-matching-v1",
          now,
        }),
      })
    }
  }

  // fill in child links
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = byId.get(node.parentId)
    if (parent && !parent.childIds.includes(node.id))
      parent.childIds.push(node.id)
  }

  const project: ToneMapProject = {
    schemaVersion: "muse.tonemap.v1",
    id: options.id,
    name: options.name,
    createdAt: now,
    updatedAt: now,
    sourcePairId: options.sourcePairId,
    ticksPerQuarterNote: graph.ticksPerQuarterNote,
    nodes,
    observations,
    directions: [],
  }

  return { project, motifGraph }
}
