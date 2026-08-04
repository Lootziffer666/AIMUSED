import type { MidiGraph } from "../midi/eventGraph.ts"
import type { MotifGraph } from "../motifs/motifGraph.ts"
import {
  type Articulation,
  clamp01,
  type Envelope,
  type InstrumentFamily,
  type MotifDirection,
  type Provenance,
} from "../schema/tonemap.ts"

/**
 * Orchestration planning.
 *
 * The planner does not compose. It redistributes material that already
 * exists, and it does so *non-destructively*: the plan is a list of
 * operations plus the results they produced. The source MIDI is never
 * touched, every operation records its reason and can be reverted, and the
 * resulting parts are rendered from the plan, not baked into the input.
 */

export interface PlanNote {
  id: string
  sourceNoteId?: string
  startTick: number
  endTick: number
  noteNumber: number
  velocity: number
}

export interface PlanPart {
  id: string
  label: string
  /** Semantic target – a concrete patch is chosen later by the ranker */
  family?: InstrumentFamily
  instrument?: string
  articulation?: Articulation
  /** Where the material came from */
  sourceVoiceId?: string
  sourceMotifId?: string
  notes: PlanNote[]
  prominence?: number | Envelope
  muted?: boolean
}

export type PlanOperationKind =
  | "duplicate-voice"
  | "duplicate-phrase"
  | "extract-motif"
  | "assign-instrument"
  | "octave-double"
  | "unison-double"
  | "transpose-register"
  | "melody-handoff"
  | "promote-voice"
  | "reduce-voice"
  | "split-chord"
  | "split-bass"
  | "set-articulation"
  | "set-prominence"

export interface PlanOperation {
  id: string
  kind: PlanOperationKind
  /** Parts that existed before this operation ran */
  inputPartIds: string[]
  /** Parts created or changed by it */
  outputPartIds: string[]
  parameters: Record<string, unknown>
  reason: string
  confidence: number
  /** Snapshot of the changed parts *before* the operation, for undo */
  undo: { parts: PlanPart[] }
  createdAt: string
}

export interface PlanWarning {
  severity: "info" | "warning"
  code:
    | "out-of-range"
    | "extreme-register"
    | "voice-crossing"
    | "too-many-voices"
    | "missing-source"
  message: string
  partId?: string
}

export interface OrchestrationPlan {
  id: string
  toneMapProjectId: string
  ticksPerQuarterNote: number
  parts: PlanPart[]
  operations: PlanOperation[]
  warnings: PlanWarning[]
  directions: MotifDirection[]
  createdAt: string
}

export interface InstrumentRange {
  lowMidi: number
  highMidi: number
  preferredLowMidi?: number
  preferredHighMidi?: number
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}`
}

/** Starts a plan from the analysed voices – one part per voice, unchanged. */
export function createPlanFromGraph(
  graph: MidiGraph,
  motifGraph: MotifGraph,
  options: { toneMapProjectId: string; now?: string },
): OrchestrationPlan {
  const now = options.now ?? new Date().toISOString()
  const parts: PlanPart[] = motifGraph.voices.map((voice) => ({
    id: `part-${voice.id}`,
    label: graph.tracks[voice.trackIndex]?.name ?? `voice ${voice.id}`,
    sourceVoiceId: voice.id,
    notes: voice.notes.map((note) => ({
      id: nextId("n"),
      sourceNoteId: note.noteId,
      startTick: note.startTick,
      endTick: note.endTick,
      noteNumber: note.noteNumber,
      velocity: note.velocity,
    })),
  }))

  return {
    id: nextId("plan"),
    toneMapProjectId: options.toneMapProjectId,
    ticksPerQuarterNote: graph.ticksPerQuarterNote,
    parts,
    operations: [],
    warnings: [],
    directions: [],
    createdAt: now,
  }
}

function clone(part: PlanPart): PlanPart {
  return { ...part, notes: part.notes.map((note) => ({ ...note })) }
}

function record(
  plan: OrchestrationPlan,
  operation: Omit<PlanOperation, "id" | "createdAt">,
  now?: string,
): OrchestrationPlan {
  return {
    ...plan,
    operations: [
      ...plan.operations,
      {
        ...operation,
        id: nextId("op"),
        createdAt: now ?? new Date().toISOString(),
      },
    ],
  }
}

function findPart(
  plan: OrchestrationPlan,
  partId: string,
): PlanPart | undefined {
  return plan.parts.find((part) => part.id === partId)
}

function withWarning(
  plan: OrchestrationPlan,
  warning: PlanWarning,
): OrchestrationPlan {
  return { ...plan, warnings: [...plan.warnings, warning] }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function duplicatePart(
  plan: OrchestrationPlan,
  partId: string,
  options: {
    label?: string
    family?: InstrumentFamily
    instrument?: string
    reason?: string
  } = {},
): OrchestrationPlan {
  const source = findPart(plan, partId)
  if (!source) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot duplicate unknown part "${partId}"`,
    })
  }
  const copy: PlanPart = {
    ...clone(source),
    id: nextId("part"),
    label: options.label ?? `${source.label} (copy)`,
    family: options.family ?? source.family,
    instrument: options.instrument ?? source.instrument,
  }
  const next = { ...plan, parts: [...plan.parts, copy] }
  return record(next, {
    kind: "duplicate-voice",
    inputPartIds: [partId],
    outputPartIds: [copy.id],
    parameters: { label: copy.label },
    reason: options.reason ?? "material reused on a second instrument",
    confidence: 1,
    undo: { parts: [] },
  })
}

/** Extracts one motif occurrence into a part of its own. */
export function extractMotif(
  plan: OrchestrationPlan,
  motifGraph: MotifGraph,
  motifId: string,
  options: { occurrenceIndex?: number; label?: string; reason?: string } = {},
): OrchestrationPlan {
  const motif = motifGraph.motifs.find((entry) => entry.id === motifId)
  const occurrence = motif?.occurrences[options.occurrenceIndex ?? 0]
  if (!motif || !occurrence) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `motif "${motifId}" has no such occurrence`,
    })
  }
  const sourcePart = plan.parts.find(
    (part) => part.sourceVoiceId === occurrence.voiceId,
  )
  const noteIds = new Set(occurrence.noteIds)
  const notes = (sourcePart?.notes ?? [])
    .filter((note) => note.sourceNoteId && noteIds.has(note.sourceNoteId))
    .map((note) => ({ ...note, id: nextId("n") }))

  const part: PlanPart = {
    id: nextId("part"),
    label: options.label ?? `motif ${motifId}`,
    sourceMotifId: motifId,
    sourceVoiceId: occurrence.voiceId,
    notes,
  }
  const next = { ...plan, parts: [...plan.parts, part] }
  return record(next, {
    kind: "extract-motif",
    inputPartIds: sourcePart ? [sourcePart.id] : [],
    outputPartIds: [part.id],
    parameters: { motifId, occurrenceIndex: options.occurrenceIndex ?? 0 },
    reason:
      options.reason ?? "motif isolated so it can be orchestrated on its own",
    confidence: motif.confidence,
    undo: { parts: [] },
  })
}

export function assignInstrument(
  plan: OrchestrationPlan,
  partId: string,
  target: {
    family?: InstrumentFamily
    instrument?: string
    articulation?: Articulation
  },
  options: { reason?: string; range?: InstrumentRange } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot assign an instrument to unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const updated: PlanPart = { ...part, ...target }
  let next: OrchestrationPlan = {
    ...plan,
    parts: plan.parts.map((entry) => (entry.id === partId ? updated : entry)),
  }
  if (options.range) next = checkRange(next, updated, options.range)

  return record(next, {
    kind: "assign-instrument",
    inputPartIds: [partId],
    outputPartIds: [partId],
    parameters: { ...target },
    reason: options.reason ?? "instrument chosen for this part",
    confidence: 0.8,
    undo: { parts: [before] },
  })
}

export function transposePart(
  plan: OrchestrationPlan,
  partId: string,
  semitones: number,
  options: {
    reason?: string
    range?: InstrumentRange
    kind?: PlanOperationKind
  } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot transpose unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const updated: PlanPart = {
    ...part,
    notes: part.notes.map((note) => ({
      ...note,
      noteNumber: note.noteNumber + semitones,
    })),
  }
  let next: OrchestrationPlan = {
    ...plan,
    parts: plan.parts.map((entry) => (entry.id === partId ? updated : entry)),
  }
  if (options.range) next = checkRange(next, updated, options.range)

  return record(next, {
    kind: options.kind ?? "transpose-register",
    inputPartIds: [partId],
    outputPartIds: [partId],
    parameters: { semitones },
    reason: options.reason ?? `moved by ${semitones} semitones`,
    confidence: 1,
    undo: { parts: [before] },
  })
}

/** Adds an octave (or unison) doubling as a new part. */
export function doublePart(
  plan: OrchestrationPlan,
  partId: string,
  options: {
    semitones?: number
    family?: InstrumentFamily
    instrument?: string
    label?: string
    range?: InstrumentRange
    reason?: string
  } = {},
): OrchestrationPlan {
  const semitones = options.semitones ?? -12
  const source = findPart(plan, partId)
  if (!source) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot double unknown part "${partId}"`,
    })
  }
  const copy: PlanPart = {
    ...clone(source),
    id: nextId("part"),
    label:
      options.label ??
      `${source.label} ${semitones === 0 ? "unison" : "octave"}`,
    family: options.family ?? source.family,
    instrument: options.instrument ?? source.instrument,
    notes: source.notes.map((note) => ({
      ...note,
      id: nextId("n"),
      noteNumber: note.noteNumber + semitones,
    })),
  }
  let next: OrchestrationPlan = { ...plan, parts: [...plan.parts, copy] }
  if (options.range) next = checkRange(next, copy, options.range)

  return record(next, {
    kind: semitones === 0 ? "unison-double" : "octave-double",
    inputPartIds: [partId],
    outputPartIds: [copy.id],
    parameters: { semitones },
    reason: options.reason ?? "doubling reinforces the line",
    confidence: 0.9,
    undo: { parts: [] },
  })
}

/**
 * Melody handoff: everything from `atTick` on moves to a new part, so two
 * instruments share one line without either being rewritten.
 */
export function melodyHandoff(
  plan: OrchestrationPlan,
  partId: string,
  atTick: number,
  target: { family?: InstrumentFamily; instrument?: string; label?: string },
  options: { reason?: string } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot hand off unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const kept = part.notes.filter((note) => note.startTick < atTick)
  const moved = part.notes.filter((note) => note.startTick >= atTick)

  const receiver: PlanPart = {
    id: nextId("part"),
    label:
      target.label ??
      `${part.label} (from bar ${Math.floor(atTick / (plan.ticksPerQuarterNote * 4)) + 1})`,
    family: target.family,
    instrument: target.instrument,
    sourceVoiceId: part.sourceVoiceId,
    sourceMotifId: part.sourceMotifId,
    notes: moved.map((note) => ({ ...note, id: nextId("n") })),
  }

  const next: OrchestrationPlan = {
    ...plan,
    parts: [
      ...plan.parts.map((entry) =>
        entry.id === partId ? { ...entry, notes: kept } : entry,
      ),
      receiver,
    ],
  }

  return record(next, {
    kind: "melody-handoff",
    inputPartIds: [partId],
    outputPartIds: [partId, receiver.id],
    parameters: { atTick, movedNotes: moved.length },
    reason: options.reason ?? "line handed to another instrument",
    confidence: 1,
    undo: { parts: [before] },
  })
}

export function setProminence(
  plan: OrchestrationPlan,
  partId: string,
  prominence: number | Envelope,
  options: { reason?: string } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot set prominence on unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const updated: PlanPart = {
    ...part,
    prominence:
      typeof prominence === "number" ? clamp01(prominence) : prominence,
  }
  const next: OrchestrationPlan = {
    ...plan,
    parts: plan.parts.map((entry) => (entry.id === partId ? updated : entry)),
  }
  return record(next, {
    kind: "set-prominence",
    inputPartIds: [partId],
    outputPartIds: [partId],
    parameters: { prominence },
    reason: options.reason ?? "dramaturgy: prominence set",
    confidence: 1,
    undo: { parts: [before] },
  })
}

export function setArticulation(
  plan: OrchestrationPlan,
  partId: string,
  articulation: Articulation,
  options: { reason?: string } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot set articulation on unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const next: OrchestrationPlan = {
    ...plan,
    parts: plan.parts.map((entry) =>
      entry.id === partId ? { ...entry, articulation } : entry,
    ),
  }
  return record(next, {
    kind: "set-articulation",
    inputPartIds: [partId],
    outputPartIds: [partId],
    parameters: { articulation },
    reason: options.reason ?? "articulation chosen",
    confidence: 0.9,
    undo: { parts: [before] },
  })
}

/** Splits simultaneous notes of a chord across several parts. */
export function splitChord(
  plan: OrchestrationPlan,
  partId: string,
  voiceCount: number,
  options: { reason?: string } = {},
): OrchestrationPlan {
  const part = findPart(plan, partId)
  if (!part) {
    return withWarning(plan, {
      severity: "warning",
      code: "missing-source",
      message: `cannot split unknown part "${partId}"`,
    })
  }
  const before = clone(part)
  const buckets: PlanNote[][] = Array.from({ length: voiceCount }, () => [])
  const byStart = new Map<number, PlanNote[]>()
  for (const note of part.notes) {
    const list = byStart.get(note.startTick) ?? []
    list.push(note)
    byStart.set(note.startTick, list)
  }
  for (const [, chord] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...chord].sort((a, b) => a.noteNumber - b.noteNumber)
    sorted.forEach((note, index) => {
      buckets[Math.min(voiceCount - 1, index)].push(note)
    })
  }

  const created = buckets
    .map((notes, index) => ({
      id: nextId("part"),
      label: `${part.label} voice ${index + 1}`,
      sourceVoiceId: part.sourceVoiceId,
      family: part.family,
      notes: notes.map((note) => ({ ...note, id: nextId("n") })),
    }))
    .filter((entry) => entry.notes.length > 0)

  const next: OrchestrationPlan = {
    ...plan,
    parts: [...plan.parts.filter((entry) => entry.id !== partId), ...created],
  }
  return record(next, {
    kind: "split-chord",
    inputPartIds: [partId],
    outputPartIds: created.map((entry) => entry.id),
    parameters: { voiceCount },
    reason: options.reason ?? "chord distributed across instruments",
    confidence: 0.8,
    undo: { parts: [before] },
  })
}

/** Range check against an instrument's playable and comfortable range. */
export function checkRange(
  plan: OrchestrationPlan,
  part: PlanPart,
  range: InstrumentRange,
): OrchestrationPlan {
  const warnings: PlanWarning[] = []
  const outside = part.notes.filter(
    (note) =>
      note.noteNumber < range.lowMidi || note.noteNumber > range.highMidi,
  )
  if (outside.length > 0) {
    warnings.push({
      severity: "warning",
      code: "out-of-range",
      partId: part.id,
      message: `${outside.length} notes are outside the playable range ${range.lowMidi}-${range.highMidi}`,
    })
  }
  if (
    range.preferredLowMidi !== undefined &&
    range.preferredHighMidi !== undefined
  ) {
    const uncomfortable = part.notes.filter(
      (note) =>
        note.noteNumber >= range.lowMidi &&
        note.noteNumber <= range.highMidi &&
        (note.noteNumber < range.preferredLowMidi! ||
          note.noteNumber > range.preferredHighMidi!),
    )
    if (uncomfortable.length > part.notes.length * 0.3) {
      warnings.push({
        severity: "info",
        code: "extreme-register",
        partId: part.id,
        message: `${uncomfortable.length} notes sit outside the comfortable range`,
      })
    }
  }
  return warnings.length > 0
    ? { ...plan, warnings: [...plan.warnings, ...warnings] }
    : plan
}

/** Warns when two parts cross – the classic voice leading smell. */
export function checkVoiceCrossing(
  plan: OrchestrationPlan,
  upperPartId: string,
  lowerPartId: string,
): OrchestrationPlan {
  const upper = findPart(plan, upperPartId)
  const lower = findPart(plan, lowerPartId)
  if (!upper || !lower) return plan
  let crossings = 0
  for (const note of upper.notes) {
    const simultaneous = lower.notes.filter(
      (other) =>
        other.startTick < note.endTick && note.startTick < other.endTick,
    )
    crossings += simultaneous.filter(
      (other) => other.noteNumber > note.noteNumber,
    ).length
  }
  if (crossings === 0) return plan
  return withWarning(plan, {
    severity: "info",
    code: "voice-crossing",
    partId: upperPartId,
    message: `${crossings} places where "${lower.label}" rises above "${upper.label}"`,
  })
}

/** Reverts the last operation, restoring the snapshot it stored. */
export function undoLastOperation(plan: OrchestrationPlan): OrchestrationPlan {
  const operation = plan.operations[plan.operations.length - 1]
  if (!operation) return plan

  const created = new Set(
    operation.outputPartIds.filter(
      (id) => !operation.inputPartIds.includes(id),
    ),
  )
  let parts = plan.parts.filter((part) => !created.has(part.id))

  for (const snapshot of operation.undo.parts) {
    const exists = parts.some((part) => part.id === snapshot.id)
    parts = exists
      ? parts.map((part) => (part.id === snapshot.id ? clone(snapshot) : part))
      : [...parts, clone(snapshot)]
  }
  // split-chord replaces one part with several: restore the original order
  if (operation.kind === "split-chord") {
    parts = parts.filter((part) => !operation.outputPartIds.includes(part.id))
    for (const snapshot of operation.undo.parts) {
      if (!parts.some((part) => part.id === snapshot.id))
        parts.push(clone(snapshot))
    }
  }

  return {
    ...plan,
    parts,
    operations: plan.operations.slice(0, -1),
  }
}

export function addDirection(
  plan: OrchestrationPlan,
  direction: Omit<MotifDirection, "id" | "provenance"> & {
    id?: string
    provenance?: Provenance
  },
  now?: string,
): OrchestrationPlan {
  const entry: MotifDirection = {
    ...direction,
    id: direction.id ?? nextId("dir"),
    provenance:
      direction.provenance ??
      ({
        source: "user",
        status: "manually-confirmed",
        confidence: 1,
        extractionMethod: "motif-direction",
        evidence: [],
        createdAt: now ?? new Date().toISOString(),
      } satisfies Provenance),
  }
  return { ...plan, directions: [...plan.directions, entry] }
}
